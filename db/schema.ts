import * as postgresSchema from "./postgres-schema";
import * as sqliteSchema from "./sqlite-schema";

// Keep the existing D1 path available during the migration window. Node/Vinext
// deployments opt into PostgreSQL by setting DATABASE_URL; Cloudflare previews
// without that variable continue to use the legacy SQLite/D1 schema.
const runtimeProcess = typeof globalThis === "object" ? Reflect.get(globalThis, "process") : undefined;
const runtimeEnv = runtimeProcess && typeof runtimeProcess === "object"
  ? Reflect.get(runtimeProcess, "env")
  : undefined;
const activeSchema = runtimeEnv && typeof runtimeEnv === "object" && Boolean(Reflect.get(runtimeEnv, "DATABASE_URL"))
  ? postgresSchema
  : sqliteSchema;

export const organizations = activeSchema.organizations as typeof sqliteSchema.organizations;
export const teams = activeSchema.teams as typeof sqliteSchema.teams;
export const users = activeSchema.users as typeof sqliteSchema.users;
export const teamRoles = activeSchema.teamRoles as typeof sqliteSchema.teamRoles;
export const sessions = activeSchema.sessions as typeof sqliteSchema.sessions;
export const projectStatuses = activeSchema.projectStatuses as typeof sqliteSchema.projectStatuses;
export const projects = activeSchema.projects as typeof sqliteSchema.projects;
export const projectSources = activeSchema.projectSources as typeof sqliteSchema.projectSources;
export const auditLogs = activeSchema.auditLogs as typeof sqliteSchema.auditLogs;
export const incidents = activeSchema.incidents as typeof sqliteSchema.incidents;
