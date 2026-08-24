import { spawn } from "node:child_process";

const baseUrl = (process.env.PRODUCTION_URL ?? "https://ecommerce-project-progress.mochou10199.chatgpt.site").replace(/\/+$/, "");
const requiredHeaders = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
];

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function curl(args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["--silent", "--show-error", "--max-time", "20", ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `curl 退出码 ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

const rootHeaders = await curl(["--dump-header", "-", "--output", "/dev/null", `${baseUrl}/`]);
const rootStatus = Number(rootHeaders.match(/^HTTP\/\S+\s+(\d+)/m)?.[1] ?? 0);
requireCheck(rootStatus === 200, `首页返回 ${rootStatus}`);

const healthOutput = await curl(["--write-out", "\n%{http_code}", `${baseUrl}/api/health`]);
const healthLines = healthOutput.trimEnd().split("\n");
const healthStatus = Number(healthLines.pop() ?? 0);
const healthPayload = JSON.parse(healthLines.join("\n"));
requireCheck(healthStatus === 200 && healthPayload.ok === true, `健康检查失败：HTTP ${healthStatus}`);

for (const header of requiredHeaders) {
  requireCheck(new RegExp(`^${header}:\\s*.+$`, "im").test(rootHeaders), `缺少安全响应头：${header}`);
}

const oversizedOutput = await curl([
  "--request", "POST",
  "--header", "Content-Type: application/json",
  "--data-binary", "@-",
  "--output", "/dev/null",
  "--write-out", "%{http_code}",
  `${baseUrl}/api/projects`,
], Buffer.alloc(256 * 1024 + 1));
const oversizedStatus = Number(oversizedOutput.trim());
requireCheck(oversizedStatus === 413, `超大请求未被拦截：HTTP ${oversizedStatus}`);

const crossOriginOutput = await curl([
  "--request", "POST",
  "--header", "Origin: https://evil.example",
  "--header", "Content-Type: application/json",
  "--data-binary", "{}",
  "--output", "/dev/null",
  "--write-out", "%{http_code}",
  `${baseUrl}/api/health`,
]);
const crossOriginStatus = Number(crossOriginOutput.trim());
requireCheck(crossOriginStatus === 403, `跨站写请求未被拦截：HTTP ${crossOriginStatus}`);

const exportOutput = await curl([
  "--output", "/dev/null",
  "--write-out", "%{http_code}",
  `${baseUrl}/api/team/export`,
]);
const exportStatus = Number(exportOutput.trim());
requireCheck(exportStatus === 401, `未登录快照接口未被拒绝：HTTP ${exportStatus}`);

const monitoringOutput = await curl([
  "--output", "/dev/null",
  "--write-out", "%{http_code}",
  `${baseUrl}/api/team/monitoring`,
]);
const monitoringStatus = Number(monitoringOutput.trim());
requireCheck(monitoringStatus === 401, `未登录监控接口未被拒绝：HTTP ${monitoringStatus}`);

const incidentsOutput = await curl([
  "--output", "/dev/null",
  "--write-out", "%{http_code}",
  `${baseUrl}/api/team/incidents`,
]);
const incidentsStatus = Number(incidentsOutput.trim());
requireCheck(incidentsStatus === 401, `未登录事件接口未被拒绝：HTTP ${incidentsStatus}`);

console.log(JSON.stringify({
  baseUrl,
  root: rootStatus,
  health: healthStatus,
  securityHeaders: "present",
  oversizedRequest: oversizedStatus,
  crossOriginRequest: crossOriginStatus,
  ownerExportUnauthorized: exportStatus,
  ownerMonitoringUnauthorized: monitoringStatus,
  ownerIncidentsUnauthorized: incidentsStatus,
}));
