import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, projectSources, projectStatuses, projects } from "../../../db/schema";
import { isResponse, requirePermission } from "../../lib/permissions";
import { firstActiveStatusId, listProjectRecords } from "../../lib/project-record";
import { isProjectPriority, parseProgressPercent } from "../../lib/project-options";
import { checkRateLimit, tooManyRequests } from "../../lib/rate-limit";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function stringList(value: unknown, maxItems: number, maxLength: number) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  if (values.length > maxItems || values.some((item) => !item || item.length > maxLength)) return null;
  return values;
}

export async function GET(request: Request) {
  const user = await requirePermission(request, "project.view");
  if (isResponse(user)) return user;
  return Response.json({ projects: await listProjectRecords(user.teamId) });
}

export async function POST(request: Request) {
  const user = await requirePermission(request, "project.create");
  if (isResponse(user)) return user;
  const createLimit = checkRateLimit(request, "project.create", user.id, 30, 60 * 1000);
  if (!createLimit.allowed) return tooManyRequests(createLimit, "项目创建请求过于频繁，请稍后再试。");

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
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const stage = typeof body.stage === "string" ? body.stage.trim() : "";
  const priority = body.priority === undefined ? "medium" : body.priority;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const progress = typeof body.progress === "string" ? body.progress.trim() : "";
  const progressPercent = body.progressPercent === undefined ? 0 : parseProgressPercent(body.progressPercent);
  const plannedEndDate = typeof body.plannedEndDate === "string" ? body.plannedEndDate.trim() : "";
  const blockers = stringList(body.blockers, 10, 300);
  const sources = stringList(body.sources, 10, 200);
  if (name.length < 2 || name.length > 120) return error("项目名称需要为 2-120 个字符。");
  if (category.length > 80) return error("项目类型不能超过 80 个字符。");
  if (stage.length < 1 || stage.length > 120) return error("项目阶段不能为空，且不能超过 120 个字符。");
  if (!isProjectPriority(priority)) return error("项目优先级无效。");
  if (description.length > 1000) return error("项目说明不能超过 1000 个字符。");
  if (progress.length > 2000) return error("项目进度不能超过 2000 个字符。");
  if (progressPercent === null) return error("完成比例无效。");
  if (plannedEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(plannedEndDate)) return error("计划完成日期格式不正确。");
  if (!blockers || !sources) return error("阻塞项和来源需要是有效的文本列表。");

  const db = getDb();
  const requestedStatusId = typeof body.statusId === "string" ? body.statusId : "";
  const statusId = requestedStatusId || await firstActiveStatusId(user.teamId);
  if (!statusId) return error("当前团队还没有可用的项目状态。", 409);
  const [status] = await db.select({ id: projectStatuses.id }).from(projectStatuses)
    .where(and(eq(projectStatuses.id, statusId), eq(projectStatuses.teamId, user.teamId), eq(projectStatuses.isActive, true)))
    .limit(1);
  if (!status) return error("项目状态无效。", 400);

  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();
  const writes = [
    db.insert(projects).values({
      id: projectId,
      teamId: user.teamId,
      name,
      category,
      stage,
      statusId,
      priority,
      plannedEndDate: plannedEndDate || null,
      description,
      progress,
      progressPercent,
      blockers: JSON.stringify(blockers),
      ownerUserId: user.id,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  ];
  if (sources.length) {
    writes.push(db.insert(projectSources).values(sources.map((title) => ({
      id: crypto.randomUUID(),
      projectId,
      teamId: user.teamId,
      title,
      sourceType: "manual",
      reference: null,
      createdBy: user.id,
      createdAt: now,
    }))));
  }
  writes.push(db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    teamId: user.teamId,
    userId: user.id,
    action: "project.create",
    resourceType: "project",
    resourceId: projectId,
    result: "success",
    createdAt: now,
  }));
  await db.batch(writes);

  return Response.json({ projectId }, { status: 201 });
}
