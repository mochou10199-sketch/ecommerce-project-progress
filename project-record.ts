import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { projectSources, projectStatuses, projects, users } from "../../db/schema";

export type ProjectRecord = {
  id: string;
  name: string;
  category: string;
  stage: string;
  statusId: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  priority: string;
  plannedEndDate: string;
  description: string;
  progress: string;
  progressPercent: number;
  blockers: string[];
  owner: string;
  ownerUserId: string | null;
  lastUpdated: string;
  sources: string[];
};

function parseBlockers(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function sourceMap(teamId: string) {
  const rows = await getDb().select({ projectId: projectSources.projectId, title: projectSources.title })
    .from(projectSources)
    .where(eq(projectSources.teamId, teamId));
  return rows.reduce<Map<string, string[]>>((map, row) => {
    const existing = map.get(row.projectId) ?? [];
    existing.push(row.title);
    map.set(row.projectId, existing);
    return map;
  }, new Map());
}

function makeRecord(row: {
  project: typeof projects.$inferSelect;
  status: typeof projectStatuses.$inferSelect | null;
  owner: typeof users.$inferSelect | null;
}, sources: Map<string, string[]>): ProjectRecord {
  return {
    id: row.project.id,
    name: row.project.name,
    category: row.project.category,
    stage: row.project.stage,
    statusId: row.project.statusId,
    status: row.status?.code ?? "unknown",
    statusLabel: row.status?.name ?? "信息不足",
    statusColor: row.status?.color ?? "#64748b",
    priority: row.project.priority,
    plannedEndDate: row.project.plannedEndDate ?? "未设置",
    description: row.project.description,
    progress: row.project.progress,
    progressPercent: row.project.progressPercent,
    blockers: parseBlockers(row.project.blockers),
    owner: row.owner?.username ?? "未指定",
    ownerUserId: row.project.ownerUserId,
    lastUpdated: row.project.updatedAt,
    sources: sources.get(row.project.id) ?? [],
  };
}

export async function listProjectRecords(teamId: string) {
  const rows = await getDb().select({ project: projects, status: projectStatuses, owner: users })
    .from(projects)
    .leftJoin(projectStatuses, and(eq(projects.statusId, projectStatuses.id), eq(projects.teamId, projectStatuses.teamId)))
    .leftJoin(users, and(eq(projects.ownerUserId, users.id), eq(projects.teamId, users.teamId)))
    .where(and(eq(projects.teamId, teamId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.updatedAt));
  const sources = await sourceMap(teamId);
  return rows.map((row) => makeRecord(row, sources));
}

export async function getProjectRecord(teamId: string, projectId: string) {
  const [row] = await getDb().select({ project: projects, status: projectStatuses, owner: users })
    .from(projects)
    .leftJoin(projectStatuses, and(eq(projects.statusId, projectStatuses.id), eq(projects.teamId, projectStatuses.teamId)))
    .leftJoin(users, and(eq(projects.ownerUserId, users.id), eq(projects.teamId, users.teamId)))
    .where(and(eq(projects.teamId, teamId), eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  if (!row) return null;
  return makeRecord(row, await sourceMap(teamId));
}

export async function firstActiveStatusId(teamId: string) {
  const [status] = await getDb().select({ id: projectStatuses.id })
    .from(projectStatuses)
    .where(and(eq(projectStatuses.teamId, teamId), eq(projectStatuses.isActive, true)))
    .orderBy(asc(projectStatuses.sortOrder))
    .limit(1);
  return status?.id ?? null;
}
