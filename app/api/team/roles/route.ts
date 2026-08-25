import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, teamRoles, users } from "../../../../db/schema";
import { getOwner, isResponse } from "../../../lib/permissions";
import { checkRateLimit, tooManyRequests } from "../../../lib/rate-limit";
import { DEFAULT_ROLE_DEFINITIONS, normalizeCustomPermissions, parseStoredPermissions, permissionsToStorage } from "../../../lib/role-options";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const db = getDb();
  const members = await db.select({ role: users.role }).from(users).where(eq(users.teamId, owner.teamId));
  let roles: Array<{
    id: string; teamId: string; code: string; name: string; description: string;
    permissions: string; isSystem: boolean; isActive: boolean; createdAt: string; updatedAt: string;
  }>;
  try {
    roles = await db.select().from(teamRoles).where(eq(teamRoles.teamId, owner.teamId));
  } catch {
    roles = DEFAULT_ROLE_DEFINITIONS.map((role) => ({
      id: role.code, teamId: owner.teamId, code: role.code, name: role.name,
      description: role.description, permissions: permissionsToStorage(role.permissions),
      isSystem: true, isActive: true, createdAt: "", updatedAt: "",
    }));
  }
  const assigned = new Map<string, number>();
  for (const member of members) assigned.set(member.role, (assigned.get(member.role) ?? 0) + 1);
  return Response.json({ roles: roles.map((role) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions: parseStoredPermissions(role.permissions),
    isSystem: role.isSystem,
    isActive: role.isActive,
    assignedCount: assigned.get(role.code) ?? 0,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  })) });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const limit = checkRateLimit(request, "team.role.create", owner.id, 20, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit, "角色配置操作过于频繁，请稍后再试。");
  const body = await request.json().catch(() => ({})) as { name?: unknown; description?: unknown; permissions?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const permissions = normalizeCustomPermissions(body.permissions);
  if (name.length < 2 || name.length > 40) return error("角色名称需要为 2-40 个字符。");
  if (description.length > 200) return error("角色说明不能超过 200 个字符。");
  if (!permissions) return error("自定义角色至少需要包含“查看项目”权限。");

  const now = new Date().toISOString();
  const role = {
    id: crypto.randomUUID(),
    teamId: owner.teamId,
    code: `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name,
    description,
    permissions: permissionsToStorage(permissions),
    isSystem: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const db = getDb();
    await db.batch([
      db.insert(teamRoles).values(role),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
        action: "team_role.create", resourceType: "team_role", resourceId: role.id,
        result: "success", createdAt: now,
      }),
    ]);
  } catch {
    return error("角色暂时无法创建，请稍后重试。", 409);
  }
  return Response.json({ role: {
    id: role.id, code: role.code, name: role.name, description: role.description,
    permissions, isSystem: false, isActive: true, assignedCount: 0,
    createdAt: now, updatedAt: now,
  } }, { status: 201 });
}
