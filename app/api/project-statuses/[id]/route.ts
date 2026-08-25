import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, projectStatuses, projects } from "../../../../db/schema";
import { getOwner, isResponse } from "../../../lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(request: Request, context: RouteContext) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { name?: unknown; color?: unknown; isActive?: unknown };
  const [current] = await getDb().select().from(projectStatuses)
    .where(and(eq(projectStatuses.id, id), eq(projectStatuses.teamId, owner.teamId))).limit(1);
  if (!current) return error("项目状态不存在。", 404);

  const name = typeof body.name === "string" ? body.name.trim() : current.name;
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : current.color;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : current.isActive;
  if (!name || name.length > 40) return error("状态名称需要为 1-40 个字符。");
  const [duplicate] = await getDb().select({ id: projectStatuses.id }).from(projectStatuses)
    .where(and(eq(projectStatuses.teamId, owner.teamId), eq(projectStatuses.name, name))).limit(2);
  if (duplicate && duplicate.id !== id) return error("该团队已经存在同名状态。", 409);
  const now = new Date().toISOString();
  await getDb().batch([
    getDb().update(projectStatuses).set({ name, color, isActive, updatedAt: now }).where(eq(projectStatuses.id, id)),
    getDb().insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "project_status.update", resourceType: "project_status", resourceId: id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const { id } = await context.params;
  const db = getDb();
  const [current] = await db.select().from(projectStatuses)
    .where(and(eq(projectStatuses.id, id), eq(projectStatuses.teamId, owner.teamId))).limit(1);
  if (!current) return error("项目状态不存在。", 404);
  const [used] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.teamId, owner.teamId), eq(projects.statusId, id))).limit(1);
  if (used) return error("该状态仍被项目使用，请先迁移项目状态。", 409);
  const now = new Date().toISOString();
  await db.batch([
    db.update(projectStatuses).set({ isActive: false, updatedAt: now }).where(eq(projectStatuses.id, id)),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "project_status.archive", resourceType: "project_status", resourceId: id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ ok: true });
}
