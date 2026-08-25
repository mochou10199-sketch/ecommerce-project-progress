import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { auditLogs, sessions, users } from "../../../../../../db/schema";
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../../../lib/auth-policy";
import { getOwner, isResponse } from "../../../../../lib/permissions";
import { checkRateLimit, tooManyRequests } from "../../../../../lib/rate-limit";
import { hashPassword } from "../../../../../lib/server-auth";

type RouteContext = { params: Promise<{ id: string }> };

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const resetLimit = checkRateLimit(request, "team.member.password_reset", owner.id, 20, 15 * 60 * 1000);
  if (!resetLimit.allowed) return tooManyRequests(resetLimit, "密码重置操作过于频繁，请稍后再试。");

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { newPassword?: unknown };
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    return error(PASSWORD_LENGTH_MESSAGE);
  }

  const db = getDb();
  const [member] = await db.select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, id), eq(users.teamId, owner.teamId), eq(users.role, "member")))
    .limit(1);
  if (!member) return error("成员不存在。", 404);

  const credentials = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await db.batch([
    db.update(users).set({
      passwordHash: credentials.hash,
      passwordSalt: credentials.salt,
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now,
    }).where(and(eq(users.id, member.id), eq(users.teamId, owner.teamId))),
    db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, member.id), eq(sessions.teamId, owner.teamId))),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      teamId: owner.teamId,
      userId: owner.id,
      action: "team_member.password_reset",
      resourceType: "user",
      resourceId: member.id,
      result: "success",
      createdAt: now,
    }),
  ]);
  return Response.json({ ok: true });
}
