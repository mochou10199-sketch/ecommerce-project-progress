import { asc, and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, projectStatuses } from "../../../db/schema";
import { getAuthUser } from "../../lib/server-auth";
import { getOwner, isResponse } from "../../lib/permissions";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return error("请先登录团队。", 401);
  const statuses = await getDb().select().from(projectStatuses)
    .where(eq(projectStatuses.teamId, user.teamId))
    .orderBy(asc(projectStatuses.sortOrder));
  return Response.json({ statuses });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const body = await request.json().catch(() => ({})) as { name?: unknown; color?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#64748b";
  if (name.length < 1 || name.length > 40) return error("状态名称需要为 1-40 个字符。");

  const db = getDb();
  const [existing] = await db.select({ id: projectStatuses.id }).from(projectStatuses)
    .where(and(eq(projectStatuses.teamId, owner.teamId), eq(projectStatuses.name, name))).limit(1);
  if (existing) return error("该团队已经存在同名状态。", 409);
  const [last] = await db.select({ sortOrder: projectStatuses.sortOrder }).from(projectStatuses)
    .where(eq(projectStatuses.teamId, owner.teamId)).orderBy(desc(projectStatuses.sortOrder)).limit(1);
  const now = new Date().toISOString();
  const status = {
    id: crypto.randomUUID(),
    teamId: owner.teamId,
    code: `custom_${crypto.randomUUID().slice(0, 8)}`,
    name,
    color,
    sortOrder: (last?.sortOrder ?? -1) + 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(projectStatuses).values(status),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "project_status.create", resourceType: "project_status", resourceId: status.id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ status }, { status: 201 });
}
