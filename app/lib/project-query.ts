import { projects, statusLabel, type Project } from "./project-data";

export type QuestionResult =
  | {
      kind: "project";
      title: string;
      summary: string;
      project: Project;
      sources: string[];
      documents?: DocumentSearchHit[];
    }
  | {
      kind: "portfolio";
      title: string;
      summary: string;
      projects: Project[];
      sources: string[];
    }
  | {
      kind: "clarify";
      title: string;
      summary: string;
      projects: Project[];
      sources: string[];
    }
  | {
      kind: "no_data";
      title: string;
      summary: string;
      projects: Project[];
      sources: string[];
      documents?: DocumentSearchHit[];
    };

export type DocumentSearchRow = {
  projectId: string;
  documentId: string;
  title: string;
  content: string;
  searchText: string;
};

export type DocumentSearchHit = {
  projectId: string;
  documentId: string;
  title: string;
  snippet: string;
  score: number;
};

function questionTerms(question: string) {
  const runs = question.toLocaleLowerCase("zh-CN").match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/gi) ?? [];
  return [...new Set(runs)].filter((term) => !/^(现在|目前|项目|进展|情况|一下|如何|哪些|什么|查看|查询)$/.test(term)).slice(0, 12);
}

export function searchDocumentRows(question: string, rows: DocumentSearchRow[]): DocumentSearchHit[] {
  const terms = questionTerms(question);
  if (!terms.length) return [];
  return rows.map((row) => {
    const text = row.searchText.toLocaleLowerCase("zh-CN");
    const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
    const firstTerm = terms.find((term) => text.includes(term));
    const index = firstTerm ? text.indexOf(firstTerm) : 0;
    const start = Math.max(0, index - 80);
    const snippet = row.content.slice(start, start + 260).replace(/\s+/g, " ").trim();
    return { projectId: row.projectId, documentId: row.documentId, title: row.title, snippet, score };
  }).filter((row) => row.score > 0).sort((left, right) => right.score - left.score).slice(0, 8);
}

function hasPortfolioIntent(question: string) {
  return /全部|所有|整体|总览|项目进展|项目状态|项目风险|哪些风险|延期项目/.test(question);
}

export function resolveProjectQuestion(
  question: string,
  sourceProjects: Project[] = projects,
  documentMatches: DocumentSearchHit[] = [],
): QuestionResult {
  const cleanQuestion = question.trim();

  if (hasPortfolioIntent(cleanQuestion)) {
    const delayed = sourceProjects.filter((project) => project.status === "delayed");
    const atRisk = sourceProjects.filter((project) => project.status === "at_risk");

    return {
      kind: "portfolio",
      title: "当前项目组合概览",
      summary: `目前有 ${sourceProjects.length} 个项目：正常 ${sourceProjects.filter((project) => project.status === "on_track").length} 个、有风险 ${atRisk.length} 个、已延期 ${delayed.length} 个。请优先关注 ${[...delayed, ...atRisk].map((project) => project.name).join("、") || "当前没有标记为风险或延期的项目"}。`,
      projects: sourceProjects,
      sources: sourceProjects.flatMap((project) => project.sources),
    };
  }

  const matches = sourceProjects.filter((project) =>
    project.keywords.some((keyword) => cleanQuestion.includes(keyword)),
  );

  if (matches.length === 1) {
    const project = matches[0];
    return {
      kind: "project",
      title: project.name,
      summary: `当前状态为${statusLabel[project.status]}，正在进行${project.stage}。${project.progress}`,
      project,
      sources: project.sources,
      documents: documentMatches.filter((document) => document.projectId === project.id),
    };
  }

  if (matches.length > 1) {
    return {
      kind: "clarify",
      title: "找到多个可能的项目",
      summary: "请确认你要查询的项目名称，系统不会把多个项目的资料混合成一个结论。",
      projects: matches,
      sources: [],
    };
  }

  if (documentMatches.length) {
    return {
      kind: "no_data",
      title: "找到团队资料",
      summary: `已在当前团队的本地资料索引中找到 ${documentMatches.length} 条相关内容。${documentMatches.slice(0, 3).map((document) => `【${document.title}】${document.snippet}`).join("；")}`,
      projects: [],
      documents: documentMatches,
      sources: [...new Set(documentMatches.map((document) => document.title))],
    };
  }

  return {
    kind: "no_data",
    title: "没有找到对应项目数据",
    summary: "请检查项目名称，或上传该项目的排期表、周报、会议纪要等资料后再查询。",
    projects: [],
    sources: [],
  };
}
