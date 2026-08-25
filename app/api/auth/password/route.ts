import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, sessions, users } from "../../../../db/schema";
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../lib/auth-policy";
import { checkRateLimit, tooManyRequests } from "../../../lib/rate-limit";
import { getAuthUser, getCurrentSessionTokenHash, hashPassword, verifyPassword } from "../../../lib/server-auth";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return error("请先登录团队。", 401);
  const passwordLimit = checkRateLimit(request, "auth.password", authUser.id, 5, 15 * 60 * 1000);
  if (!passwordLimit.allowed) return tooManyRequests(passwordLimit, "密码修改尝试过于频繁，请稍后再试。");

  const body = await request.json().catch(() => ({})) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    return error(PASSWORD_LENGTH_MESSAGE);
  }
  if (!currentPassword) return error("请输入当前密码。", 401);

  const db = getDb();
  const [user] = await db.select().from(users)
    .where(and(eq(users.id, authUser.id), eq(users.teamId, authUser.teamId), eq(users.status, "active")))
    .limit(1);
  if (!user || !(await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash))) {
    return error("当前密码不正确。", 401);
  }

  const credentials = await hashPassword(newPassword);
  const now = new Date().toISOString();
  const currentSessionTokenHash = await getCurrentSessionTokenHash(request);
  const writes = [
    db.update(users).set({
      passwordHash: credentials.hash,
      passwordSalt: credentials.salt,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now,
    }).where(and(eq(users.id, authUser.id), eq(users.teamId, authUser.teamId))),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      teamId: authUser.teamId,
      userId: authUser.id,
      action: "auth.password_changed",
      resourceType: "user",
      resourceId: authUser.id,
      result: "success",
      createdAt: now,
    }),
  ];
  if (currentSessionTokenHash) {
    writes.push(db.update(sessions).set({ revokedAt: now }).where(and(
      eq(sessions.userId, authUser.id),
      ne(sessions.tokenHash, currentSessionTokenHash),
    )));
  }
  await db.batch(writes);

  return Response.json({ ok: true, mustChangePassword: false });
}
