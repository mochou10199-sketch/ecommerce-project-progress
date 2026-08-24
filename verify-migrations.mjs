import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(projectDir, "node_modules", ".bin", "wrangler");
const config = path.join(projectDir, "dist", "server", "wrangler.json");
const databaseName = "site-creator-d1";
const migrationsDir = path.join(projectDir, "drizzle");
const requiredTables = [
  "organizations",
  "teams",
  "users",
  "team_roles",
  "sessions",
  "projects",
  "project_statuses",
  "project_sources",
  "audit_logs",
  "incidents",
];
const requiredColumns = {
  users: ["failed_login_count", "locked_until"],
  projects: ["category", "priority", "description", "progress_percent"],
  incidents: ["severity", "status", "temporary_action", "closed_at"],
  team_roles: ["code", "permissions", "is_system", "is_active"],
};

async function runWrangler(args, stateDir) {
  try {
    const result = await execFileAsync(wrangler, [
      "d1",
      "execute",
      databaseName,
      "--local",
      "--persist-to",
      stateDir,
      "--config",
      config,
      ...args,
    ], {
      cwd: projectDir,
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(stateDir, "wrangler.log") },
      maxBuffer: 8 * 1024 * 1024,
    });
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const stdout = error?.stdout ?? "";
    const stderr = error?.stderr ?? "";
    throw new Error(`Wrangler D1 本地迁移失败：${[stdout, stderr].filter(Boolean).join("\n")}`);
  }
}

function parseJsonOutput(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler 未返回可解析的 JSON 结果。");
  return JSON.parse(output.slice(start));
}

async function listMigrations() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  await access(wrangler);
  await access(config);
  const migrations = await listMigrations();
  if (migrations.length === 0) throw new Error("drizzle/ 下没有可执行的迁移文件。");

  const isolatedRoot = await mkdtemp(path.join(tmpdir(), "ecommerce-migrations-"));
  const stateDir = path.join(isolatedRoot, "state");
  try {
    for (const migration of migrations) {
      await runWrangler(["--file", path.join(migrationsDir, migration), "--yes"], stateDir);
    }

    // The latest migration is intentionally idempotent so a redeploy cannot fail if its table already exists.
    const lastMigration = migrations.at(-1);
    await runWrangler(["--file", path.join(migrationsDir, lastMigration), "--yes"], stateDir);

    const tableOutput = await runWrangler([
      "--command",
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name;",
      "--json",
    ], stateDir);
    const tableResult = parseJsonOutput(tableOutput).flatMap((batch) => batch.results ?? []);
    const tables = tableResult.map((row) => row.name).filter(Boolean);
    const missingTables = requiredTables.filter((table) => !tables.includes(table));
    if (missingTables.length > 0) throw new Error(`迁移后缺少核心表：${missingTables.join(", ")}`);

    const verifiedColumns = {};
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const output = await runWrangler([
        "--command",
        `PRAGMA table_info("${table}");`,
        "--json",
      ], stateDir);
      const rows = parseJsonOutput(output).flatMap((batch) => batch.results ?? []);
      const present = rows.map((row) => row.name).filter(Boolean);
      const missing = columns.filter((column) => !present.includes(column));
      if (missing.length > 0) throw new Error(`${table} 缺少核心字段：${missing.join(", ")}`);
      verifiedColumns[table] = columns;
    }

    console.log(JSON.stringify({
      database: databaseName,
      migrationFiles: migrations,
      reappliedLastMigration: lastMigration,
      tables,
      verifiedColumns,
      restoreExecuted: false,
    }));
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
