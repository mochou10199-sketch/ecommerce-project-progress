"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ProjectDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  extractedChars: number;
  errorMessage?: string | null;
  createdAt: string;
};

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDocuments({ projectId, canUpload }: { projectId: string; canUpload: boolean }) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/documents`, { cache: "no-store" });
      const payload = await response.json() as { documents?: ProjectDocument[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "无法读取项目资料。");
      setDocuments(payload.documents ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取项目资料。");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setNotice("请选择 TXT、MD、CSV 或 JSON 文件。");
      return;
    }
    setIsUploading(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "文件上传失败。");
      setFile(null);
      event.currentTarget.reset();
      setNotice("文件已保存在本地，并完成文字索引。");
      await loadDocuments();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件上传失败。");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="project-documents">
      <p className="subheading">本地资料</p>
      <p className="document-help">文件只保存到运行此项目的本机，不会上传到外部服务；支持 TXT、MD、CSV、JSON，单个文件不超过 10 MB。</p>
      {canUpload ? <form className="document-upload" onSubmit={upload}>
        <input type="file" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <button className="secondary-button" type="submit" disabled={isUploading}>{isUploading ? "索引中…" : "上传并建立索引"}</button>
      </form> : null}
      {notice ? <p className="document-notice" role="status">{notice}</p> : null}
      {isLoading ? <p className="document-help">正在读取本地资料…</p> : documents.length ? <div className="document-list">{documents.map((document) => <div className="document-row" key={document.id}><div><strong>{document.originalName}</strong><span>{formatSize(document.sizeBytes)} · {document.extractedChars.toLocaleString()} 字 · {document.status === "indexed" ? "已索引" : document.status}</span></div></div>)}</div> : <p className="document-help">当前项目还没有上传资料。</p>}
    </section>
  );
}
