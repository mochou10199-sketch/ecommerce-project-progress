import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditLogs, sessions, teamRoles, users } from "../../../../../db/schema";
import { getOwner, isResponse } from "../../../../lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const { id } = await context.params;
  if (id === owner.id) return Response.json({ error: "团队母账号不能修改自己的成员角色或状态。" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { status?: unknown; role?: unknown };
  const hasStatus = body.status !== undefined;
  const hasRole = body.role !== undefined;
  if (!hasStatus && !hasRole) return Response.json({ error: "没有可更新的成员信息。" }, { status: 400 });
  const status = hasStatus ? (body.status === "active" || body.status === "suspended" ? body.status : "") : undefined;
  if (hasStatus && !status) return Response.json({ error: "成员状态无效。" }, { status: 400 });

  const db = getDb();
  const [member] = await db.select({ id: users.id, role: users.role, status: users.status }).from(users)
    .where(and(eq(users.id, id), eq(users.teamId, owner.teamId))).limit(1);
  if (!member || member.role === "owner") return Response.json({ error: "成员不存在。" }, { status: 404 });

  let nextRole = member.role;
  let roleChanged = false;
  if (hasRole) {
    const roleCode = typeof body.role === "string" ? body.role.trim() : "";
    let role: { code: string } | undefined;
    try {
      const [roleRow] = await db.select({ code: teamRoles.code }).from(teamRoles).where(and(
        eq(teamRoles.teamId, owner.teamId), eq(teamRoles.code, roleCode), eq(teamRoles.isActive, true),
      )).limit(1);
      role = roleRow;
    } catch {
      return Response.json({ error: "角色配置正在升级，请稍后再试。" }, { status: 503 });
    }
    if (!role || role.code === "owner") return Response.json({ error: "成员角色无效，不能把团队成员设置为母账号。" }, { status: 400 });
    nextRole = role.code;
    roleChanged = nextRole !== member.role;
  }

  const nextStatus = status ?? member.status;
  const now = new Date().toISOString();
  const writes = [db.update(users).set({ status: nextStatus, role: nextRole, updatedAt: now }).where(eq(users.id, member.id))];
  if (status !== undefined && status !== member.status) writes.push(db.insert(auditLogs).values({
    id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
    action: "team_member.update", resourceType: "user", resourceId: member.id,
    result: status, createdAt: now,
  }));
  if (roleChanged) writes.push(db.insert(auditLogs).values({
    id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
    action: "team_member.role_update", resourceType: "user", resourceId: member.id,
    result: nextRole, createdAt: now,
  }));
  if (status === "suspended" || roleChanged) writes.push(db.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, member.id)));
  await db.batch(writes);
  return Response.json({ ok: true, role: nextRole, status: nextStatus });
}
