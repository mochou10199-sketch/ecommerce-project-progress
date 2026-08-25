import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, organizations, projectSources, projectStatuses, projects, teamRoles, teams, users } from "../../../../db/schema";
import { getOwner, isResponse } from "../../../lib/permissions";
import { checkRateLimit, tooManyRequests } from "../../../lib/rate-limit";
import { parseStoredPermissions } from "../../../lib/role-options";

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const exportLimit = checkRateLimit(request, "team.export", owner.id, 3, 10 * 60 * 1000);
  if (!exportLimit.allowed) return tooManyRequests(exportLimit, "运营快照导出过于频繁，请稍后再试。");

  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    teamId: owner.teamId,
    userId: owner.id,
    action: "team.export",
    resourceType: "team_snapshot",
    resourceId: owner.teamId,
    result: "success",
    createdAt: now,
  });

  const [teamRows, memberRows, statusRows, projectRows, sourceRows, auditRows] = await Promise.all([
    db.select({
      id: teams.id,
      name: teams.name,
      code: teams.code,
      status: teams.status,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
      organizationId: teams.organizationId,
      organizationName: organizations.name,
    }).from(teams)
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(eq(teams.id, owner.teamId))
      .limit(1),
    db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.teamId, owner.teamId)),
    db.select({
      id: projectStatuses.id,
      code: projectStatuses.code,
      name: projectStatuses.name,
      color: projectStatuses.color,
      sortOrder: projectStatuses.sortOrder,
      isActive: projectStatuses.isActive,
      createdAt: projectStatuses.createdAt,
      updatedAt: projectStatuses.updatedAt,
    }).from(projectStatuses).where(eq(projectStatuses.teamId, owner.teamId)),
    db.select({
      id: projects.id,
      teamId: projects.teamId,
      name: projects.name,
      category: projects.category,
      stage: projects.stage,
      statusId: projects.statusId,
      priority: projects.priority,
      plannedEndDate: projects.plannedEndDate,
      description: projects.description,
      progress: projects.progress,
      progressPercent: projects.progressPercent,
      blockers: projects.blockers,
      ownerUserId: projects.ownerUserId,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    }).from(projects).where(eq(projects.teamId, owner.teamId)),
    db.select({
      id: projectSources.id,
      projectId: projectSources.projectId,
      title: projectSources.title,
      sourceType: projectSources.sourceType,
      reference: projectSources.reference,
      createdBy: projectSources.createdBy,
      createdAt: projectSources.createdAt,
    }).from(projectSources).where(eq(projectSources.teamId, owner.teamId)),
    db.select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      result: auditLogs.result,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .where(eq(auditLogs.teamId, owner.teamId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1000),
  ]);

  let roleRows: Array<{ id: string; code: string; name: string; description: string; permissions: string[]; isSystem: boolean; isActive: boolean; createdAt: string; updatedAt: string }> = [];
  try {
    const rows = await db.select().from(teamRoles).where(eq(teamRoles.teamId, owner.teamId));
    roleRows = rows.map((role) => ({ ...role, permissions: parseStoredPermissions(role.permissions) }));
  } catch {
    // The pre-0005 compatibility window has no role table yet.
  }

  const team = teamRows[0] ?? null;
  const payload = {
    format: "ecommerce-project-progress-team-snapshot",
    version: 1,
    generatedAt: now,
    note: "此运营快照不包含密码、密码哈希、会话令牌；不能替代 Cloudflare D1 生产备份。",
    team,
    members: memberRows,
    roles: roleRows,
    statuses: statusRows,
    projects: projectRows,
    sources: sourceRows,
    auditLogs: auditRows,
  };
  const fileStamp = now.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return new Response(JSON.stringify(payload), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="team-snapshot-${fileStamp}.json"`,
    },
  });
}
