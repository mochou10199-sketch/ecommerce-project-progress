import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, projects, users } from "../../../../db/schema";
import { getOwner, isResponse } from "../../../lib/permissions";

function countValue(rows: Array<{ value: number | string | null | undefined }>) {
  return Number(rows[0]?.value ?? 0);
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;

  const db = getDb();
  const checkedAt = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [activeMembers, activeProjects, loginFailures, securityFailures, latestActivity, latestFailure] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(users)
      .where(and(eq(users.teamId, owner.teamId), eq(users.status, "active"))),
    db.select({ value: sql<number>`count(*)` }).from(projects)
      .where(and(eq(projects.teamId, owner.teamId), isNull(projects.archivedAt))),
    db.select({ value: sql<number>`count(*)` }).from(auditLogs)
      .where(and(
        eq(auditLogs.teamId, owner.teamId),
        eq(auditLogs.action, "auth.login_failed"),
        gte(auditLogs.createdAt, since),
      )),
    db.select({ value: sql<number>`count(*)` }).from(auditLogs)
      .where(and(
        eq(auditLogs.teamId, owner.teamId),
        ne(auditLogs.result, "success"),
        gte(auditLogs.createdAt, since),
      )),
    db.select({
      action: auditLogs.action,
      result: auditLogs.result,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .where(eq(auditLogs.teamId, owner.teamId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1),
    db.select({
      action: auditLogs.action,
      result: auditLogs.result,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .where(and(eq(auditLogs.teamId, owner.teamId), ne(auditLogs.result, "success")))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1),
  ]);

  return Response.json({
    checkedAt,
    activeMembers: countValue(activeMembers),
    activeProjects: countValue(activeProjects),
    loginFailures24h: countValue(loginFailures),
    securityFailures24h: countValue(securityFailures),
    latestActivity: latestActivity[0] ?? null,
    latestFailure: latestFailure[0] ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
