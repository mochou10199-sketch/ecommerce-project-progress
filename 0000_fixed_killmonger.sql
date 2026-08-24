CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"result" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"code" text NOT NULL,
	"severity" text DEFAULT 'P2' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"temporary_action" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"closed_at" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"title" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"reference" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"stage" text NOT NULL,
	"status_id" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"planned_end_date" text,
	"description" text DEFAULT '' NOT NULL,
	"progress" text DEFAULT '' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"blockers" text DEFAULT '[]' NOT NULL,
	"owner_user_id" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text DEFAULT '[]' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"last_login_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_logs_team_id_idx" ON "audit_logs" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_team_code_unique" ON "incidents" USING btree ("team_id","code");--> statement-breakpoint
CREATE INDEX "incidents_team_id_idx" ON "incidents" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "incidents_team_status_idx" ON "incidents" USING btree ("team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_sources_project_id_idx" ON "project_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_sources_team_id_idx" ON "project_sources" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_statuses_team_code_unique" ON "project_statuses" USING btree ("team_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "project_statuses_team_name_unique" ON "project_statuses" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "project_statuses_team_id_idx" ON "project_statuses" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projects_team_id_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projects_team_status_idx" ON "projects" USING btree ("team_id","status_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_team_id_idx" ON "sessions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_roles_team_code_unique" ON "team_roles" USING btree ("team_id","code");--> statement-breakpoint
CREATE INDEX "team_roles_team_id_idx" ON "team_roles" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_code_unique" ON "teams" USING btree ("code");--> statement-breakpoint
CREATE INDEX "teams_organization_id_idx" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_team_username_unique" ON "users" USING btree ("team_id","username");--> statement-breakpoint
CREATE INDEX "users_team_id_idx" ON "users" USING btree ("team_id");