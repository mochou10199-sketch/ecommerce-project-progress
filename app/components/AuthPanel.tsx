"use client";

import { FormEvent, useState } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth-policy";

export type ClientAuthUser = {
  id: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
};

interface AuthPanelProps {
  onAuthenticated: (user: ClientAuthUser, notice?: string) => void;
}

export function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [teamCode, setTeamCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamCode, teamName, username, password }),
      });
      const raw = await response.text();
      let payload: { user?: ClientAuthUser; teamCode?: string; message?: string; error?: string } = {};
      try {
        payload = raw ? JSON.parse(raw) as typeof payload : {};
      } catch {
        throw new Error(`登录服务暂时不可用（HTTP ${response.status}）。请稍后重试。`);
      }
      if (!response.ok || !payload.user) throw new Error(payload.error || "暂时无法完成操作。");
      const notice = mode === "register" && payload.teamCode
        ? `团队创建成功。请保存团队编号：${payload.teamCode}`
        : payload.message;
      onAuthenticated(payload.user, notice);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法完成操作。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand"><span className="brand-mark">EP</span><div><h1>电商项目进度助手</h1><p>安全地进入你的团队空间</p></div></div>
        <div className="auth-heading">
          <span className="eyebrow dark-eyebrow">团队工作空间</span>
          <h2>{mode === "login" ? "进入团队" : "注册团队母账号"}</h2>
          <p>{mode === "login" ? "使用团队编号、用户名和密码进入。未加入团队的用户无法查看项目。" : "创建公司的独立团队空间，后续可以在团队内管理成员和项目。"}</p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" ? (
            <label>公司/团队名称<input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="例如：星河电商团队" autoComplete="organization" /></label>
          ) : (
            <label>团队编号<input value={teamCode} onChange={(event) => setTeamCode(event.target.value)} placeholder="注册后获得的 8 位编号" autoComplete="organization" /></label>
          )}
          <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-32 位字母、数字或下划线" autoComplete={mode === "login" ? "username" : "username"} /></label>
          <label>密码<input type="password" value={password} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} onChange={(event) => setPassword(event.target.value)} placeholder={`${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 个字符`} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
          {message ? <p className="auth-error" role="alert">{message}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? "处理中…" : mode === "login" ? "进入团队" : "注册团队"}</button>
        </form>

        <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
          {mode === "login" ? "还没有团队？注册团队母账号" : "已有团队？返回登录"}
        </button>
      </section>
    </main>
  );
}
