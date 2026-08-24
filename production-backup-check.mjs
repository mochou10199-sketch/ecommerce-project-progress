import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

const databaseName = process.env.PROD_D1_NAME?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const backupDirValue = process.env.BACKUP_DIR?.trim();
const workspaceDir = path.resolve(process.cwd());
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

function fail(message) {
  throw new Error(message);
}

if (!databaseName || !accountId || !apiToken || !backupDirValue) {
  fail("备份门禁需要 PROD_D1_NAME、CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN 和 BACKUP_DIR；脚本不会把它们写入文件或日志。");
}

const backupDir = path.resolve(backupDirValue);
const relativeToWorkspace = path.relative(workspaceDir, backupDir);
const isInsideWorkspace = relativeToWorkspace === "" || (!relativeToWorkspace.startsWith(`..${path.sep}`) && relativeToWorkspace !== ".." && !path.isAbsolute(relativeToWorkspace));
if (isInsideWorkspace) fail("BACKUP_DIR 不能位于项目目录内，避免把生产备份提交到 Git 或打包进站点。");

await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupFile = path.join(backupDir, `ecommerce-project-${stamp}.sql`);
try {
  await access(backupFile);
  fail(`备份文件已存在，拒绝覆盖：${backupFile}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const wranglerBin = process.env.WRANGLER_BIN?.trim() || path.join(workspaceDir, "node_modules/.bin/wrangler");
const child = spawn(wranglerBin, ["d1", "export", databaseName, "--remote", "--skip-confirmation", "--output", backupFile], {
  cwd: workspaceDir,
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
if (exitCode !== 0) {
  await unlink(backupFile).catch(() => {});
  fail(`D1 导出失败（退出码 ${exitCode}）：${(stderr || stdout).trim().slice(-1000)}`);
}

const backupText = await readFile(backupFile, "utf8");
const missingTables = requiredTables.filter((table) => !new RegExp("CREATE TABLE(?: IF NOT EXISTS)?\\s+[\\\"`]?" + table + "[\\\"`]?", "i").test(backupText));
if (missingTables.length) {
  await unlink(backupFile).catch(() => {});
  fail(`备份结构校验失败，缺少表：${missingTables.join(", ")}`);
}
const backupStats = await stat(backupFile);
if (!backupStats.size) {
  await unlink(backupFile).catch(() => {});
  fail("备份文件为空，已拒绝通过门禁。");
}

console.log(JSON.stringify({
  database: databaseName,
  backupFile,
  sizeBytes: backupStats.size,
  validatedTables: requiredTables,
  restoreExecuted: false,
}));
