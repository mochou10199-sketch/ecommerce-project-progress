import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

let previewProcess;
let previewUrl;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("无法分配 Node 验收端口。");
  return port;
}

async function ensurePreview() {
  if (previewProcess) return;
  const port = await freePort();
  previewUrl = `http://127.0.0.1:${port}`;
  const vinext = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
  previewProcess = spawn(process.execPath, [vinext, "start", "-p", String(port)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  previewProcess.stdout.on("data", (chunk) => { output += chunk.toString(); });
  previewProcess.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (previewProcess.exitCode !== null) throw new Error(`Node 验收服务提前退出：${output}`);
    try {
      const response = await fetch(`${previewUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200 || response.status === 503) return;
    } catch {
      // The preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Node 验收服务启动超时：${output}`);
}

async function render() {
  await ensurePreview();
  return fetch(`${previewUrl}/`, { headers: { accept: "text/html" } });
}

after(() => {
  if (previewProcess && previewProcess.exitCode === null) previewProcess.kill("SIGTERM");
});

test("server-renders the team entry for the ecommerce project platform", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>项目总览 · 电商项目进度助手<\/title>/i);
  assert.match(html, /电商项目进度助手/);
  assert.match(html, /确认团队会话/);
  assert.doesNotMatch(html, /独立站商品详情页重构/);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("keeps project data local and does not expose an external AI path", async () => {
  const [route, config, packageJson] = await Promise.all([
    readFile(new URL("../app/api/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(route, /requirePermission/);
  assert.match(route, /mode:\s*"local"/);
  assert.doesNotMatch(route, /api\.openai\.com|OPENAI_API_KEY/);
  assert.doesNotMatch(config, /OPENAI_API_KEY=|OPENAI_MODEL=/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("uses the confirmed six-to-twenty character password policy", async () => {
  const [policy, registerRoute, loginRoute, memberRoute, passwordRoute, authPanel, adminPanel] = await Promise.all([
    readFile(new URL("../app/lib/auth-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/members/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuthPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(policy, /PASSWORD_MIN_LENGTH\s*=\s*6/);
  assert.match(policy, /PASSWORD_MAX_LENGTH\s*=\s*20/);
  assert.match(registerRoute, /PASSWORD_MIN_LENGTH/);
  assert.match(registerRoute, /PASSWORD_MAX_LENGTH/);
  assert.match(loginRoute, /PASSWORD_MIN_LENGTH/);
  assert.match(loginRoute, /PASSWORD_MAX_LENGTH/);
  assert.match(memberRoute, /PASSWORD_MIN_LENGTH/);
  assert.match(memberRoute, /PASSWORD_MAX_LENGTH/);
  assert.match(passwordRoute, /PASSWORD_MIN_LENGTH/);
  assert.match(passwordRoute, /PASSWORD_MAX_LENGTH/);
  assert.match(passwordRoute, /mustChangePassword: false/);
  assert.match(passwordRoute, /auth\.password_changed/);
  assert.match(passwordRoute, /sessions\.tokenHash/);
  assert.match(passwordRoute, /revokedAt: now/);
  assert.match(passwordRoute, /getCurrentSessionTokenHash/);
  assert.match(authPanel, /minLength=\{PASSWORD_MIN_LENGTH\}/);
  assert.match(authPanel, /maxLength=\{PASSWORD_MAX_LENGTH\}/);
  assert.match(adminPanel, /minLength=\{PASSWORD_MIN_LENGTH\}/);
  assert.match(adminPanel, /maxLength=\{PASSWORD_MAX_LENGTH\}/);
});

test("keeps project editing and archiving inside the current team scope", async () => {
  const route = await readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(projects\.teamId, user\.teamId\)/);
  assert.match(route, /eq\(projects\.teamId, owner\.teamId\)/);
  assert.match(route, /project\.update/);
  assert.match(route, /project\.archive/);
  assert.match(route, /isNull\(projects\.archivedAt\)/);
  assert.match(route, /expectedUpdatedAt/);
  assert.match(route, /status: 409/);
  assert.match(route, /eq\(projects\.updatedAt, expectedUpdatedAt\)/);
});

test("keeps team administration owner-only while teams can customize member roles", async () => {
  const [permissions, roleOptions, rolesRoute, roleDetailRoute, membersRoute, memberPasswordRoute, statusesRoute, projectRoute, dashboard, adminPanel] = await Promise.all([
    readFile(new URL("../app/lib/permissions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/role-options.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/roles/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/roles/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/members/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/members/[id]/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/project-statuses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProjectDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(permissions, /user\.permissions/);
  assert.match(permissions, /user\.role !== "owner"/);
  assert.match(roleOptions, /ROLE_PERMISSIONS/);
  assert.match(roleOptions, /ALL_ROLE_PERMISSIONS/);
  assert.match(roleOptions, /team\.manage/);
  assert.match(rolesRoute, /getOwner/);
  assert.match(rolesRoute, /team_role\.create/);
  assert.match(rolesRoute, /normalizeCustomPermissions/);
  assert.match(roleDetailRoute, /isSystem/);
  assert.match(roleDetailRoute, /仍有成员使用此角色/);
  assert.match(roleOptions, /project\.archive/);
  assert.match(roleOptions, /team\.manage/);
  assert.match(membersRoute, /getOwner/);
  assert.match(memberPasswordRoute, /getOwner/);
  assert.match(memberPasswordRoute, /team_member\.password_reset/);
  assert.match(memberPasswordRoute, /mustChangePassword: true/);
  assert.match(memberPasswordRoute, /sessions/);
  assert.match(statusesRoute, /getOwner/);
  assert.match(statusesRoute, /body\.name/);
  assert.match(statusesRoute, /body\.color/);
  assert.match(projectRoute, /const user = await requirePermission/);
  assert.match(projectRoute, /requirePermission\(request, "project\.edit"\)/);
  assert.match(projectRoute, /requirePermission\(request, "project\.archive"\)/);
  assert.match(dashboard, /hasPermission\(authUser, "team\.manage"\)/);
  assert.match(dashboard, /canEditProjects/);
  assert.match(dashboard, /canArchiveProjects/);
  assert.match(adminPanel, /editingStatusId/);
  assert.match(adminPanel, /fetch\(`\/api\/project-statuses\/\$\{statusId\}`/);
  assert.match(adminPanel, /编辑项目状态名称/);
  assert.match(adminPanel, /重置密码/);
  assert.match(adminPanel, /权限角色/);
  assert.match(adminPanel, /创建角色/);
  assert.match(adminPanel, /changeMemberRole/);
});

test("uses preset project choices and stores comprehensive project facts", async () => {
  const [options, schema, sqliteSchema, postgresSchema, createRoute, editRoute, dashboard, editor, detail, migration] = await Promise.all([
    readFile(new URL("../app/lib/project-options.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/sqlite-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/postgres-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProjectDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProjectEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProjectDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_dashing_silver_centurion.sql", import.meta.url), "utf8"),
  ]);

  assert.match(options, /一周内/);
  assert.match(options, /本季度末/);
  assert.match(options, /progressPercentOptions/);
  const schemaSources = `${schema}\n${sqliteSchema}\n${postgresSchema}`;
  assert.match(schemaSources, /category: text\("category"\)/);
  assert.match(schemaSources, /priority: text\("priority"\)/);
  assert.match(schemaSources, /description: text\("description"\)/);
  assert.match(schemaSources, /progressPercent: integer\("progress_percent"\)/);
  assert.match(createRoute, /isProjectPriority/);
  assert.match(createRoute, /parseProgressPercent/);
  assert.match(createRoute, /description/);
  assert.match(editRoute, /progressPercent/);
  assert.match(dashboard, /<select name="plannedEndDate"/);
  assert.doesNotMatch(dashboard, /<input name="plannedEndDate"/);
  assert.match(dashboard, /name="category"/);
  assert.match(dashboard, /name="progressPercent"/);
  assert.match(editor, /<select value={plannedEndDate}/);
  assert.doesNotMatch(editor, /type="date"/);
  assert.match(editor, /expectedUpdatedAt: project\.lastUpdated/);
  assert.match(editor, /onConflict/);
  assert.match(detail, /项目说明/);
  assert.match(detail, /完成比例/);
  assert.match(migration, /ADD `progress_percent` integer/);
});

test("adds rate limits and a data-free health check for production monitoring", async () => {
  const [rateLimit, loginRoute, registerRoute, passwordRoute, askRoute, healthRoute, projectsRoute] = await Promise.all([
    readFile(new URL("../app/lib/rate-limit.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(rateLimit, /Retry-After/);
  assert.match(rateLimit, /cf-connecting-ip/);
  assert.match(loginRoute, /checkRateLimit/);
  assert.match(registerRoute, /checkRateLimit/);
  assert.match(passwordRoute, /checkRateLimit/);
  assert.match(askRoute, /checkRateLimit/);
  assert.match(projectsRoute, /checkRateLimit/);
  assert.match(healthRoute, /SELECT 1/);
  assert.match(healthRoute, /status: 503/);
  assert.doesNotMatch(healthRoute, /teams|users|projects/);
});

test("adds production response hardening and an API body-size guard", async () => {
  const [worker, middleware] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /X-Frame-Options/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /MAX_API_BODY_BYTES\s*=\s*256 \* 1024/);
  assert.match(worker, /status:\s*413/);
  assert.match(worker, /content-length/);
  assert.match(worker, /crossOriginMutation/);
  assert.match(worker, /不允许跨站提交/);
  assert.match(worker, /new URL\(origin\)\.origin === url\.origin/);
  assert.match(middleware, /MAX_API_BODY_BYTES\s*=\s*256 \* 1024/);
  assert.match(middleware, /NextResponse\.next/);
  assert.match(middleware, /不允许跨站提交/);
});

test("keeps the project dashboard synchronized without overwriting an active edit", async () => {
  const dashboard = await readFile(new URL("../app/components/ProjectDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /PROJECT_SYNC_INTERVAL_MS\s*=\s*15_000/);
  assert.match(dashboard, /setInterval/);
  assert.match(dashboard, /document\.visibilityState !== "visible"/);
  assert.match(dashboard, /editingProjectRef\.current/);
  assert.match(dashboard, /cache: "no-store"/);
  assert.match(dashboard, /自动同步于/);
  assert.match(dashboard, /立即刷新/);
});

test("keeps security activity owner-only and visible in team administration", async () => {
  const [route, panel] = await Promise.all([
    readFile(new URL("../app/api/team/audit-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getOwner/);
  assert.match(route, /eq\(auditLogs\.teamId, owner\.teamId\)/);
  assert.match(route, /limit\(50\)/);
  assert.match(panel, /\/api\/team\/audit-logs/);
  assert.match(panel, /安全活动记录/);
  assert.match(route, /getOwner/);
});

test("provides an owner-only team snapshot export without credentials", async () => {
  const [route, panel] = await Promise.all([
    readFile(new URL("../app/api/team/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getOwner/);
  assert.match(route, /team\.export/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /limit\(1000\)/);
  assert.match(route, /teamRoles/);
  assert.match(route, /roles: roleRows/);
  assert.doesNotMatch(route, /passwordHash|passwordSalt|sessions/);
  assert.match(panel, /\/api\/team\/export/);
  assert.match(panel, /导出运营快照/);
  assert.match(panel, /不包含密码和会话令牌/);
});

test("surfaces owner-only monitoring counts from local health and audit data", async () => {
  const [route, panel] = await Promise.all([
    readFile(new URL("../app/api/team/monitoring/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getOwner/);
  assert.match(route, /loginFailures24h/);
  assert.match(route, /securityFailures24h/);
  assert.match(route, /isNull\(projects\.archivedAt\)/);
  assert.match(route, /Cache-Control/);
  assert.match(panel, /\/api\/team\/monitoring/);
  assert.match(panel, /运行监控/);
  assert.match(panel, /24 小时安全异常/);
});

test("keeps P0-P3 incidents durable and owner-scoped", async () => {
  const [schema, options, collectionRoute, detailRoute, panel] = await Promise.all([
    readFile(new URL("../db/sqlite-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/incident-options.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/incidents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/incidents/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamAdminPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /sqliteTable\("incidents"/);
  assert.match(options, /\["P0", "P1", "P2", "P3"\]/);
  assert.match(options, /P0: "15 分钟内"/);
  assert.match(options, /P3: "2 个工作日内确认"/);
  assert.match(options, /\["waiting", "overdue", "acknowledged", "resolved"\]/);
  assert.match(options, /\["open", "investigating", "resolved"\]/);
  assert.match(collectionRoute, /getOwner/);
  assert.match(collectionRoute, /eq\(incidents\.teamId, owner\.teamId\)/);
  assert.match(collectionRoute, /limit\(100\)/);
  assert.match(detailRoute, /eq\(incidents\.teamId, owner\.teamId\)/);
  assert.match(detailRoute, /closedAt/);
  assert.match(collectionRoute, /responseDueAt/);
  assert.match(collectionRoute, /responseState/);
  assert.match(panel, /\/api\/team\/incidents/);
  assert.match(panel, /运维事件/);
  assert.match(panel, /P0-P3/);
  assert.match(panel, /建议响应/);
  assert.match(panel, /正式 SLA 仍需团队负责人确认/);
  assert.match(panel, /响应节点/);
});

test("provides a non-destructive production acceptance smoke script", async () => {
  const [script, packageJson, drill] = await Promise.all([
    readFile(new URL("../scripts/production-smoke.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/17-生产演练.md", import.meta.url), "utf8"),
  ]);
  assert.match(script, /SMOKE_TEAM_CODE/);
  assert.match(script, /SMOKE_USERNAME/);
  assert.match(script, /SMOKE_PASSWORD/);
  assert.match(script, /mode !== "local"/);
  assert.match(script, /afterLogout, 401/);
  assert.match(packageJson, /"production:smoke": "node scripts\/production-smoke\.mjs"/);
  assert.match(drill, /线上真实团队低风险验收/);
});

test("gates production D1 export behind explicit credentials and validates core tables", async () => {
  const [script, packageJson, drill, gate] = await Promise.all([
    readFile(new URL("../scripts/production-backup-check.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/17-生产演练.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/18-边缘限流与备份门禁.md", import.meta.url), "utf8"),
  ]);
  assert.match(script, /PROD_D1_NAME/);
  assert.match(script, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(script, /CLOUDFLARE_API_TOKEN/);
  assert.match(script, /BACKUP_DIR/);
  assert.match(script, /d1", "export"/);
  assert.match(script, /--remote/);
  assert.match(script, /--skip-confirmation/);
  assert.match(script, /incidents/);
  assert.match(script, /team_roles/);
  assert.match(script, /restoreExecuted: false/);
  assert.match(script, /不能位于项目目录内/);
  assert.doesNotMatch(script, /time-travel.*restore/);
  assert.match(packageJson, /"production:backup:check": "node scripts\/production-backup-check\.mjs"/);
  assert.match(drill, /生产备份前置检查/);
  assert.match(gate, /备份前置检查脚本/);
});

test("provides a read-only production role schema gate before deployment", async () => {
  const [script, packageJson, preflight, gate] = await Promise.all([
    readFile(new URL("../scripts/production-role-schema-check.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/12-预发布检查.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/18-边缘限流与备份门禁.md", import.meta.url), "utf8"),
  ]);
  assert.match(script, /PROD_D1_NAME/);
  assert.match(script, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(script, /CLOUDFLARE_API_TOKEN/);
  assert.match(script, /team_roles_team_code_unique/);
  assert.match(script, /team_roles_team_id_idx/);
  assert.match(script, /--remote/);
  assert.match(script, /--json/);
  assert.match(script, /readOnly: true/);
  assert.doesNotMatch(script, /d1", "migrations", "apply/);
  assert.doesNotMatch(script, /INSERT INTO|CREATE TABLE|UPDATE |DELETE FROM/);
  assert.match(packageJson, /"production:roles:check": "node scripts\/production-role-schema-check\.mjs"/);
  assert.match(preflight, /production:roles:check/);
  assert.match(gate, /production:roles:check/);
});

test("verifies the complete local D1 migration chain before release", async () => {
  const [script, packageJson, readme, environment, preflight, archive] = await Promise.all([
    readFile(new URL("../scripts/verify-migrations.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/05-项目环境.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/12-预发布检查.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/16-版本归档.md", import.meta.url), "utf8"),
  ]);
  assert.match(script, /--local/);
  assert.match(script, /--persist-to/);
  assert.match(script, /--config/);
  assert.match(script, /--file/);
  assert.match(script, /PRAGMA table_info/);
  assert.match(script, /reappliedLastMigration/);
  assert.match(script, /restoreExecuted: false/);
  assert.match(script, /mkdtemp/);
  assert.match(packageJson, /"db:migrations:check": "npm run build && node scripts\/verify-migrations\.mjs"/);
  assert.match(readme, /npm run db:migrations:check/);
  assert.match(environment, /0000.*0005/);
  assert.match(preflight, /0000.*0005/);
  assert.match(preflight, /db:migrations:check/);
  assert.match(archive, /0000.*0005/);
});

test("provides a repeatable isolated local acceptance flow", async () => {
  const [script, packageJson, verification, preflight, drill] = await Promise.all([
    readFile(new URL("../scripts/local-acceptance.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/10-验证反馈.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/12-预发布检查.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/vibe-coding/17-生产演练.md", import.meta.url), "utf8"),
  ]);
  assert.match(script, /isolated-local-d1/);
  assert.match(script, /团队 B 看到了团队 A 的项目/);
  assert.match(script, /memberPasswordReset/);
  assert.match(script, /成员密码重置失败/);
  assert.match(script, /customRoles/);
  assert.match(script, /自定义角色创建失败/);
  assert.match(script, /普通成员管理接口应返回 403/);
  assert.match(script, /第五次错误后账号未锁定/);
  assert.match(script, /旧版本更新应返回 409/);
  assert.match(script, /passwordRotation/);
  assert.match(packageJson, /"local:acceptance": "npm run build && node scripts\/local-acceptance\.mjs"/);
  assert.match(verification, /local:acceptance/);
  assert.match(preflight, /本地隔离验收/);
  assert.match(drill, /本地隔离接口验收/);
});
