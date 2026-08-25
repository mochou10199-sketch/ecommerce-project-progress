import { and, eq } from "drizzle-orm";
import { getDb } from "../../../..//db";
import { auditLogs, teams, users } from "../../../..//db/schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../lib/auth-policy";
import { checkRateLimit, tooManyRequests } from "../../../lib/rate-limit";
import { buildAuthUser, createSession, verifyPassword } from "../../../lib/server-auth";

function invalidCredentials() {
  return Response.json({ error: "团队编号、用户名或密码不正确。" }, { status: 401 });
}

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    teamCode?: unknown;
    username?: unknown;
    password?: unknown;
  };
  const teamCode = typeof body.teamCode === "string" ? body.teamCode.trim().toUpperCase() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!teamCode || !username || !password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return invalidCredentials();
  const loginLimit = checkRateLimit(request, "auth.login", `${teamCode}:${username}`, 10, 5 * 60 * 1000);
  if (!loginLimit.allowed) return tooManyRequests(loginLimit, "登录尝试过于频繁，请稍后再试。");

  const db = getDb();
  const [team] = await db.select().from(teams)
    .where(and(eq(teams.code, teamCode), eq(teams.status, "active")))
    .limit(1);
  if (!team) return invalidCredentials();

  const [user] = await db.select().from(users)
    .where(and(eq(users.teamId, team.id), eq(users.username, username), eq(users.status, "active")))
    .limit(1);
  const lockedUntil = user?.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
  if (!user || (lockedUntil && lockedUntil > Date.now())) return invalidCredentials();

  if (!(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
    const failedLoginCount = user.failedLoginCount + 1;
    const nextLockedUntil = failedLoginCount >= MAX_FAILED_LOGINS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;
    const now = new Date().toISOString();
    await db.update(users).set({ failedLoginCount, lockedUntil: nextLockedUntil, updatedAt: now }).where(eq(users.id, user.id));
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      teamId: team.id,
      userId: user.id,
      action: "auth.login_failed",
      resourceType: "session",
      resourceId: user.id,
      result: nextLockedUntil ? "locked" : "failure",
      createdAt: now,
    });
    return invalidCredentials();
  }

  const now = new Date().toISOString();
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now }).where(eq(users.id, user.id));
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    teamId: team.id,
    userId: user.id,
    action: "auth.login",
    resourceType: "session",
    resourceId: user.id,
    result: "success",
    createdAt: now,
  });

  const authUser = await buildAuthUser({
    id: user.id,
    teamId: team.id,
    teamCode: team.code,
    teamName: team.name,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  const session = await createSession(request, authUser);
  return Response.json({ user: authUser }, { headers: { "Set-Cookie": session.cookie } });
}
