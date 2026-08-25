import { getDb } from "../../../..//db";
import { auditLogs, organizations, projectStatuses, teamRoles, teams, users } from "../../../..//db/schema";
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../lib/auth-policy";
import { checkRateLimit, tooManyRequests } from "../../../lib/rate-limit";
import { buildAuthUser, createSession, hashPassword } from "../../../lib/server-auth";
import { DEFAULT_ROLE_DEFINITIONS, permissionsToStorage } from "../../../lib/role-options";

const defaultStatuses = [
  { code: "on_track", name: "正常", color: "#0f7a47", sortOrder: 0 },
  { code: "at_risk", name: "有风险", color: "#a65e00", sortOrder: 1 },
  { code: "delayed", name: "已延期", color: "#b42318", sortOrder: 2 },
];

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isUsername(value: string) {
  return /^[a-zA-Z0-9_][a-zA-Z0-9._-]{2,31}$/.test(value);
}

function createTeamCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    teamName?: unknown;
    username?: unknown;
    password?: unknown;
  };
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (teamName.length < 2 || teamName.length > 80) return jsonError("团队名称需要为 2-80 个字符。");
  if (!isUsername(username)) return jsonError("用户名需要为 3-32 位字母、数字、下划线、点或短横线。");
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return jsonError(PASSWORD_LENGTH_MESSAGE);
  const registerLimit = checkRateLimit(request, "auth.register", "team-registration", 5, 10 * 60 * 1000);
  if (!registerLimit.allowed) return tooManyRequests(registerLimit, "注册请求过于频繁，请稍后再试。");

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (error) {
    console.error("registration database unavailable", error instanceof Error ? error.message : error);
    return jsonError("数据库暂时不可用，请先检查部署环境中的 DATABASE_URL。", 503);
  }
  const teamCode = createTeamCode();
  const now = new Date().toISOString();
  const organizationId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const credentials = await hashPassword(password);
  const statusRows = defaultStatuses.map((status) => ({
    id: crypto.randomUUID(),
    teamId,
    ...status,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const roleRows = DEFAULT_ROLE_DEFINITIONS.map((role) => ({
    id: crypto.randomUUID(),
    teamId,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions: permissionsToStorage(role.permissions),
    isSystem: role.isSystem,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  let roleTableAvailable = true;
  try {
    await db.select({ id: teamRoles.id }).from(teamRoles).limit(1);
  } catch {
    roleTableAvailable = false;
  }

  try {
    await db.batch([
      db.insert(organizations).values({
        id: organizationId,
        name: teamName,
        slug: `org-${teamCode.toLowerCase()}`,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(teams).values({
        id: teamId,
        organizationId,
        name: teamName,
        code: teamCode,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(users).values({
        id: userId,
        teamId,
        username,
        passwordHash: credentials.hash,
        passwordSalt: credentials.salt,
        role: "owner",
        status: "active",
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(projectStatuses).values(statusRows),
      ...(roleTableAvailable ? [db.insert(teamRoles).values(roleRows)] : []),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        teamId,
        userId,
        action: "team.register",
        resourceType: "team",
        resourceId: teamId,
        result: "success",
        createdAt: now,
      }),
    ]);
  } catch (error) {
    console.error("team registration failed", error instanceof Error ? error.message : error);
    return jsonError("团队暂时无法创建，请更换信息后重试。", 409);
  }

  const user = await buildAuthUser({
    id: userId,
    teamId,
    teamCode,
    teamName,
    username,
    role: "owner",
    mustChangePassword: false,
  });
  const session = await createSession(request, user);

  return Response.json({
    user,
    teamCode,
    message: "团队创建成功，请保存团队编号。",
  }, {
    headers: { "Set-Cookie": session.cookie },
  });
}
