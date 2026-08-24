import { statusLabel, type Project } from "../lib/project-data";

interface ProjectCardProps {
  project: Project;
  selected: boolean;
  onSelect: (project: Project) => void;
}

export function ProjectCard({ project, selected, onSelect }: ProjectCardProps) {
  return (
    <button
      type="button"
      className={`project-card${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(project)}
    >
      <div className="project-card-top">
        <div>
          <h3>{project.name}</h3>
          <p>{project.stage}</p>
        </div>
        <span className={`status-badge status-${project.status}`}>
          {statusLabel[project.status] ?? project.status}
        </span>
      </div>
      <div className="project-meta">
        <span>负责人：{project.owner}</span>
        <span>更新于：{project.lastUpdated}</span>
      </div>
    </button>
  );
}
