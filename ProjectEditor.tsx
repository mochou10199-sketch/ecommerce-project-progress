"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Project } from "../lib/project-data";
import { plannedDateOptions, projectPriorityOptions, progressPercentOptions } from "../lib/project-options";

type ProjectStatusOption = { id: string; name: string; code: string; isActive: boolean };

interface ProjectEditorProps {
  project: Project;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onConflict?: () => void | Promise<void>;
}

async function responseJson<T>(response: Response) {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(payload.error || "项目更新失败。");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload;
}

export function ProjectEditor({ project, onCancel, onSaved, onConflict }: ProjectEditorProps) {
  const plannedOptions = plannedDateOptions();
  const existingPlannedDate = project.plannedEndDate === "未设置" ? "" : project.plannedEndDate;
  const dateOptions = existingPlannedDate && !plannedOptions.some((option) => option.value === existingPlannedDate)
    ? [...plannedOptions, { value: existingPlannedDate, label: `当前日期（${existingPlannedDate}）` }]
    : plannedOptions;
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category ?? "");
  const [stage, setStage] = useState(project.stage);
  const [statusId, setStatusId] = useState(project.statusId ?? "");
  const [priority, setPriority] = useState(project.priority ?? "medium");
  const [plannedEndDate, setPlannedEndDate] = useState(existingPlannedDate);
  const [description, setDescription] = useState(project.description ?? "");
  const [progress, setProgress] = useState(project.progress);
  const [progressPercent, setProgressPercent] = useState(String(project.progressPercent ?? 0));
  const [blockers, setBlockers] = useState(project.blockers.join("\n"));
  const [sources, setSources] = useState(project.sources.join("\n"));
  const [statuses, setStatuses] = useState<ProjectStatusOption[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/project-statuses")
        .then((response) => responseJson<{ statuses: ProjectStatusOption[] }>(response))
        .then((payload) => {
          setStatuses(payload.statuses);
          if (!payload.statuses.some((status) => status.id === statusId && status.isActive)) {
            setStatusId(payload.statuses.find((status) => status.isActive)?.id ?? "");
          }
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法读取项目状态。"))
        .finally(() => setIsLoadingStatuses(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [statusId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, category, stage, statusId, priority, plannedEndDate, description, progress, progressPercent,
          expectedUpdatedAt: project.lastUpdated,
          blockers: blockers.split("\n").map((item) => item.trim()).filter(Boolean),
          sources: sources.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      }));
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目更新失败。");
      if (reason instanceof Error && (reason as Error & { status?: number }).status === 409) await onConflict?.();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="project-editor" onSubmit={save}>
      <div className="editor-heading"><div><p className="answer-kicker">编辑项目</p><h2>更新项目事实</h2></div><button className="text-button" type="button" onClick={onCancel}>取消</button></div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
      <label>项目类型<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">请选择类型</option><option value="商品运营">商品运营</option><option value="营销活动">营销活动</option><option value="店铺运营">店铺运营</option><option value="供应链">供应链</option><option value="数据分析">数据分析</option><option value="其他">其他</option></select></label>
      <label>当前阶段<input value={stage} onChange={(event) => setStage(event.target.value)} required maxLength={120} /></label>
      <label>项目状态<select value={statusId} onChange={(event) => setStatusId(event.target.value)} disabled={isLoadingStatuses} required><option value="">{isLoadingStatuses ? "读取状态中…" : "请选择状态"}</option>{statuses.filter((status) => status.isActive).map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}</select></label>
      <label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}>{projectPriorityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
      <label>计划完成日期<select value={plannedEndDate} onChange={(event) => setPlannedEndDate(event.target.value)}>{dateOptions.map((option) => <option value={option.value} key={`${option.value}-${option.label}`}>{option.label}</option>)}</select></label>
      <label>完成比例<select value={progressPercent} onChange={(event) => setProgressPercent(event.target.value)}>{progressPercentOptions.map((value) => <option value={value} key={value}>{value}%</option>)}</select></label>
      <label>项目说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="项目目标、交付物、范围和验收标准" /></label>
      <label>当前进展<textarea value={progress} onChange={(event) => setProgress(event.target.value)} maxLength={2000} /></label>
      <label>阻塞项（每行一条）<textarea value={blockers} onChange={(event) => setBlockers(event.target.value)} /></label>
      <label>资料来源（每行一条）<textarea value={sources} onChange={(event) => setSources(event.target.value)} /></label>
      <div className="editor-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button editor-save" type="submit" disabled={isSaving || isLoadingStatuses}>{isSaving ? "保存中…" : "保存修改"}</button></div>
    </form>
  );
}
