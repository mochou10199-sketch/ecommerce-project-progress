"use client";

import { FormEvent, useState } from "react";
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth-policy";

interface PasswordChangePanelProps {
  username: string;
  onCompleted: () => void;
  onLogout: () => void;
}

export function PasswordChangePanel({ username, onCompleted, onLogout }: PasswordChangePanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
      setMessage(PASSWORD_LENGTH_MESSAGE);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致。");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "密码修改失败。");
      onCompleted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密码修改失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card password-change-card">
        <div className="brand auth-brand"><span className="brand-mark">EP</span><div><h1>电商项目进度助手</h1><p>账号 {username} · 首次进入安全设置</p></div></div>
        <div className="auth-heading">
          <span className="eyebrow dark-eyebrow">需要完成安全设置</span>
          <h2>请先修改初始密码</h2>
          <p>这是团队母账号为你创建的初始密码。修改完成后才能进入团队项目空间。</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>当前密码<input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>新密码<input type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={`${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 个字符`} autoComplete="new-password" /></label>
          <label>确认新密码<input type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          {message ? <p className="auth-error" role="alert">{message}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? "保存中…" : "保存新密码并进入团队"}</button>
        </form>
        <button className="auth-switch" type="button" onClick={onLogout}>退出当前账号</button>
      </section>
    </main>
  );
}
