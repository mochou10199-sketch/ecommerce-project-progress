import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, localDatabasePath } from "../../../../../db";
import { auditLogs, documentChunks, projectDocuments, projectSources, projects } from "../../../../../db/schema";
import { isResponse, requirePermission } from "../../../../lib/permissions";
import { checkRateLimit, tooManyRequests } from "../../../../lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 500_000;
const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json"]);

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function extractText(bytes: Uint8Array, extension: string) {
  if (bytes.includes(0)) throw new Error("文件看起来不是可读取的文本文件。");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("文件内容为空，无法建立资料索引。");
  if (extension === ".json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw new Error("JSON 文件格式不正确。");
    }
  }
  return text;
}

function splitIntoChunks(text: string) {
  const chunks: string[] = [];
  const size = 1800;
  const overlap = 150;
  for (let start = 0; start < text.length; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
    if (chunks.length >= 400) break;
  }
  return chunks;
}

export async function GET(request: Request, context: RouteContext) {
  const user = await requirePermission(request, "project.view");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const rows = await getDb().select({
    id: projectDocuments.id,
    originalName: projectDocuments.originalName,
    mimeType: projectDocuments.mimeType,
    sizeBytes: projectDocuments.sizeBytes,
    status: projectDocuments.status,
    extractedChars: projectDocuments.extractedChars,
    errorMessage: projectDocuments.errorMessage,
    createdAt: projectDocuments.createdAt,
  }).from(projectDocuments)
    .where(and(eq(projectDocuments.projectId, id), eq(projectDocuments.teamId, user.teamId)))
    .orderBy(desc(projectDocuments.createdAt));
  return Response.json({ documents: rows });
}

export async function POST(request: Request, context: RouteContext) {
  const user = await requirePermission(request, "project.edit");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const limit = checkRateLimit(request, "project.document.upload", user.id, 20, 10 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit, "文件上传过于频繁，请稍后再试。");

  const [project] = await getDb().select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, id), eq(projects.teamId, user.teamId), isNull(projects.archivedAt)))
    .limit(1);
  if (!project) return error("项目不存在。", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("请使用 multipart/form-data 上传文件。", 415);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return error("请选择要上传的文件。", 400);
  if (file.size <= 0) return error("文件内容为空。", 400);
  if (file.size > MAX_FILE_BYTES) return error("单个文件不能超过 10 MB。", 413);

  const originalName = basename(file.name).trim();
  const extension = originalName.slice(originalName.lastIndexOf(".")).toLowerCase();
  if (!originalName || !ALLOWED_EXTENSIONS.has(extension)) {
    return error("当前支持 TXT、MD、CSV 和 JSON 文件。", 415);
  }

  const documentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const storedName = `${documentId}${extension}`;
  const dataDir = join(dirname(localDatabasePath()), "uploads", user.teamId, id);
  const storedPath = join(dataDir, storedName);
  let bytes: Uint8Array;
  let extractedText: string;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    extractedText = extractText(bytes, extension);
    if (extractedText.length > MAX_EXTRACTED_CHARS) {
      return error("文件解析后的文字不能超过 500,000 个字符。", 413);
    }
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : "文件解析失败。", 422);
  }

  const chunks = splitIntoChunks(extractedText);
  if (!chunks.length) return error("没有可建立索引的文字内容。", 422);
  await mkdir(dataDir, { recursive: true });
  try {
    await writeFile(storedPath, bytes, { flag: "wx" });
    const db = getDb();
    await db.batch([
      db.insert(projectDocuments).values({
        id: documentId,
        projectId: id,
        teamId: user.teamId,
        originalName,
        storedName,
        mimeType: file.type || "text/plain",
        sizeBytes: file.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        status: "indexed",
        extractedChars: extractedText.length,
        errorMessage: null,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(documentChunks).values(chunks.map((content, chunkIndex) => ({
        id: crypto.randomUUID(),
        documentId,
        projectId: id,
        teamId: user.teamId,
        chunkIndex,
        content,
        searchText: content.toLocaleLowerCase("zh-CN"),
        createdAt: now,
      }))),
      db.insert(projectSources).values({
        id: crypto.randomUUID(),
        projectId: id,
        teamId: user.teamId,
        title: originalName,
        sourceType: "upload",
        reference: `document:${documentId}`,
        createdBy: user.id,
        createdAt: now,
      }),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        teamId: user.teamId,
        userId: user.id,
        action: "project.document.upload",
        resourceType: "project_document",
        resourceId: documentId,
        result: "indexed",
        createdAt: now,
      }),
    ]);
  } catch (reason) {
    await rm(storedPath, { force: true });
    console.error("local document upload failed", reason instanceof Error ? reason.message : reason);
    return error("文件已经解析，但保存到本地资料库失败。", 500);
  }

  return Response.json({
    document: { id: documentId, originalName, status: "indexed", extractedChars: extractedText.length, createdAt: now },
  }, { status: 201 });
}
