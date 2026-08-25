import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditLogs, incidents } from "../../../../../db/schema";
import { isIncidentSeverity, isIncidentStatus } from "../../../../lib/incident-options";
import { getOwner, isResponse } from "../../../../lib/permissions";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const { id } = await context.params;
  const db = getDb();
  const [current] = await db.select().from(incidents)
    .where(and(eq(incidents.id, id), eq(incidents.teamId, owner.teamId))).limit(1);
  if (!current) return error("事件不存在。", 404);

  const body = await request.json().catch(() => ({})) as {
    severity?: unknown;
    status?: unknown;
  };
  const severity = body.severity === undefined ? current.severity : body.severity;
  const status = body.status === undefined ? current.status : body.status;
  if (!isIncidentSeverity(severity)) return error("事件等级无效。");
  if (!isIncidentStatus(status)) return error("事件状态无效。");
  const now = new Date().toISOString();
  const closedAt = status === "resolved" ? current.closedAt ?? now : null;
  await db.batch([
    db.update(incidents).set({ severity, status, updatedAt: now, closedAt }).where(and(eq(incidents.id, id), eq(incidents.teamId, owner.teamId))),
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), teamId: owner.teamId, userId: owner.id,
      action: "incident.update", resourceType: "incident", resourceId: id,
      result: "success", createdAt: now,
    }),
  ]);
  return Response.json({ incident: { ...current, severity, status, updatedAt: now, closedAt } });
}
