import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull(),
  status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ slugUnique: uniqueIndex("organizations_slug_unique").on(table.slug) }));

export const teams = pgTable("teams", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), name: text("name").notNull(), code: text("code").notNull(),
  status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ codeUnique: uniqueIndex("teams_code_unique").on(table.code), organizationIndex: index("teams_organization_id_idx").on(table.organizationId) }));

export const users = pgTable("users", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), username: text("username").notNull(), passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull().default("member"), status: text("status").notNull().default("active"), mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLoginCount: integer("failed_login_count").notNull().default(0), lockedUntil: text("locked_until"), lastLoginAt: text("last_login_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ teamUsernameUnique: uniqueIndex("users_team_username_unique").on(table.teamId, table.username), teamIndex: index("users_team_id_idx").on(table.teamId) }));

export const teamRoles = pgTable("team_roles", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), code: text("code").notNull(), name: text("name").notNull(), description: text("description").notNull().default(""), permissions: text("permissions").notNull().default("[]"),
  isSystem: boolean("is_system").notNull().default(false), isActive: boolean("is_active").notNull().default(true), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ teamCodeUnique: uniqueIndex("team_roles_team_code_unique").on(table.teamId, table.code), teamIndex: index("team_roles_team_id_idx").on(table.teamId) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), teamId: text("team_id").notNull(), tokenHash: text("token_hash").notNull(), expiresAt: text("expires_at").notNull(), revokedAt: text("revoked_at"), createdAt: text("created_at").notNull(),
}, (table) => ({ tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash), teamIndex: index("sessions_team_id_idx").on(table.teamId) }));

export const projectStatuses = pgTable("project_statuses", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), code: text("code").notNull(), name: text("name").notNull(), color: text("color").notNull().default("#64748b"), sortOrder: integer("sort_order").notNull().default(0), isActive: boolean("is_active").notNull().default(true), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ teamCodeUnique: uniqueIndex("project_statuses_team_code_unique").on(table.teamId, table.code), teamNameUnique: uniqueIndex("project_statuses_team_name_unique").on(table.teamId, table.name), teamIndex: index("project_statuses_team_id_idx").on(table.teamId) }));

export const projects = pgTable("projects", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), name: text("name").notNull(), category: text("category").notNull().default(""), stage: text("stage").notNull(), statusId: text("status_id").notNull(), priority: text("priority").notNull().default("medium"), plannedEndDate: text("planned_end_date"), description: text("description").notNull().default(""), progress: text("progress").notNull().default(""), progressPercent: integer("progress_percent").notNull().default(0), blockers: text("blockers").notNull().default("[]"), ownerUserId: text("owner_user_id"), archivedAt: text("archived_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ teamIndex: index("projects_team_id_idx").on(table.teamId), teamStatusIndex: index("projects_team_status_idx").on(table.teamId, table.statusId) }));

export const projectSources = pgTable("project_sources", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), teamId: text("team_id").notNull(), title: text("title").notNull(), sourceType: text("source_type").notNull().default("manual"), reference: text("reference"), createdBy: text("created_by"), createdAt: text("created_at").notNull(),
}, (table) => ({ projectIndex: index("project_sources_project_id_idx").on(table.projectId), teamIndex: index("project_sources_team_id_idx").on(table.teamId) }));

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), userId: text("user_id"), action: text("action").notNull(), resourceType: text("resource_type").notNull(), resourceId: text("resource_id"), result: text("result").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ teamIndex: index("audit_logs_team_id_idx").on(table.teamId) }));

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), code: text("code").notNull(), severity: text("severity").notNull().default("P2"), status: text("status").notNull().default("open"), title: text("title").notNull(), impact: text("impact").notNull().default(""), description: text("description").notNull().default(""), temporaryAction: text("temporary_action").notNull().default(""), createdBy: text("created_by"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), closedAt: text("closed_at"),
}, (table) => ({ teamCodeUnique: uniqueIndex("incidents_team_code_unique").on(table.teamId, table.code), teamIndex: index("incidents_team_id_idx").on(table.teamId), teamStatusIndex: index("incidents_team_status_idx").on(table.teamId, table.status) }));
