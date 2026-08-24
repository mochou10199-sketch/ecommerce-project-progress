import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(projectDir, "node_modules", ".bin", "wrangler");
const config = path.join(projectDir, "dist", "server", "wrangler.json");
const workerEntry = path.join(projectDir, "dist", "server", "index.js");
const databaseName = "site-creator-d1";
const migrationsDir = path.join(projectDir, "drizzle");

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

async function migrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function runWrangler(args, stateDir) {
  try {
    return await execFileAsync(wrangler, [
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
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).join("\n");
    throw new Error(`本地 D1 迁移失败：${output}`);
  }
}

async function applyMigrations(stateDir) {
  for (const migration of await migrationFiles()) {
    await runWrangler(["--file", path.join(migrationsDir, migration), "--yes"], stateDir);
  }
}

async function startServer(stateDir, port, logFile) {
  const child = spawn(wrangler, [
    "dev",
    workerEntry,
    "--local",
    "--persist-to",
    stateDir,
    "--config",
    config,
    "--port",
    String(port),
    "--ip",
    "127.0.0.1",
  ], {
    cwd: projectDir,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: logFile,
      MINIFLARE_REGISTRY_PATH: path.dirname(logFile),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`本地验收服务提前退出：${output}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200 || response.status === 503) return { child, base };
    } catch {
      // The local Worker is still starting.
    }
    await wait(250);
  }
  child.kill("SIGTERM");
  throw new Error(`本地验收服务启动超时：${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function runAcceptance(base) {
  const run = Date.now().toString(36);
  const passwordA = "TestA123";
  const passwordB = "TestB123";
  const initialMemberPassword = "MemberA1";
  let memberPassword = initialMemberPassword;
  const usernameA = `ownera${run}`;
  const usernameB = `ownerb${run}`;
  const memberUsername = `membera${run}`;
  const lockoutUsername = `lockout${run}`;
  const projectName = `隔离项目-${run}`;

  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      options = { ...options, body: JSON.stringify(options.body) };
    }
    const response = await fetch(base + pathname, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    const cookie = (response.headers.get("set-cookie") ?? "").split(";", 1)[0] || null;
    return { status: response.status, payload, cookie };
  }

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  const registrationA = await request("/api/auth/register", {
    method: "POST",
    body: { teamName: `验收团队A-${run}`, username: usernameA, password: passwordA },
  });
  check(registrationA.status === 200, `团队 A 注册失败：${registrationA.status}`);
  const teamCodeA = registrationA.payload.teamCode;
  const cookieA = registrationA.cookie;
  check(teamCodeA && cookieA, "团队 A 注册没有返回团队编号或会话。");

  const registrationB = await request("/api/auth/register", {
    method: "POST",
    body: { teamName: `验收团队B-${run}`, username: usernameB, password: passwordB },
  });
  check(registrationB.status === 200, `团队 B 注册失败：${registrationB.status}`);
  const teamCodeB = registrationB.payload.teamCode;
  const cookieB = registrationB.cookie;
  check(teamCodeB && cookieB && teamCodeA !== teamCodeB, "两家验收团队没有获得独立编号。");

  const statusesA = await request("/api/project-statuses", { cookie: cookieA });
  check(statusesA.status === 200 && statusesA.payload.statuses?.length, "团队 A 状态读取失败。");
  const projectStatusId = statusesA.payload.statuses[0].id;
  const createProject = await request("/api/projects", {
    method: "POST",
    cookie: cookieA,
    body: {
      name: projectName,
      category: "数据分析",
      stage: "隔离验收",
      statusId: projectStatusId,
      priority: "high",
      plannedEndDate: "",
      description: "仅团队 A 可见",
      progress: "初始进展",
      progressPercent: "25",
      blockers: ["仅用于本地验收"],
      sources: ["本地验收记录"],
    },
  });
  check(createProject.status === 201, `团队 A 创建项目失败：${createProject.status}`);

  const projectsA = await request("/api/projects", { cookie: cookieA });
  const projectsB = await request("/api/projects", { cookie: cookieB });
  check(projectsA.status === 200 && projectsA.payload.projects.some((project) => project.name === projectName), "团队 A 看不到自己的项目。");
  check(projectsB.status === 200 && !projectsB.payload.projects.some((project) => project.name === projectName), "团队 B 看到了团队 A 的项目。");
  const projectA = projectsA.payload.projects.find((project) => project.name === projectName);

  const queryB = await request("/api/ask", { method: "POST", cookie: cookieB, body: { question: projectName } });
  check(queryB.status === 200 && queryB.payload.result?.kind !== "project", "团队 B 查询到了团队 A 的项目。");

  const memberCreate = await request("/api/team/members", {
    method: "POST",
    cookie: cookieA,
    body: { username: memberUsername, password: initialMemberPassword },
  });
  check(memberCreate.status === 201, `团队 A 创建成员失败：${memberCreate.status}`);
  const lockoutMemberCreate = await request("/api/team/members", {
    method: "POST",
    cookie: cookieA,
    body: { username: lockoutUsername, password: "LockA1" },
  });
  check(lockoutMemberCreate.status === 201, `锁定验收成员创建失败：${lockoutMemberCreate.status}`);
  const memberId = memberCreate.payload.member?.id;
  check(memberId, "成员创建没有返回成员编号。");
  const rolesBefore = await request("/api/team/roles", { cookie: cookieA });
  check(rolesBefore.status === 200 && rolesBefore.payload.roles?.some((role) => role.code === "member"), "团队默认角色读取失败。");
  const customRoleCreate = await request("/api/team/roles", {
    method: "POST",
    cookie: cookieA,
    body: { name: "项目查看员", description: "只读项目事实", permissions: ["project.view"] },
  });
  check(customRoleCreate.status === 201, `自定义角色创建失败：${customRoleCreate.status}`);
  const customRoleCode = customRoleCreate.payload.role?.code;
  check(customRoleCode, "自定义角色没有返回角色编号。");
  const memberPasswordReset = await request(`/api/team/members/${memberId}/password`, {
    method: "POST",
    cookie: cookieA,
    body: { newPassword: "ResetC3" },
  });
  check(memberPasswordReset.status === 200, `成员密码重置失败：${memberPasswordReset.status}`);
  memberPassword = "ResetC3";
  const oldMemberLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: initialMemberPassword },
  });
  check(oldMemberLogin.status === 401, "成员重置密码后旧密码仍可登录。");
  const memberBeforeRoleChange = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: memberPassword },
  });
  check(memberBeforeRoleChange.status === 200 && memberBeforeRoleChange.cookie, "角色变更前成员登录失败。");
  const assignViewerRole = await request(`/api/team/members/${memberId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { role: customRoleCode },
  });
  check(assignViewerRole.status === 200, `成员角色分配失败：${assignViewerRole.status}`);
  const revokedAfterRoleChange = await request("/api/projects", { cookie: memberBeforeRoleChange.cookie });
  check(revokedAfterRoleChange.status === 401, "成员角色变更后旧会话仍然有效。");
  const viewerLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: memberPassword },
  });
  check(viewerLogin.status === 200 && viewerLogin.cookie, "自定义只读角色登录失败。");
  const viewerProjects = await request("/api/projects", { cookie: viewerLogin.cookie });
  check(viewerProjects.status === 200, "自定义只读角色不能查看项目。");
  const viewerProject = viewerProjects.payload.projects.find((project) => project.id === projectA.id);
  const viewerUpdate = await request(`/api/projects/${projectA.id}`, {
    method: "PATCH",
    cookie: viewerLogin.cookie,
    body: {
      name: viewerProject.name,
      category: viewerProject.category,
      stage: viewerProject.stage,
      statusId: viewerProject.statusId,
      priority: viewerProject.priority,
      plannedEndDate: "",
      description: viewerProject.description,
      progress: viewerProject.progress,
      progressPercent: String(viewerProject.progressPercent),
      blockers: viewerProject.blockers,
      sources: viewerProject.sources,
      expectedUpdatedAt: viewerProject.lastUpdated,
    },
  });
  check(viewerUpdate.status === 403, `自定义只读角色不应编辑项目，实际为 ${viewerUpdate.status}。`);
  const restoreMemberRole = await request(`/api/team/members/${memberId}`, {
    method: "PATCH",
    cookie: cookieA,
    body: { role: "member" },
  });
  check(restoreMemberRole.status === 200, `成员角色恢复失败：${restoreMemberRole.status}`);
  const revokedViewer = await request("/api/projects", { cookie: viewerLogin.cookie });
  check(revokedViewer.status === 401, "成员恢复角色后旧只读会话仍然有效。");
  const memberLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: memberPassword },
  });
  check(memberLogin.status === 200 && memberLogin.cookie, "成员登录失败。");
  const memberCookie = memberLogin.cookie;
  const secondMemberLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: memberPassword },
  });
  check(secondMemberLogin.status === 200 && secondMemberLogin.cookie, "成员第二个会话登录失败。");
  const secondMemberCookie = secondMemberLogin.cookie;

  const passwordChange = await request("/api/auth/password", {
    method: "POST",
    cookie: memberCookie,
    body: { currentPassword: memberPassword, newPassword: "MemberB2" },
  });
  check(passwordChange.status === 200, `密码修改失败：${passwordChange.status}`);
  const currentSessionAfterPasswordChange = await request("/api/projects", { cookie: memberCookie });
  const otherSessionAfterPasswordChange = await request("/api/projects", { cookie: secondMemberCookie });
  check(currentSessionAfterPasswordChange.status === 200, "修改密码后当前会话不应失效。");
  check(otherSessionAfterPasswordChange.status === 401, "修改密码后旧会话仍然有效。");
  const oldPasswordLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: memberUsername, password: memberPassword },
  });
  check(oldPasswordLogin.status === 401, "修改密码后旧密码仍可登录。");

  const memberMonitoring = await request("/api/team/monitoring", { cookie: memberCookie });
  check(memberMonitoring.status === 403, `普通成员管理接口应返回 403，实际为 ${memberMonitoring.status}。`);

  const memberProject = (await request("/api/projects", { cookie: memberCookie })).payload.projects.find((project) => project.id === projectA.id);
  check(memberProject?.lastUpdated === projectA.lastUpdated, "编辑前版本时间不一致。");
  const memberUpdate = await request(`/api/projects/${projectA.id}`, {
    method: "PATCH",
    cookie: memberCookie,
    body: {
      name: memberProject.name,
      category: memberProject.category,
      stage: memberProject.stage,
      statusId: memberProject.statusId,
      priority: memberProject.priority,
      plannedEndDate: "",
      description: memberProject.description,
      progress: "成员先提交的进展",
      progressPercent: String(memberProject.progressPercent),
      blockers: memberProject.blockers,
      sources: memberProject.sources,
      expectedUpdatedAt: memberProject.lastUpdated,
    },
  });
  check(memberUpdate.status === 200, `成员更新项目失败：${memberUpdate.status}`);

  const staleOwnerUpdate = await request(`/api/projects/${projectA.id}`, {
    method: "PATCH",
    cookie: cookieA,
    body: {
      name: projectA.name,
      category: projectA.category,
      stage: projectA.stage,
      statusId: projectA.statusId,
      priority: projectA.priority,
      plannedEndDate: "",
      description: projectA.description,
      progress: "旧版本覆盖尝试",
      progressPercent: String(projectA.progressPercent),
      blockers: projectA.blockers,
      sources: projectA.sources,
      expectedUpdatedAt: projectA.lastUpdated,
    },
  });
  check(staleOwnerUpdate.status === 409, `旧版本更新应返回 409，实际为 ${staleOwnerUpdate.status}。`);
  check(staleOwnerUpdate.payload.project?.progress === "成员先提交的进展", "冲突响应没有返回最新项目内容。");

  const failedStatuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const failed = await request("/api/auth/login", {
      method: "POST",
      body: { teamCode: teamCodeA, username: lockoutUsername, password: "Wrong99" },
    });
    failedStatuses.push(failed.status);
  }
  const fifthFailed = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: lockoutUsername, password: "Wrong99" },
  });
  failedStatuses.push(fifthFailed.status);
  check(failedStatuses.length === 5 && failedStatuses.every((status) => status === 401), "错误密码未统一返回 401。");
  const blockedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { teamCode: teamCodeA, username: lockoutUsername, password: "LockA1" },
  });
  check(blockedLogin.status === 401, `第五次错误后账号未锁定，实际为 ${blockedLogin.status}。`);

  await request("/api/auth/logout", { method: "POST", cookie: cookieA });
  await request("/api/auth/logout", { method: "POST", cookie: cookieB });
  await request("/api/auth/logout", { method: "POST", cookie: memberCookie });
  await request("/api/auth/logout", { method: "POST", cookie: secondMemberCookie });

  return {
    registration: { teamA: 200, teamB: 200, isolatedCodes: true },
    projectIsolation: { teamAList: 200, teamBList: 200, crossTeamQueryHidden: true },
    memberPermission: 403,
    memberPasswordReset: { ownerOnly: 200, oldPassword: 401, newPassword: 200 },
    customRoles: { create: 201, assign: 200, viewerRead: 200, viewerEdit: 403, roleChangeRevokesSession: true },
    passwordRotation: { currentSession: 200, otherSession: 401, oldPassword: 401 },
    optimisticConcurrency: { firstSave: 200, staleSave: 409, latestReturned: true },
    loginLockout: { failedAttempts: failedStatuses.length, blockedLogin: 401 },
  };
}

async function main() {
  await access(wrangler);
  await access(config);
  await access(workerEntry);
  const isolatedRoot = await mkdtemp(path.join(tmpdir(), "ecommerce-local-acceptance-"));
  const stateDir = path.join(isolatedRoot, "state");
  let child;
  try {
    await applyMigrations(stateDir);
    const port = await freePort();
    const server = await startServer(stateDir, port, path.join(isolatedRoot, "wrangler.log"));
    child = server.child;
    const result = await runAcceptance(server.base);
    console.log(JSON.stringify({ base: server.base, ...result, database: "isolated-local-d1" }));
  } finally {
    if (child) await stopServer(child);
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
