import { statusLabel, type Project } from "../lib/project-data";
import { projectPriorityOptions } from "../lib/project-options";
import { ProjectDocuments } from "./ProjectDocuments";

interface ProjectDetailProps {
  project: Project;
  assistantText?: string;
  mode?: "model" | "local" | "fallback";
  onEdit?: () => void;
  onArchive?: () => void | Promise<void>;
}

const modeLabel = {
  model: "AI 已基于已验证资料整理",
  local: "本地规则回答（配置模型密钥后可启用 AI 整理）",
  fallback: "AI 服务暂不可用，以下为可验证资料结论",
};

function priorityLabel(value?: string) {
  return projectPriorityOptions.find((option) => option.value === value)?.label ?? value ?? "普通";
}

export function ProjectDetail({ project, assistantText, mode, onEdit, onArchive }: ProjectDetailProps) {
  return (
    <>
      <p className="answer-kicker">项目详情</p>
      <div className="detail-heading"><h2>{project.name}</h2><div className="detail-actions">{onEdit ? <button className="text-button" type="button" onClick={onEdit}>编辑</button> : null}{onArchive ? <button className="text-button danger" type="button" onClick={() => { if (window.confirm("确认归档这个项目吗？归档后不会再出现在项目列表中。")) void onArchive(); }}>归档</button> : null}</div></div>
      <span className={`status-badge status-${project.status}`}>
        {statusLabel[project.status] ?? project.status}
      </span>
      <p className="answer-lead">{assistantText ?? project.progress}</p>
      {mode ? <span className="assistant-source">{modeLabel[mode]}</span> : null}

      <div className="detail-grid">
        <div className="detail-item"><span>项目类型</span><strong>{project.category || "未分类"}</strong></div>
        <div className="detail-item"><span>当前阶段</span><strong>{project.stage}</strong></div>
        <div className="detail-item"><span>优先级</span><strong>{priorityLabel(project.priority)}</strong></div>
        <div className="detail-item"><span>完成比例</span><strong>{project.progressPercent ?? 0}%</strong></div>
        <div className="detail-item"><span>计划完成日期</span><strong>{project.plannedEndDate}</strong></div>
        <div className="detail-item"><span>负责人</span><strong>{project.owner}</strong></div>
        <div className="detail-item"><span>最后更新时间</span><strong>{project.lastUpdated}</strong></div>
      </div>

      {project.description ? <><p className="subheading">项目说明</p><p className="detail-description">{project.description}</p></> : null}

      <p className="subheading">阻塞项与风险</p>
      <div className="chip-row">
        {project.blockers.map((blocker) => <span className="chip risk" key={blocker}>{blocker}</span>)}
      </div>

      <p className="subheading">资料来源</p>
      <div className="chip-row">
        {project.sources.map((source) => <span className="chip" key={source}>{source}</span>)}
      </div>
      <ProjectDocuments projectId={project.id} canUpload={Boolean(onEdit)} />
    </>
  );
}
