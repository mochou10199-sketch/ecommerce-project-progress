import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, teamRoles, users } from "../../../../db/schema";
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../lib/auth-policy";
import { getOwner, isResponse } from "../../../lib/permissions";
import { hashPassword } from "../../../lib/server-auth";
import { DEFAULT_ROLE_DEFINITIONS } from "../../../lib/role-options";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isUsername(value: string) {
  return /^[a-zA-Z0-9_][a-zA-Z0-9._-]{2,31}$/.test(value);
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const db = getDb();
  const members = await db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    status: users.status,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.teamId, owner.teamId));
  let roles: Array<{ code: string; name: string }>;
  try {
    roles = await db.select({ code: teamRoles.code, name: teamRoles.name })
      .from(teamRoles).where(eq(teamRoles.teamId, owner.teamId));
  } catch {
    roles = DEFAULT_ROLE_DEFINITIONS.map((role) => ({ code: role.code, name: role.name }));
  }
  const roleNames = new Map(roles.map((role) => [role.code, role.name]));
  return Response.json({ members: members.map((member) => ({ ...member, roleName: roleNames.get(member.role) ?? "待配置角色" })) });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown; role?: unknown };
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!isUsername(username)) return error("用户名需要为 3-32 位字母、数字、下划线、点或短横线。");
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return error(PASSWORD_LENGTH_MESSAGE);
  const db = getDb();
  const roleCode = typeof body.role === "string" && body.role.trim() ? body.role.trim() : "member";
  let role: { code: string; name: string } | undefined;
  try {
    const [roleRow] = await db.select({ code: teamRoles.code, name: teamRoles.name }).from(teamRoles).where(and(
      eq(teamRoles.teamId, owner.teamId), eq(teamRoles.code, roleCode), eq(teamRoles.isActive, true),
    )).limit(1);
    role = roleRow;
  } catch {
    role = roleCode === "member" ? { code: "member", name: "团队成员" } : undefined;
    if (!role) return error("角色配置正在升级，请稍后再试。", 503);
  }
  if (!role || role.code === "owner") return error("成员角色无效，不能把团队成员设置为母账号。");
  const [existing] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.teamId, owner.teamId), eq(users.username, username))).limit(1);
  if (existing) return error("该团队已经存在同名用户。", 409);
  const credentials = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(), teamId: owner.teamId, username,
    passwordHash: credentials.hash, passwordSalt: credentials.salt,
    role: role.code, status: "active", mustChangePassword: true,
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await db.batch([
    db.insert(users).values(user),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "team_member.create", resourceType: "user", resourceId: user.id,
      result: "success", createdAt: user.createdAt,
    }),
  ]);
  return Response.json({ member: { id: user.id, username, role: user.role, roleName: role.name, status: user.status } }, { status: 201 });
}
