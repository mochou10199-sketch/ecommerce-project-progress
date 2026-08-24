"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { statusLabel, type Project } from "../lib/project-data";
import { plannedDateOptions, projectPriorityOptions, progressPercentOptions } from "../lib/project-options";
import { AuthPanel, type ClientAuthUser } from "./AuthPanel";
import type { QuestionResult } from "../lib/project-query";
import { ProjectCard } from "./ProjectCard";
import { ProjectDetail } from "./ProjectDetail";
import { TeamAdminPanel } from "./TeamAdminPanel";
import { ProjectEditor } from "./ProjectEditor";
import { PasswordChangePanel } from "./PasswordChangePanel";

type AiMode = "model" | "local" | "fallback";

interface AskResponse {
  result: QuestionResult;
  assistantText: string;
  mode: AiMode;
}

interface ProjectApiRecord {
  id: string;
  name: string;
  category: string;
  stage: string;
  statusId: string;
  status: string;
  statusLabel: string;
  priority: string;
  plannedEndDate: string;
  description: string;
  progress: string;
  progressPercent: number;
  blockers: string[];
  owner: string;
  lastUpdated: string;
  sources: string[];
}

const quickQuestions = [
  "现在所有项目进展如何？",
  "项目目前有哪些风险？",
  "谁负责当前项目？",
];

const PROJECT_SYNC_INTERVAL_MS = 15_000;

function hasPermission(user: ClientAuthUser, permission: string) {
  return user.permissions?.includes(permission) ?? (user.role === "owner" || ["project.view", "project.create", "project.edit"].includes(permission));
}

type ProjectStatusOption = { id: string; name: string; code: string; isActive: boolean };

function syncAnswerProjects(answer: AskResponse | null, nextProjects: Project[]) {
  if (!answer) return answer;
  if (answer.result.kind === "project") {
    const project = nextProjects.find((item) => item.id === answer.result.project.id);
    return project ? { ...answer, result: { ...answer.result, project } } : answer;
  }
  const projectsById = new Map(nextProjects.map((project) => [project.id, project]));
  return { ...answer, result: { ...answer.result, projects: answer.result.projects.map((project) => projectsById.get(project.id) ?? project) } };
}

function toProject(record: ProjectApiRecord): Project {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    keywords: [record.name, record.stage],
    statusId: record.statusId,
    status: record.status,
    stage: record.stage,
    priority: record.priority,
    plannedEndDate: record.plannedEndDate,
    description: record.description,
    progress: record.progress,
    progressPercent: record.progressPercent,
    blockers: record.blockers,
    owner: record.owner,
    lastUpdated: record.lastUpdated,
    sources: record.sources,
  };
}

export function ProjectDashboard() {
  const plannedEndDateOptions = useMemo(() => plannedDateOptions(), []);
  const [authUser, setAuthUser] = useState<ClientAuthUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatusOption[]>([]);
  const [isLoadingProjectStatuses, setIsLoadingProjectStatuses] = useState(true);
  const [isRefreshingProjects, setIsRefreshingProjects] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [notice, setNotice] = useState("");
  const editingProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    editingProjectRef.current = editingProject;
  }, [editingProject]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => response.ok ? response.json() as Promise<{ user: ClientAuthUser }> : { user: null })
      .then((payload) => setAuthUser(payload.user ?? null))
      .catch(() => setAuthUser(null))
      .finally(() => setIsLoadingAuth(false));
  }, []);

  useEffect(() => {
    if (!authUser || !hasPermission(authUser, "project.view")) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const syncProjects = async (showError: boolean) => {
      if (inFlight) return;
      inFlight = true;
      setIsRefreshingProjects(true);
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) throw new Error("无法读取团队项目");
        const payload = await response.json() as { projects: ProjectApiRecord[] };
        if (cancelled) return;
        const nextProjects = payload.projects.map(toProject);
        setProjectList(nextProjects);
        setSelectedProject((current) => nextProjects.find((project) => project.id === current?.id) ?? nextProjects[0] ?? null);
        setAnswer((current) => syncAnswerProjects(current, nextProjects));
        setLastSyncedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      } catch {
        if (showError && !cancelled) setNotice("暂时无法读取团队项目，请检查数据库和登录状态。");
      } finally {
        inFlight = false;
        if (!cancelled) setIsRefreshingProjects(false);
      }
    };

    void syncProjects(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || editingProjectRef.current) return;
      void syncProjects(false);
    }, PROJECT_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !hasPermission(authUser, "project.create")) {
      return;
    }
    fetch("/api/project-statuses")
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取项目状态选项");
        return response.json() as Promise<{ statuses: ProjectStatusOption[] }>;
      })
      .then((payload) => setProjectStatuses(payload.statuses.filter((status) => status.isActive)))
      .catch(() => setNotice("暂时无法读取项目状态选项，请稍后重试。"))
      .finally(() => setIsLoadingProjectStatuses(false));
  }, [authUser]);

  const metrics = useMemo(() => [
    { label: "全部项目", value: projectList.length },
    { label: "正常进行", value: projectList.filter((project) => project.status === "on_track").length },
    { label: "存在风险", value: projectList.filter((project) => project.status === "at_risk").length },
    { label: "已经延期", value: projectList.filter((project) => project.status === "delayed").length },
  ], [projectList]);

  async function refreshProjects(preferredProjectId?: string) {
    setIsRefreshingProjects(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取项目");
      const payload = await response.json() as { projects: ProjectApiRecord[] };
      const nextProjects = payload.projects.map(toProject);
      setProjectList(nextProjects);
      setSelectedProject((current) => nextProjects.find((project) => project.id === (preferredProjectId ?? current?.id)) ?? nextProjects[0] ?? null);
      setAnswer((current) => syncAnswerProjects(current, nextProjects));
      setLastSyncedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } finally {
      setIsRefreshingProjects(false);
    }
  }

  async function askQuestion(event?: FormEvent<HTMLFormElement>, presetQuestion?: string) {
    event?.preventDefault();
    const currentQuestion = (presetQuestion ?? question).trim();
    if (!currentQuestion) return;
    if (!authUser || !hasPermission(authUser, "project.view")) {
      setNotice("当前角色没有查看项目的权限，请联系团队母账号调整角色。");
      return;
    }
    setQuestion(currentQuestion);
    setIsAsking(true);
    setNotice("");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion }),
      });
      if (response.status === 401) {
        setAuthUser(null);
        throw new Error("请先登录团队。");
      }
      if (!response.ok) throw new Error("查询接口暂时不可用");
      const payload = await response.json() as AskResponse;
      setAnswer(payload);
      if (payload.result.kind === "project") setSelectedProject(payload.result.project);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "项目查询暂不可用。");
    } finally {
      setIsAsking(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsCreating(true);
    setNotice("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          category: form.get("category"),
          stage: form.get("stage"),
          statusId: form.get("statusId"),
          priority: form.get("priority"),
          progress: form.get("progress"),
          description: form.get("description"),
          progressPercent: form.get("progressPercent"),
          plannedEndDate: form.get("plannedEndDate"),
          blockers: String(form.get("blockers") || "").split("\n").map((item) => item.trim()).filter(Boolean),
          sources: String(form.get("sources") || "").split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "项目创建失败");
      event.currentTarget.reset();
      await refreshProjects();
      setNotice("项目已保存到当前团队。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "项目创建失败。");
    } finally {
      setIsCreating(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setAnswer(null);
    setNotice("");
  }

  if (isLoadingAuth) return <main className="loading-shell"><p>正在确认团队会话…</p></main>;
  if (!authUser) return <AuthPanel onAuthenticated={(user, message) => { setAuthUser(user); setNotice(message || ""); }} />;
  if (authUser.mustChangePassword) return <PasswordChangePanel username={authUser.username} onCompleted={() => { setAuthUser((current) => current ? { ...current, mustChangePassword: false } : current); setNotice("密码已更新，欢迎进入团队。"); }} onLogout={logout} />;

  const canViewProjects = hasPermission(authUser, "project.view");
  const canCreateProjects = hasPermission(authUser, "project.create");
  const canEditProjects = hasPermission(authUser, "project.edit");
  const canArchiveProjects = hasPermission(authUser, "project.archive");

  const currentProject = answer?.result.kind === "project" ? answer.result.project : selectedProject;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">EP</span>
            <div><h1>电商项目进度助手</h1><p>{authUser.teamName} · 团队编号 {authUser.teamCode}</p></div>
          </div>
          <div className="topbar-actions"><span className="data-notice">团队数据隔离 · 不调用外部 AI</span><button className="logout-button" type="button" onClick={logout}>退出团队</button></div>
        </div>
      </header>

      <main className="dashboard">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">安全的团队项目空间</span>
            <h2>先守住团队边界，再让项目进度变清楚。</h2>
            <p>项目数据保存在当前团队范围内，查询使用本地规则和已验证资料，不将项目内容发送给外部 AI。</p>
          </div>

          <section className="ask-card" aria-label="项目查询">
            <h2>查询团队项目</h2>
            <p>{canViewProjects ? "试试查询项目进度、负责人，或查看团队风险。" : "当前角色没有项目查看权限，请联系团队母账号。"}</p>
            <form className="ask-form" onSubmit={(event) => askQuestion(event)}>
              <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="输入项目问题" placeholder="例如：现在所有项目进展如何？" disabled={!canViewProjects} />
              <button className="primary-button" type="submit" disabled={isAsking || !canViewProjects}>{isAsking ? "查询中" : "查询"}</button>
            </form>
            {canViewProjects ? <div className="quick-questions">
              {quickQuestions.map((item) => <button className="quick-question" type="button" key={item} onClick={() => askQuestion(undefined, item)}>{item}</button>)}
            </div> : null}
          </section>
        </section>

        {notice ? <p className="page-notice" role="status">{notice}</p> : null}

        <section className="metrics" aria-label="项目状态总览">
          {metrics.map((metric) => <div className="metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
        </section>

        <section className="workspace">
          <section className="section-card">
            <div className="section-heading"><div><h2>项目总览</h2><p>只展示当前团队的数据</p></div><div className="section-heading-actions"><span className="sync-status" role="status">{isRefreshingProjects ? "同步中…" : lastSyncedAt ? `自动同步于 ${lastSyncedAt}` : "每 15 秒自动同步"}</span>{canViewProjects ? <button className="text-button" type="button" onClick={() => { void refreshProjects(); }} disabled={isRefreshingProjects}>立即刷新</button> : null}<span className="role-label">{authUser.roleName || (authUser.role === "owner" ? "团队母账号" : "团队成员")}</span></div></div>
            {canCreateProjects ? <form className="create-form" onSubmit={createProject}>
              <div className="create-form-heading"><h3>创建项目</h3><span>首条数据闭环</span></div>
              <div className="create-form-grid"><label>项目名称<input name="name" required maxLength={120} placeholder="例如：双十一活动" aria-label="项目名称" /></label><label>项目类型<select name="category" defaultValue="" aria-label="项目类型"><option value="">请选择类型</option><option value="商品运营">商品运营</option><option value="营销活动">营销活动</option><option value="店铺运营">店铺运营</option><option value="供应链">供应链</option><option value="数据分析">数据分析</option><option value="其他">其他</option></select></label><label>当前阶段<input name="stage" required maxLength={120} placeholder="例如：方案评审" aria-label="当前阶段" /></label></div>
              <div className="create-form-grid"><label>项目状态<select key={projectStatuses[0]?.id ?? "loading"} name="statusId" defaultValue={projectStatuses[0]?.id ?? ""} disabled={isLoadingProjectStatuses} required aria-label="项目状态"><option value="">{isLoadingProjectStatuses ? "读取状态中…" : "请选择状态"}</option>{projectStatuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}</select></label><label>优先级<select name="priority" defaultValue="medium" aria-label="项目优先级">{projectPriorityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>计划完成日期<select name="plannedEndDate" defaultValue="" aria-label="计划完成日期">{plannedEndDateOptions.map((option) => <option value={option.value} key={`${option.value}-${option.label}`}>{option.label}</option>)}</select></label></div>
              <div className="create-form-grid"><label>完成比例<select name="progressPercent" defaultValue="0" aria-label="完成比例">{progressPercentOptions.map((value) => <option value={value} key={value}>{value}%</option>)}</select></label><div className="form-helper">日期和完成比例采用统一选项，方便团队统计与筛选；项目阶段仍可按公司流程自定义。</div></div>
              <label>项目说明<textarea name="description" maxLength={1000} placeholder="项目目标、交付物、范围和验收标准" aria-label="项目说明" /></label>
              <label>当前进展<textarea name="progress" maxLength={2000} placeholder="当前进展、已完成事项和下一步计划" aria-label="当前进展" /></label>
              <div className="create-form-grid"><label>阻塞项（每行一条）<textarea name="blockers" placeholder="例如：等待设计稿；每行一条" aria-label="阻塞项" /></label><label>资料来源（每行一条）<textarea name="sources" placeholder="例如：需求文档、会议纪要；每行一条" aria-label="资料来源" /></label></div>
              <button className="secondary-button" type="submit" disabled={isCreating || isLoadingProjectStatuses}>{isCreating ? "保存中…" : "保存项目"}</button>
            </form> : <p className="permission-note">当前角色只能查看项目，不能创建新项目。</p>}
            {canViewProjects ? <div className="project-list">
              {projectList.length ? projectList.map((project) => <ProjectCard key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={(item) => { setSelectedProject(item); setEditingProject(null); setAnswer(null); }} />) : <div className="list-empty"><strong>当前团队还没有项目</strong><span>{canCreateProjects ? "先创建一个项目，验证从数据保存到查询的完整路径。" : "当前团队还没有可查看的项目。"}</span></div>}
            </div> : <div className="empty-state"><h2>项目权限受限</h2><p>请联系团队母账号为当前角色开通“查看项目”。</p></div>}
          </section>

          <section className="section-card answer-panel" aria-live="polite">
            {isAsking ? <div className="empty-state"><p className="loading-line"><span className="loading-dot" />正在检索当前团队资料…</p></div> : answer?.result.kind === "portfolio" ? (
              <><p className="answer-kicker">项目组合回答</p><h2>{answer.result.title}</h2><p className="answer-lead">{answer.assistantText}</p><span className="assistant-source">本地规则结论 · 不调用外部 AI</span><p className="subheading">需要优先关注</p><div className="chip-row">{answer.result.projects.filter((project) => project.status !== "on_track").map((project) => <span className="chip risk" key={project.id}>{project.name} · {statusLabel[project.status] ?? project.status}</span>)}</div></>
            ) : answer?.result.kind === "clarify" || answer?.result.kind === "no_data" ? <div className="empty-state"><h2>{answer.result.title}</h2><p>{answer.assistantText || answer.result.summary}</p></div> : currentProject ? editingProject?.id === currentProject.id ? <ProjectEditor project={editingProject} onCancel={() => setEditingProject(null)} onSaved={async () => { setEditingProject(null); await refreshProjects(currentProject.id); setNotice("项目已更新。"); }} onConflict={async () => { setEditingProject(null); await refreshProjects(currentProject.id); setNotice("项目已被其他成员更新，已刷新最新内容，请重新打开编辑。"); }} /> : <ProjectDetail project={currentProject} assistantText={answer?.assistantText} mode="local" onEdit={canEditProjects ? () => { setEditingProject(currentProject); setAnswer(null); } : undefined} onArchive={canArchiveProjects ? async () => { const response = await fetch(`/api/projects/${currentProject.id}`, { method: "DELETE" }); const payload = await response.json() as { error?: string }; if (!response.ok) { setNotice(payload.error || "项目归档失败。"); return; } setEditingProject(null); setAnswer(null); await refreshProjects(); setNotice("项目已归档。"); } : undefined} /> : <div className="empty-state"><h2>项目详情</h2><p>创建或选择项目后，这里会展示当前团队的进度、风险和资料来源。</p></div>}
          </section>
        </section>

        {hasPermission(authUser, "team.manage") ? <TeamAdminPanel /> : null}
      </main>
    </div>
  );
}
