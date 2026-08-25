import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const projectDir = join(fileURLToPath(new URL("..", import.meta.url)));
const vinext = join(projectDir, "node_modules", "vinext", "dist", "cli.js");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  if (!port) throw new Error("无法分配本地验收端口。");
  return port;
}

const stateDir = await mkdtemp(join(tmpdir(), "ecommerce-progress-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [vinext, "start", "-p", String(port)], {
  cwd: projectDir,
  env: { ...process.env, LOCAL_DB_PATH: join(stateDir, "ecommerce-progress.sqlite") },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function stop() {
  if (child.exitCode === null) child.kill("SIGTERM");
  await rm(stateDir, { recursive: true, force: true });
}

try {
  let health = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) { health = await response.json(); break; }
    } catch {
      // The local server is still starting.
    }
    await wait(100);
  }
  if (!health?.ok) throw new Error(`本地 SQLite 服务启动失败：${output}`);

  let cookie = "";
  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (cookie) headers.set("Cookie", cookie);
    const response = await fetch(base + pathname, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    return { response, payload: await response.json().catch(() => ({})) };
  }
  const run = Date.now().toString(36);
  const registration = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamName: `本地验收团队-${run}`, username: `owner${run}`, password: "TestA123" }),
  });
  if (registration.response.status !== 200) throw new Error("本地团队注册失败。");
  const statuses = await request("/api/project-statuses");
  const project = await request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `本地资料项目-${run}`,
      category: "数据分析",
      stage: "资料验收",
      statusId: statuses.payload.statuses[0].id,
      priority: "medium",
      progressPercent: "25",
      blockers: [],
      sources: [],
    }),
  });
  if (project.response.status !== 201) throw new Error("本地项目创建失败。");
  const form = new FormData();
  form.set("file", new File(["当前风险：等待设计稿\n下一步：完成评审"], "acceptance.md", { type: "text/markdown" }));
  const upload = await request(`/api/projects/${project.payload.projectId}/documents`, { method: "POST", body: form });
  if (upload.response.status !== 201) throw new Error("本地资料上传失败。");
  const query = await request("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "等待设计稿" }),
  });
  if (query.response.status !== 200 || !query.payload.result?.documents?.length) throw new Error("本地资料索引查询失败。");
  console.log(JSON.stringify({ health: 200, register: 200, project: 201, upload: 201, indexedHits: query.payload.result.documents.length }));
} finally {
  await stop();
}
