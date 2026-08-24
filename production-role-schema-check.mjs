import { spawn } from "node:child_process";
import path from "node:path";

const databaseName = process.env.PROD_D1_NAME?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const workspaceDir = path.resolve(process.cwd());
const requiredObjects = ["team_roles", "team_roles_team_code_unique", "team_roles_team_id_idx"];

function fail(message) {
  throw new Error(message);
}

if (!databaseName || !accountId || !apiToken) {
  fail("生产角色表检查需要 PROD_D1_NAME、CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN；脚本不会把它们写入文件或日志。");
}

const sql = [
  "SELECT name, type FROM sqlite_master",
  "WHERE (type = 'table' AND name = 'team_roles')",
  "OR (type = 'index' AND name IN ('team_roles_team_code_unique', 'team_roles_team_id_idx'))",
  "ORDER BY type, name;",
].join(" ");
const wranglerBin = process.env.WRANGLER_BIN?.trim() || path.join(workspaceDir, "node_modules/.bin/wrangler");
const child = spawn(wranglerBin, ["d1", "execute", databaseName, "--remote", "--json", "--command", sql], {
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
if (exitCode !== 0) fail(`生产角色表检查失败（退出码 ${exitCode}）：${(stderr || stdout).trim().slice(-1000)}`);

let payload;
try {
  payload = JSON.parse(stdout);
} catch {
  fail("生产角色表检查未返回可解析的 Wrangler JSON 结果。");
}

const verified = new Set();
function collect(value) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.name === "string" && requiredObjects.includes(value.name)) verified.add(value.name);
  for (const childValue of Object.values(value)) collect(childValue);
}
collect(payload);

const verifiedObjects = requiredObjects.filter((name) => verified.has(name));
const missingObjects = requiredObjects.filter((name) => !verified.has(name));
if (missingObjects.length) fail(`生产角色表结构不完整，缺少：${missingObjects.join(", ")}`);

console.log(JSON.stringify({
  database: databaseName,
  migration: "0005_team_roles.sql",
  verifiedObjects,
  readOnly: true,
}));
