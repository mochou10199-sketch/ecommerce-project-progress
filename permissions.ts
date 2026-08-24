import { getAuthUser, type AuthUser } from "./server-auth";
import type { Permission } from "./role-options";

export function hasPermission(user: AuthUser, permission: Permission) {
  return user.permissions.includes(permission);
}

export async function requirePermission(request: Request, permission: Permission): Promise<AuthUser | Response> {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "请先登录团队。" }, { status: 401 });
  if (!hasPermission(user, permission)) return Response.json({ error: "当前账号没有执行此操作的权限。" }, { status: 403 });
  return user;
}

export async function getOwner(request: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "请先登录团队。" }, { status: 401 });
  if (user.role !== "owner") return Response.json({ error: "只有团队母账号可以执行此操作。" }, { status: 403 });
  return user;
}

export function isResponse(value: AuthUser | Response): value is Response {
  return value instanceof Response;
}
