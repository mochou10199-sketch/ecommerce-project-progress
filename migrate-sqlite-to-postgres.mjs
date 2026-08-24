import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

function runCommand(file, args, { input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `命令退出码 ${code}`));
      else resolve({ stdout, stderr });
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

const tables = [
  "organizations",
  "teams",
  "users",
  "team_roles",
  "sessions",
  "project_statuses",
  "projects",
  "project_sources",
  "audit_logs",
  "incidents",
];
const columns = {
  organizations: ["id", "name", "slug", "status", "created_at", "updated_at"],
  teams: ["id", "organization_id", "name", "code", "status", "created_at", "updated_at"],
  users: ["id", "team_id", "username", "password_hash", "password_salt", "role", "status", "must_change_password", "failed_login_count", "locked_until", "last_login_at", "created_at", "updated_at"],
  team_roles: ["id", "team_id", "code", "name", "description", "permissions", "is_system", "is_active", "created_at", "updated_at"],
  sessions: ["id", "user_id", "team_id", "token_hash", "expires_at", "revoked_at", "created_at"],
  project_statuses: ["id", "team_id", "code", "name", "color", "sort_order", "is_active", "created_at", "updated_at"],
  projects: ["id", "team_id", "name", "category", "stage", "status_id", "priority", "planned_end_date", "description", "progress", "progress_percent", "blockers", "owner_user_id", "archived_at", "created_at", "updated_at"],
  project_sources: ["id", "project_id", "team_id", "title", "source_type", "reference", "created_by", "created_at"],
  audit_logs: ["id", "team_id", "user_id", "action", "resource_type", "resource_id", "result", "created_at"],
  incidents: ["id", "team_id", "code", "severity", "status", "title", "impact", "description", "temporary_action", "created_by", "created_at", "updated_at", "closed_at"],
};
const booleanColumns = new Set(["must_change_password", "is_system", "is_active"]);

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonOutput(output) {
  const text = output.stdout.trim();
  return text ? JSON.parse(text) : [];
}

function normalizeValue(column, value) {
  if (!booleanColumns.has(column)) return value;
  return value === true || value === 1 || value === "1";
}

async function runSqlite(databasePath, query) {
  return runCommand("sqlite3", ["-json", databasePath, query]);
}

async function materializeDump(dumpPath, tempRoot) {
  const sqlitePath = path.join(tempRoot, "source.sqlite");
  const dump = await readFile(dumpPath, "utf8");
  await runCommand("sqlite3", [sqlitePath], { input: dump });
  return sqlitePath;
}

const sourceArgument = getArgument("--sqlite") ?? process.env.SQLITE_SOURCE_PATH;
const dumpArgument = getArgument("--dump") ?? process.env.SQLITE_DUMP_PATH;
const databaseUrl = getArgument("--database-url") ?? process.env.DATABASE_URL ?? "postgres://localhost/ecommerce_progress_migration_local";
const allowRemote = process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_MIGRATION === "1";
requireCheck(Boolean(sourceArgument || dumpArgument), "请提供 --sqlite <SQLite文件> 或 --dump <D1导出SQL文件>。");

let targetUrl;
try {
  targetUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL 不是有效的 PostgreSQL 连接串。");
}
const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(targetUrl.hostname);
requireCheck(isLocalTarget || allowRemote, "目标不是本机数据库；如已完成备份并确认迁移，请显式添加 --allow-remote。");

const tempRoot = await mkdtemp(path.join(tmpdir(), "ecommerce-sqlite-migration-"));
let sourcePath = sourceArgument;
try {
  if (dumpArgument) sourcePath = await materializeDump(dumpArgument, tempRoot);
  await access(sourcePath);

  const tableRows = parseJsonOutput(await runSqlite(sourcePath, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name;"));
  const sourceTables = new Set(tableRows.map((row) => row.name));
  const missingRequired = tables.filter((table) => table !== "team_roles" && !sourceTables.has(table));
  requireCheck(missingRequired.length === 0, `SQLite/D1 来源缺少核心表：${missingRequired.join(", ")}`);

  const sourceRows = {};
  for (const table of tables) {
    if (!sourceTables.has(table)) {
      sourceRows[table] = [];
      continue;
    }
    sourceRows[table] = parseJsonOutput(await runSqlite(sourcePath, `SELECT * FROM "${table}";`));
  }

  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const targetCounts = await Promise.all(tables.map(async (table) => {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
      return { table, count: Number(row.count) };
    }));
    const occupied = targetCounts.filter((item) => item.count > 0);
    requireCheck(occupied.length === 0, `目标 PostgreSQL 已有数据，已停止以避免覆盖：${occupied.map((item) => `${item.table}=${item.count}`).join(", ")}`);

    await sql.begin(async (transaction) => {
      for (const table of tables) {
        const rows = sourceRows[table];
        if (rows.length === 0) continue;
        const tableColumns = columns[table];
        const columnSql = tableColumns.map((column) => `"${column}"`).join(", ");
        const placeholders = tableColumns.map((_, index) => `$${index + 1}`).join(", ");
        for (const row of rows) {
          const values = tableColumns.map((column) => normalizeValue(column, row[column] ?? null));
          await transaction.unsafe(`INSERT INTO "${table}" (${columnSql}) VALUES (${placeholders})`, values);
        }
      }

      // Production D1 may predate team_roles. Recreate the two built-in roles
      // for every imported team so the existing permission model remains usable.
      await transaction.unsafe(`
        INSERT INTO "team_roles" ("id", "team_id", "code", "name", "description", "permissions", "is_system", "is_active", "created_at", "updated_at")
        SELECT md5(t."id" || ':owner'), t."id", 'owner', '团队母账号', '管理团队、成员、项目状态和全部项目。', '["project.view","project.create","project.edit","project.archive","team.manage"]', true, true, t."created_at", t."updated_at"
        FROM "teams" t
        ON CONFLICT ("team_id", "code") DO NOTHING
      `);
      await transaction.unsafe(`
        INSERT INTO "team_roles" ("id", "team_id", "code", "name", "description", "permissions", "is_system", "is_active", "created_at", "updated_at")
        SELECT md5(t."id" || ':member'), t."id", 'member', '团队成员', '查看、创建和编辑当前团队项目。', '["project.view","project.create","project.edit"]', true, true, t."created_at", t."updated_at"
        FROM "teams" t
        ON CONFLICT ("team_id", "code") DO NOTHING
      `);
    });

    const finalCounts = await Promise.all(tables.map(async (table) => {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
      return { table, count: Number(row.count) };
    }));
    console.log(JSON.stringify({
      source: sourcePath,
      target: `${targetUrl.hostname}${targetUrl.pathname}`,
      sourceTables: [...sourceTables].sort(),
      importedRows: finalCounts,
      legacyTeamRolesSeeded: !sourceTables.has("team_roles"),
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
