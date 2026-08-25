# 电商项目进度助手

一个按公司/团队隔离数据的本地项目进度管理工具。项目源码只发布到 GitHub，使用者下载到自己的电脑后运行；不依赖 Vercel、Supabase、Cloudflare 或其他线上数据库。

## 使用方式

每家公司各自下载一份源码，在本机运行自己的 SQLite 数据库文件。团队成员只能通过团队编号、用户名和密码进入当前团队空间。

```bash
git clone https://github.com/mochou10199-sketch/ecommerce-project-progress.git
cd ecommerce-project-progress
npm ci
npm run dev
```

浏览器打开 <http://localhost:3000>，首次使用点击“注册团队母账号”。本地数据库默认创建在 `data/ecommerce-progress.sqlite`，该目录已加入 Git 忽略，不会被上传到 GitHub。

如需指定数据库位置，可以设置本地环境变量：

```bash
LOCAL_DB_PATH=/你的本地目录/ecommerce-progress.sqlite npm run dev
```

要求 Node.js 22.13 或更高版本。数据库使用 Node 内置 SQLite，不需要配置数据库账号、密码或云端连接串。

## 已实现

- 团队母账号注册、登录、退出、密码修改和团队隔离。
- 成员创建、停用/恢复、密码重置、自定义角色和权限校验。
- 项目创建、编辑、归档、预设项目类型/状态/优先级/完成比例和自动刷新。
- 本地规则查询，不调用 OpenAI 或其他外部 AI。
- 本地 TXT、MD、CSV、JSON 文件上传，单文件 10 MB 限制。
- 文件保存在 `data/uploads/<团队>/<项目>/`，文字解析后写入本地资料索引，可通过项目查询检索。
- 文件类型、大小、空内容、JSON 格式和文本长度校验；上传、解析和索引过程写入团队审计记录。
- 团队运营快照导出、监控卡片和 P0-P3 运维事件。

## 当前限制

- 暂不支持 PDF、Word、Excel 的内容解析；如需支持，后续可增加本地解析依赖，不把文件发送到外部服务。
- 暂不提供公网访问、在线注册入口、外部只读分享或线上同步。
- `docs/vibe-coding/` 保留原始 SOP 和设计记录，其中涉及 Cloudflare/Supabase/Vercel 的内容属于历史迁移记录，不是当前运行方式。

## 检查命令

```bash
npm run lint
npm test
npm run build
```

## 数据与安全

- 不要把 `.env`、`data/`、真实项目资料、密码或会话令牌提交到 GitHub。
- 本地数据库和上传文件只保存在运行项目的电脑上；备份请由使用者自行复制 `data/` 到受控位置。
- 团队范围由服务端会话取得，不能由前端传入的团队编号决定。
- 查询只使用当前团队的项目字段和本地资料索引，不调用外部模型补全事实。
