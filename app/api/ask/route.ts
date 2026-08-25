import { and, eq } from "drizzle-orm";
import { documentChunks, getDb, projectDocuments } from "../../../db";
import { isResponse, requirePermission } from "../../lib/permissions";
import { listProjectRecords } from "../../lib/project-record";
import { resolveProjectQuestion, searchDocumentRows } from "../../lib/project-query";
import { checkRateLimit, tooManyRequests } from "../../lib/rate-limit";
import type { Project } from "../../lib/project-data";

function toProject(record: Awaited<ReturnType<typeof listProjectRecords>>[number]): Project {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    keywords: [record.name, record.stage],
    status: record.status,
    stage: record.stage,
    priority: record.priority,
    plannedEndDate: record.plannedEndDate,
    description: record.description,
    progress: record.progress,
    progressPercent: record.progressPercent,
    blockers: record.blockers,
    owner: record.owner,
    lastUpdated: record.lastUpdated,
    sources: record.sources,
  };
}

export async function POST(request: Request) {
  const user = await requirePermission(request, "project.view");
  if (isResponse(user)) return user;
  const queryLimit = checkRateLimit(request, "project.ask", user.id, 60, 60 * 1000);
  if (!queryLimit.allowed) return tooManyRequests(queryLimit, "查询请求过于频繁，请稍后再试。");

  const body = await request.json().catch(() => ({})) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) {
    return Response.json({ error: "请输入不超过 500 个字符的项目问题。" }, { status: 400 });
  }

  const documentRows = await getDb().select({
    projectId: documentChunks.projectId,
    documentId: documentChunks.documentId,
    title: projectDocuments.originalName,
    content: documentChunks.content,
    searchText: documentChunks.searchText,
  }).from(documentChunks)
    .innerJoin(projectDocuments, and(
      eq(documentChunks.documentId, projectDocuments.id),
      eq(projectDocuments.teamId, user.teamId),
    ))
    .where(eq(documentChunks.teamId, user.teamId));
  const result = resolveProjectQuestion(
    question,
    (await listProjectRecords(user.teamId)).map(toProject),
    searchDocumentRows(question, documentRows),
  );
  return Response.json({
    result,
    assistantText: result.summary,
    mode: "local",
  });
}
