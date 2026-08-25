export const ROLE_PERMISSIONS = [
  "project.view",
  "project.create",
  "project.edit",
  "project.archive",
] as const;

export type Permission = (typeof ROLE_PERMISSIONS)[number] | "team.manage";
export type CustomRolePermission = (typeof ROLE_PERMISSIONS)[number];
const ALL_ROLE_PERMISSIONS = [...ROLE_PERMISSIONS, "team.manage"] as const;

export const DEFAULT_ROLE_DEFINITIONS = [
  {
    code: "owner",
    name: "团队母账号",
    description: "管理团队、成员、项目状态和全部项目。",
    permissions: ["project.view", "project.create", "project.edit", "project.archive", "team.manage"] as Permission[],
    isSystem: true,
  },
  {
    code: "member",
    name: "团队成员",
    description: "查看、创建和编辑当前团队项目。",
    permissions: ["project.view", "project.create", "project.edit"] as Permission[],
    isSystem: true,
  },
] as const;

export function parseStoredPermissions(value: string): Permission[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is Permission =>
      typeof item === "string" && (ALL_ROLE_PERMISSIONS as readonly string[]).includes(item),
    ))];
  } catch {
    return [];
  }
}

export function normalizeCustomPermissions(value: unknown): CustomRolePermission[] | null {
  if (!Array.isArray(value)) return null;
  const permissions = [...new Set(value.filter((item): item is CustomRolePermission =>
    typeof item === "string" && (ROLE_PERMISSIONS as readonly string[]).includes(item),
  ))];
  if (!permissions.includes("project.view")) return null;
  return permissions;
}

export function permissionsToStorage(permissions: readonly Permission[]) {
  return JSON.stringify([...new Set(permissions)]);
}

export const ROLE_PERMISSION_LABELS: Record<CustomRolePermission, string> = {
  "project.view": "查看项目",
  "project.create": "创建项目",
  "project.edit": "编辑项目",
  "project.archive": "归档项目",
};
