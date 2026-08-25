import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle as drizzleSqliteProxy } from "drizzle-orm/sqlite-proxy";
import type { SQL } from "drizzle-orm";
import * as schema from "./sqlite-schema";

type QueryBuilder = { toSQL(): { sql: string; params: unknown[] } };

type LocalDatabase = ReturnType<typeof drizzleSqliteProxy> & {
  batch(writes: QueryBuilder[]): Promise<unknown[]>;
};

const LOCAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS teams_organization_id_idx ON teams (organization_id);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (team_id, username)
);
CREATE INDEX IF NOT EXISTS users_team_id_idx ON users (team_id);
CREATE TABLE IF NOT EXISTS team_roles (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (team_id, code)
);
CREATE INDEX IF NOT EXISTS team_roles_team_id_idx ON team_roles (team_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_team_id_idx ON sessions (team_id);
CREATE TABLE IF NOT EXISTS project_statuses (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (team_id, code),
  UNIQUE (team_id, name)
);
CREATE INDEX IF NOT EXISTS project_statuses_team_id_idx ON project_statuses (team_id);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  status_id TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  planned_end_date TEXT,
  description TEXT NOT NULL DEFAULT '',
  progress TEXT NOT NULL DEFAULT '',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  blockers TEXT NOT NULL DEFAULT '[]',
  owner_user_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_team_id_idx ON projects (team_id);
CREATE INDEX IF NOT EXISTS projects_team_status_idx ON projects (team_id, status_id);
CREATE TABLE IF NOT EXISTS project_sources (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  reference TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_sources_project_id_idx ON project_sources (project_id);
CREATE INDEX IF NOT EXISTS project_sources_team_id_idx ON project_sources (team_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_team_id_idx ON audit_logs (team_id);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'P2',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  temporary_action TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE (team_id, code)
);
CREATE INDEX IF NOT EXISTS incidents_team_id_idx ON incidents (team_id);
CREATE INDEX IF NOT EXISTS incidents_team_status_idx ON incidents (team_id, status);
CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'indexed',
  extracted_chars INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_documents_project_id_idx ON project_documents (project_id);
CREATE INDEX IF NOT EXISTS project_documents_team_id_idx ON project_documents (team_id);
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS document_chunks_project_id_idx ON document_chunks (project_id);
CREATE INDEX IF NOT EXISTS document_chunks_team_id_idx ON document_chunks (team_id);
`;

function runtimeEnv() {
  const runtimeProcess = typeof globalThis === "object" ? Reflect.get(globalThis, "process") : undefined;
  const env = runtimeProcess && typeof runtimeProcess === "object" ? Reflect.get(runtimeProcess, "env") : undefined;
  return env && typeof env === "object" ? env as Record<string, unknown> : {};
}

export function localDatabasePath() {
  const configured = runtimeEnv().LOCAL_DB_PATH;
  return resolve(typeof configured === "string" && configured.trim() ? configured : "data/ecommerce-progress.sqlite");
}

function normalizeParams(params: unknown[]) {
  return params.map((value) => value === undefined ? null : value);
}

function buildLocalDatabase() {
  const path = localDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec(LOCAL_SCHEMA_SQL);

  const execute = async (sql: string, params: unknown[], method: "run" | "all" | "values" | "get") => {
    const statement = sqlite.prepare(sql);
    const values = normalizeParams(params);
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    const columns = statement.columns().map((column) => column.name);
    const toValues = (row: Record<string, unknown>) => columns.map((column) => row[column]);
    if (method === "get") {
      const row = statement.get(...values) as Record<string, unknown> | undefined;
      return { rows: row ? toValues(row) : undefined };
    }
    const rows = statement.all(...values) as Record<string, unknown>[];
    return { rows: rows.map(toValues) };
  };

  const remote = drizzleSqliteProxy(execute, undefined, { schema });
  const db = remote as LocalDatabase;
  db.batch = async (writes) => {
    sqlite.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const write of writes) {
        const query = write.toSQL();
        const statement = sqlite.prepare(query.sql);
        statement.run(...normalizeParams(query.params));
        results.push(undefined);
      }
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  return db;
}

let localDb: LocalDatabase | null = null;

export function getLocalDb() {
  if (!localDb) localDb = buildLocalDatabase();
  return localDb;
}

export function resetLocalDbForTests() {
  localDb = null;
}

export type LocalSql = SQL;
