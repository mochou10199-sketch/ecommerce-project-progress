import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL ?? "postgres://localhost/ecommerce_progress_migration_local";
const vinext = path.join(projectDir, "node_modules", "vinext", "dist", "cli.js");

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  requireCheck(port > 0, "无法分配 PostgreSQL 本地验收端口。");
  return port;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startServer(port) {
  const child = spawn(process.execPath, [vinext, "start", "-p", String(port)], {
    cwd: projectDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PostgreSQL 验收服务提前退出：${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return { child, baseUrl };
    } catch {
      // The production server is still starting.
    }
    await wait(100);
  }
  child.kill("SIGTERM");
  throw new Error(`PostgreSQL 验收服务启动超时：${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await wait(250);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const port = await freePort();
const { child, baseUrl } = await startServer(port);
try {
  const health = await fetch(`${baseUrl}/api/health`);
  requireCheck(health.status === 200, `健康检查返回 ${health.status}`);

  const root = await fetch(`${baseUrl}/`);
  requireCheck(root.status === 200, `首页返回 ${root.status}`);
  for (const header of ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
    requireCheck(root.headers.has(header), `缺少安全响应头：${header}`);
  }

  const crossOrigin = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: "{}",
  });
  requireCheck(crossOrigin.status === 403, `跨站写请求返回 ${crossOrigin.status}`);

  const oversized = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new Uint8Array(256 * 1024 + 1),
  });
  requireCheck(oversized.status === 413, `超大请求返回 ${oversized.status}`);

  const exportResponse = await fetch(`${baseUrl}/api/team/export`);
  requireCheck(exportResponse.status === 401, `未登录导出接口返回 ${exportResponse.status}`);

  console.log(JSON.stringify({
    database: new URL(databaseUrl).pathname,
    health: health.status,
    home: root.status,
    securityHeaders: "present",
    crossOrigin: crossOrigin.status,
    oversized: oversized.status,
    ownerExportUnauthorized: exportResponse.status,
  }));
} finally {
  await stopServer(child);
}
