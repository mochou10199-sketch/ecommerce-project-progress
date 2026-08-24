import { spawn } from "node:child_process";

const baseUrl = (process.env.PRODUCTION_URL ?? "https://ecommerce-project-progress.mochou10199.chatgpt.site").replace(/\/+$/, "");
const teamCode = process.env.SMOKE_TEAM_CODE?.trim();
const username = process.env.SMOKE_USERNAME?.trim();
const password = process.env.SMOKE_PASSWORD ?? "";
const expectedRole = process.env.SMOKE_EXPECT_ROLE ?? "owner";

if (!teamCode || !username || !password) {
  throw new Error("请通过 SMOKE_TEAM_CODE、SMOKE_USERNAME、SMOKE_PASSWORD 提供一次性验收账号；脚本不会保存这些值。");
}

function runCurl(args, input = null) {
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

async function request(path, options = {}) {
  const method = options.method ?? "GET";
  const args = ["--request", method, "--dump-header", "-", "--write-out", "\n__STATUS__:%{http_code}"];
  if (options.body !== undefined) {
    args.push("--header", "Content-Type: application/json", "--data", JSON.stringify(options.body));
  }
  if (options.cookie) args.push("--header", `Cookie: ${options.cookie}`);
  const output = await runCurl([...args, `${baseUrl}${path}`]);
  const statusMarker = output.lastIndexOf("\n__STATUS__:");
  const status = Number(output.slice(statusMarker + "\n__STATUS__:".length).trim());
  const rawResponse = output.slice(0, statusMarker);
  const separator = rawResponse.indexOf("\r\n\r\n");
  const separatorLength = separator >= 0 ? 4 : 2;
  const headerEnd = separator >= 0 ? separator : rawResponse.indexOf("\n\n");
  const headers = headerEnd >= 0 ? rawResponse.slice(0, headerEnd) : "";
  const body = headerEnd >= 0 ? rawResponse.slice(headerEnd + separatorLength) : rawResponse;
  return { status, headers, body };
}

function readJson(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    return {};
  }
}

function requireStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label} 返回 HTTP ${response.status}，预期 ${expected}`);
}

const login = await request("/api/auth/login", {
  method: "POST",
  body: { teamCode, username, password },
});
requireStatus(login, 200, "团队登录");
const cookie = login.headers.match(/^set-cookie:\s*([^;\r\n]+)/im)?.[1] ?? "";
if (!cookie) throw new Error("团队登录成功但没有收到会话 Cookie。");

const me = await request("/api/auth/me", { cookie });
requireStatus(me, 200, "当前会话");
const mePayload = await readJson(me);
if (mePayload.user?.teamCode !== teamCode.toUpperCase() || mePayload.user?.username !== username.toLowerCase()) {
  throw new Error("当前会话身份与验收账号不一致。");
}
if (expectedRole && mePayload.user?.role !== expectedRole) {
  throw new Error(`当前账号角色为 ${mePayload.user?.role ?? "unknown"}，预期 ${expectedRole}。`);
}

const projects = await request("/api/projects", { cookie });
requireStatus(projects, 200, "项目列表");
const projectPayload = await readJson(projects);

const statuses = await request("/api/project-statuses", { cookie });
requireStatus(statuses, 200, "项目状态");

const query = await request("/api/ask", {
  method: "POST",
  cookie,
  body: { question: "请汇总当前团队的项目进度" },
});
requireStatus(query, 200, "本地项目查询");
const queryPayload = await readJson(query);
if (queryPayload.mode !== "local") throw new Error("项目查询未标记为 local 模式。");

const monitoring = await request("/api/team/monitoring", { cookie });
requireStatus(monitoring, 200, "团队运行监控");
const incidents = await request("/api/team/incidents", { cookie });
requireStatus(incidents, 200, "运维事件列表");

const logout = await request("/api/auth/logout", { method: "POST", cookie });
requireStatus(logout, 200, "团队退出");
const afterLogout = await request("/api/auth/me", { cookie });
requireStatus(afterLogout, 401, "退出后会话吊销");

console.log(JSON.stringify({
  baseUrl,
  login: login.status,
  session: me.status,
  projects: projects.status,
  projectCount: Array.isArray(projectPayload.projects) ? projectPayload.projects.length : null,
  statuses: statuses.status,
  localQuery: query.status,
  monitoring: monitoring.status,
  incidents: incidents.status,
  logout: logout.status,
  revokedSession: afterLogout.status,
}));
