import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/ecommerce_progress_migration_local";
const expectedTables = [
  "audit_logs",
  "incidents",
  "organizations",
  "project_sources",
  "project_statuses",
  "projects",
  "sessions",
  "team_roles",
  "teams",
  "users",
];
const requiredColumns = {
  users: ["failed_login_count", "locked_until", "must_change_password"],
  projects: ["category", "priority", "description", "progress_percent"],
  team_roles: ["code", "permissions", "is_system", "is_active"],
  incidents: ["severity", "status", "temporary_action", "closed_at"],
};
const requiredIndexes = [
  "teams_code_unique",
  "users_team_username_unique",
  "team_roles_team_code_unique",
  "projects_team_status_idx",
  "incidents_team_status_idx",
];

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function safeDatabaseName(urlValue) {
  try {
    const url = new URL(urlValue);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "configured database";
  }
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
try {
  const tableRows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const tables = tableRows.map((row) => row.table_name);
  const missingTables = expectedTables.filter((table) => !tables.includes(table));
  requireCheck(missingTables.length === 0, `PostgreSQL 缺少核心表：${missingTables.join(", ")}`);

  const columnRows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const columnsByTable = new Map();
  for (const row of columnRows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  const verifiedColumns = {};
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const present = columnsByTable.get(table) ?? new Set();
    const missing = columns.filter((column) => !present.has(column));
    requireCheck(missing.length === 0, `${table} 缺少核心字段：${missing.join(", ")}`);
    verifiedColumns[table] = columns;
  }

  const indexRows = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const indexes = indexRows.map((row) => row.indexname);
  const missingIndexes = requiredIndexes.filter((index) => !indexes.includes(index));
  requireCheck(missingIndexes.length === 0, `PostgreSQL 缺少核心索引：${missingIndexes.join(", ")}`);

  console.log(JSON.stringify({
    database: safeDatabaseName(databaseUrl),
    tables,
    verifiedColumns,
    verifiedIndexes: requiredIndexes,
  }));
} finally {
  await sql.end({ timeout: 5 });
}
