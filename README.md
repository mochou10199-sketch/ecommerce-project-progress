# 电商项目进度助手

一个对外开放、按公司/团队隔离数据的电商项目进度平台。团队母账号注册后，团队成员使用用户名和密码进入团队；项目查询只使用当前团队的本地数据，不调用 OpenAI 或其他外部 AI。

## 当前迁移状态

当前活动运行路径已切换为 **Node/Vinext + PostgreSQL**，目标数据库为全新的 Supabase PostgreSQL。Supabase 空项目和 10 张核心表已初始化；原 Cloudflare Worker/D1 代码和 Sites 版本暂时保留为旧版本参考和可选回滚资产，但不再是活动构建入口；本次不迁移已有 D1 数据，线上新平台仍需完成 Node 部署和验收后才能切换。

本地 PostgreSQL 演练库已经完成：10 张核心表、`team_roles`、内置角色补齐和 Node 运行时验收。生产环境将初始化空库，不导入已有 D1 数据；Vercel/Nitro 构建入口已经通过本地验证。详细步骤见 `docs/vibe-coding/20-数据库迁移执行.md`。

## 当前已实现

- 团队母账号注册、团队编号和用户名/密码会话。
- 服务端会话 Cookie、退出登录和团队范围校验。
- PostgreSQL/D1 兼容数据模型：公司、团队、成员、会话、项目、项目状态、来源、审计记录和运维事件；Node 运行时优先使用 PostgreSQL。
- 项目创建、项目列表、项目详情和本地规则查询。
- 项目编辑使用 `updatedAt` 乐观并发校验；多人同时编辑时，旧版本保存会返回冲突，不会静默覆盖新内容。
- 项目创建表单支持项目类型、状态、优先级、项目说明、完成比例、进展、阻塞项和资料来源；计划完成日期改为统一选项，避免手工输入格式不一致。
- 项目工作台每 15 秒自动同步当前团队数据；编辑项目时暂停自动覆盖，并提供“立即刷新”按钮。
- 已补充面向团队成员的操作手册：`docs/用户操作手册.md`。
- 已补充 P0-P3 问题分级与监控清单：`docs/vibe-coding/19-问题分级与监控清单.md`。
- 团队母账号的成员创建、停用/恢复、密码重置和基础管理界面；停用或密码重置会使成员已有会话失效。
- 每家公司可以独立创建和维护项目权限角色；母账号权限受保护，成员角色支持查看、创建、编辑和归档项目权限。
- 新成员首次登录必须修改初始密码，密码统一限制为 6-20 个字符。
- 修改密码后保留当前会话并吊销该账号的其他旧会话。
- 团队母账号的自定义项目状态新增、启用/停用、归档和引用保护界面/API。
- 团队母账号可编辑项目状态名称和颜色；owner/member 权限矩阵由服务端统一校验。
- 登录、注册、改密、查询和项目创建接口具备应用层限流；`/api/health` 可用于无业务数据监控。
- 团队母账号可导出当前团队运营快照；快照不包含密码、密码哈希或会话令牌，并明确不替代生产数据库备份。
- 团队母账号可查看运行监控卡片：活跃成员、活跃项目、24 小时登录失败和安全异常；数据只来自当前团队本地记录。
- 团队母账号可按 P0-P3 记录、更新和关闭运维事件，事件数据按团队隔离并写入审计记录。
- 已提供线上真实团队低风险验收脚本：验证登录、会话、项目列表、状态、本地查询、监控、事件列表和退出，不创建业务数据。
- 已提供隔离本地 D1 迁移门禁，以及 PostgreSQL 结构校验、SQLite/D1 到 PostgreSQL 的安全导入工具和 Node 本地验收。
- 已提供隔离本地接口验收：自动验证两团队隔离、成员越权、登录锁定和并发编辑冲突，不写入线上或现有本地数据库。
- 两个团队的数据隔离验证。
- 右侧预览中的团队登录页和项目工作台。

## 暂未实现

- 真实文件上传、文档解析和资料索引。
- 远端 Vercel Node 部署、`DATABASE_URL` 配置、DNS/域名切换和旧 Cloudflare 站点下线。

## 本地运行

```bash
npm ci
npm run dev
```

构建和检查：

```bash
npm run lint
npm test
npm run build
npm run production:preflight
# 隔离本地 D1 迁移顺序与核心字段门禁
npm run db:migrations:check
# 隔离本地接口验收（自动创建临时数据库并在结束后清理）
npm run local:acceptance
# PostgreSQL 本地运行时验收（健康检查、安全边界和未登录权限）
npm run postgres:acceptance
# PostgreSQL 目标结构校验（默认检查本机迁移演练库）
npm run db:postgres:verify
# 生成 PostgreSQL 迁移
npm run db:postgres:generate
# 将 SQLite/D1 导出导入本机 PostgreSQL；目标库必须为空
npm run db:postgres:import -- --sqlite /受控目录/d1-export.sqlite
# 线上真实团队低风险验收（仅从环境变量读取一次性账号）
SMOKE_TEAM_CODE=... SMOKE_USERNAME=... SMOKE_PASSWORD=... npm run production:smoke
# 生产 D1 备份前置检查（需管理员权限和项目目录外的受控目录）
PROD_D1_NAME=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... BACKUP_DIR=/受控目录 npm run production:backup:check
# 生产团队角色表只读检查（不执行迁移、不写入数据）
PROD_D1_NAME=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run production:roles:check
```

## PostgreSQL 迁移演练

目标结构位于 `db/postgres-schema.ts`，迁移文件位于 `drizzle-postgres/`。Node/Vinext 设置 `DATABASE_URL` 后使用 PostgreSQL；连接串只放在本地 `.env` 或部署平台密钥中，不提交到仓库。

```bash
export DATABASE_URL='postgresql://...'
npm run db:postgres:verify
npm run postgres:acceptance
```

数据导入脚本默认拒绝非本机目标，且拒绝向非空目标库写入；远端迁移只有在完成备份并人工确认后，显式添加 `--allow-remote` 才会执行。不要把 Supabase 密码、服务密钥或完整连接串写进命令历史、日志或代码。

## 旧 D1 回滚路径（迁移窗口保留）

旧 D1 模型位于 `db/sqlite-schema.ts`，迁移文件位于 `drizzle/`。当前活动 Node 构建不会加载 Wrangler/Cloudflare 插件；只有旧版本回滚或旧本地验收才使用以下路径：

```bash
npm run db:generate
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0000_young_punisher.sql
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0001_sudden_nuke.sql
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0002_optimal_venus.sql
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0003_dashing_silver_centurion.sql
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0004_sweet_iron_patriot.sql
./node_modules/.bin/wrangler d1 execute site-creator-d1 --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0005_team_roles.sql
```

真实部署前必须重新检查迁移、权限、备份和回滚方案。真实项目资料不得发送到外部 AI 服务。
