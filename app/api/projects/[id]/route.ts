import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, projectSources, projectStatuses, projects } from "../../../../db/schema";
import { isResponse, requirePermission } from "../../../lib/permissions";
import { getProjectRecord } from "../../../lib/project-record";
import { isProjectPriority, parseProgressPercent } from "../../../lib/project-options";

type RouteContext = { params: Promise<{ id: string }> };

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return null;
  const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  if (values.length > maxItems || values.some((item) => !item || item.length > maxLength)) return null;
  return values;
}

function parseList(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requirePermission(request, "project.edit");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const db = getDb();
  const [current] = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.teamId, user.teamId), isNull(projects.archivedAt))).limit(1);
  if (!current) return error("项目不存在。", 404);

  const body = await request.json().catch(() => ({})) as {
    name?: unknown;
    category?: unknown;
    stage?: unknown;
    statusId?: unknown;
    priority?: unknown;
    plannedEndDate?: unknown;
    description?: unknown;
    progress?: unknown;
    progressPercent?: unknown;
    blockers?: unknown;
    sources?: unknown;
    expectedUpdatedAt?: unknown;
  };
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
  if (!expectedUpdatedAt) return error("项目版本已失效，请刷新后再编辑。", 428);
  if (expectedUpdatedAt !== current.updatedAt) {
    return Response.json({
      error: "项目已被其他成员更新，请刷新后再编辑。",
      project: await getProjectRecord(user.teamId, id),
    }, { status: 409 });
  }
  const name = body.name === undefined ? current.name : typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category === undefined ? current.category : typeof body.category === "string" ? body.category.trim() : "";
  const stage = body.stage === undefined ? current.stage : typeof body.stage === "string" ? body.stage.trim() : "";
  const priority = body.priority === undefined ? current.priority : body.priority;
  const progress = body.progress === undefined ? current.progress : typeof body.progress === "string" ? body.progress.trim() : "";
  const description = body.description === undefined ? current.description : typeof body.description === "string" ? body.description.trim() : "";
  const progressPercent = body.progressPercent === undefined ? current.progressPercent : parseProgressPercent(body.progressPercent);
  const plannedEndDate = body.plannedEndDate === undefined
    ? current.plannedEndDate ?? ""
    : typeof body.plannedEndDate === "string" ? body.plannedEndDate.trim() : "";
  const blockers = body.blockers === undefined ? parseList(current.blockers) : stringList(body.blockers, 10, 300);
  const sources = body.sources === undefined ? null : stringList(body.sources, 10, 200);
  const statusId = body.statusId === undefined ? current.statusId : typeof body.statusId === "string" ? body.statusId : "";
  if (name.length < 2 || name.length > 120) return error("项目名称需要为 2-120 个字符。");
  if (category.length > 80) return error("项目类型不能超过 80 个字符。");
  if (stage.length < 1 || stage.length > 120) return error("项目阶段不能为空，且不能超过 120 个字符。");
  if (!isProjectPriority(priority)) return error("项目优先级无效。");
  if (description.length > 1000) return error("项目说明不能超过 1000 个字符。");
  if (progress.length > 2000) return error("项目进度不能超过 2000 个字符。");
  if (progressPercent === null) return error("完成比例无效。");
  if (plannedEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(plannedEndDate)) return error("计划完成日期格式不正确。");
  if (!blockers || (body.sources !== undefined && !sources)) return error("阻塞项和来源需要是有效的文本列表。");

  const [status] = await db.select({ id: projectStatuses.id }).from(projectStatuses)
    .where(and(eq(projectStatuses.id, statusId), eq(projectStatuses.teamId, user.teamId), eq(projectStatuses.isActive, true))).limit(1);
  if (!status) return error("项目状态无效。", 400);

  const now = new Date().toISOString();
  const updatedRows = await db.update(projects).set({
    name, category, stage, statusId, priority, plannedEndDate: plannedEndDate || null,
    description, progress, progressPercent, blockers: JSON.stringify(blockers), updatedAt: now,
  }).where(and(
    eq(projects.id, id),
    eq(projects.teamId, user.teamId),
    eq(projects.updatedAt, expectedUpdatedAt),
  )).returning({ id: projects.id });
  if (updatedRows.length === 0) {
    return Response.json({
      error: "项目已被其他成员更新，请刷新后再编辑。",
      project: await getProjectRecord(user.teamId, id),
    }, { status: 409 });
  }
  const writes = [];
  if (body.sources !== undefined) {
    writes.push(db.delete(projectSources).where(and(eq(projectSources.projectId, id), eq(projectSources.teamId, user.teamId))));
    if (sources?.length) {
      writes.push(db.insert(projectSources).values(sources.map((title) => ({
        id: crypto.randomUUID(), projectId: id, teamId: user.teamId, title,
        sourceType: "manual", reference: null, createdBy: user.id, createdAt: now,
      }))));
    }
  }
  writes.push(db.insert(auditLogs).values({
    id: crypto.randomUUID(), teamId: user.teamId, userId: user.id,
    action: "project.update", resourceType: "project", resourceId: id,
    result: "success", createdAt: now,
  }));
  await db.batch(writes);
  return Response.json({ project: await getProjectRecord(user.teamId, id) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const owner = await requirePermission(request, "project.archive");
  if (isResponse(owner)) return owner;
  const { id } = await context.params;
  const db = getDb();
  const [current] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, id), eq(projects.teamId, owner.teamId), isNull(projects.archivedAt))).limit(1);
  if (!current) return error("项目不存在。", 404);
  const now = new Date().toISOString();
  await db.batch([
    db.update(projects).set({ archivedAt: now, updatedAt: now }).where(and(eq(projects.id, id), eq(projects.teamId, owner.teamId))),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "project.archive", resourceType: "project", resourceId: id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ ok: true });
}
