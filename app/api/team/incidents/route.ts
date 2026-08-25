import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, incidents, users } from "../../../../db/schema";
import { incidentResponseDueAt, incidentResponseState, isIncidentSeverity, isIncidentStatus, type IncidentSeverity, type IncidentStatus } from "../../../lib/incident-options";
import { getOwner, isResponse } from "../../../lib/permissions";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const rows = await getDb().select({
    id: incidents.id,
    code: incidents.code,
    severity: incidents.severity,
    status: incidents.status,
    title: incidents.title,
    impact: incidents.impact,
    description: incidents.description,
    temporaryAction: incidents.temporaryAction,
    createdAt: incidents.createdAt,
    updatedAt: incidents.updatedAt,
    closedAt: incidents.closedAt,
    createdByUsername: users.username,
  }).from(incidents)
    .leftJoin(users, eq(incidents.createdBy, users.id))
    .where(eq(incidents.teamId, owner.teamId))
    .orderBy(desc(incidents.updatedAt))
    .limit(100);
  const responseRows = rows.map((row) => {
    const severity = isIncidentSeverity(row.severity) ? row.severity : "P2" as IncidentSeverity;
    const status = isIncidentStatus(row.status) ? row.status : "open" as IncidentStatus;
    return {
      ...row,
      responseDueAt: incidentResponseDueAt(row.createdAt, severity),
      responseState: incidentResponseState(status, row.createdAt, severity),
    };
  });
  return Response.json({ incidents: responseRows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const body = await request.json().catch(() => ({})) as {
    severity?: unknown;
    title?: unknown;
    impact?: unknown;
    description?: unknown;
    temporaryAction?: unknown;
  };
  const severity = body.severity === undefined ? "P2" : body.severity;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const impact = typeof body.impact === "string" ? body.impact.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const temporaryAction = typeof body.temporaryAction === "string" ? body.temporaryAction.trim() : "";
  if (!isIncidentSeverity(severity)) return error("事件等级无效。");
  if (title.length < 2 || title.length > 120) return error("事件标题需要为 2-120 个字符。");
  if (impact.length > 300) return error("影响范围不能超过 300 个字符。");
  if (description.length > 2000) return error("事件描述不能超过 2000 个字符。");
  if (temporaryAction.length > 1000) return error("临时措施不能超过 1000 个字符。");

  const now = new Date().toISOString();
  const day = now.slice(0, 10).replaceAll("-", "");
  const incident = {
    id: crypto.randomUUID(),
    teamId: owner.teamId,
    code: `INC-${day}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    severity,
    status: "open" as const,
    title,
    impact,
    description,
    temporaryAction,
    createdBy: owner.id,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
  const db = getDb();
  await db.batch([
    db.insert(incidents).values(incident),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "incident.create", resourceType: "incident", resourceId: incident.id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ incident }, { status: 201 });
}
