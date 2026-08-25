import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditLogs, teamRoles, users } from "../../../../../db/schema";
import { getOwner, isResponse } from "../../../../lib/permissions";
import { checkRateLimit, tooManyRequests } from "../../../../lib/rate-limit";
import { normalizeCustomPermissions, parseStoredPermissions, permissionsToStorage } from "../../../../lib/role-options";

type RouteContext = { params: Promise<{ id: string }> };

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(request: Request, context: RouteContext) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const limit = checkRateLimit(request, "team.role.update", owner.id, 30, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit, "角色配置操作过于频繁，请稍后再试。");
  const { id } = await context.params;
  const db = getDb();
  const [role] = await db.select().from(teamRoles).where(and(
    eq(teamRoles.id, id), eq(teamRoles.teamId, owner.teamId),
  )).limit(1);
  if (!role) return error("角色不存在。", 404);
  if (role.isSystem) return error("系统角色不能修改，请新建自定义角色。", 400);

  const body = await request.json().catch(() => ({})) as {
    name?: unknown; description?: unknown; permissions?: unknown; isActive?: unknown;
  };
  const hasName = body.name !== undefined;
  const hasDescription = body.description !== undefined;
  const hasPermissions = body.permissions !== undefined;
  const hasActive = body.isActive !== undefined;
  if (!hasName && !hasDescription && !hasPermissions && !hasActive) return error("没有可更新的角色内容。");
  const name = hasName ? (typeof body.name === "string" ? body.name.trim() : "") : role.name;
  const description = hasDescription ? (typeof body.description === "string" ? body.description.trim() : "") : role.description;
  const permissions = hasPermissions ? normalizeCustomPermissions(body.permissions) : parseStoredPermissions(role.permissions);
  const isActive = hasActive ? body.isActive === true : role.isActive;
  if (name.length < 2 || name.length > 40) return error("角色名称需要为 2-40 个字符。");
  if (description.length > 200) return error("角色说明不能超过 200 个字符。");
  if (!permissions) return error("自定义角色至少需要包含“查看项目”权限。");
  if (!isActive && role.isActive) {
    const [assigned] = await db.select({ count: sql<number>`count(*)` }).from(users).where(and(
      eq(users.teamId, owner.teamId), eq(users.role, role.code),
    ));
    if (Number(assigned?.count ?? 0) > 0) return error("仍有成员使用此角色，请先为成员分配其他角色。", 409);
  }
  const now = new Date().toISOString();
  await db.batch([
    db.update(teamRoles).set({ name, description, permissions: permissionsToStorage(permissions), isActive, updatedAt: now }).where(eq(teamRoles.id, role.id)),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "team_role.update", resourceType: "team_role", resourceId: role.id,
      result: isActive ? "success" : "suspended", createdAt: now,
    }),
  ]);
  return Response.json({ ok: true, role: {
    id: role.id, code: role.code, name, description, permissions,
    isSystem: false, isActive, updatedAt: now,
  } });
}
