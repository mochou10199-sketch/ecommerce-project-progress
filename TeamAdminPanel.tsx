"use client";

import { FormEvent, useEffect, useState } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth-policy";
import { INCIDENT_RESPONSE_STATE_LABELS, INCIDENT_RESPONSE_TARGETS, INCIDENT_SEVERITIES, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, type IncidentResponseState, type IncidentSeverity, type IncidentStatus } from "../lib/incident-options";
import { ROLE_PERMISSION_LABELS, ROLE_PERMISSIONS, type CustomRolePermission } from "../lib/role-options";

type TeamMember = {
  id: string;
  username: string;
  role: string;
  roleName: string;
  status: "active" | "suspended";
  lastLoginAt: string | null;
};

type TeamStatus = {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
};

type TeamRole = {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: CustomRolePermission[];
  isSystem: boolean;
  isActive: boolean;
  assignedCount: number;
};

type AuditLog = {
  id: string;
  action: string;
  resourceType: string;
  result: string;
  createdAt: string;
  username: string | null;
};

type MonitoringSnapshot = {
  checkedAt: string;
  activeMembers: number;
  activeProjects: number;
  loginFailures24h: number;
  securityFailures24h: number;
  latestActivity: { action: string; result: string; createdAt: string } | null;
  latestFailure: { action: string; result: string; createdAt: string } | null;
};

type IncidentRecord = {
  id: string;
  code: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  impact: string;
  description: string;
  temporaryAction: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdByUsername: string | null;
  responseDueAt: string;
  responseState: IncidentResponseState;
};

type ApiError = { error?: string };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as ApiError).error || "管理操作失败。");
  return payload as T;
}

function formatLoginDate(value: string | null) {
  if (!value) return "尚未登录";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function formatAuditDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "auth.login": "团队登录",
    "auth.login_failed": "登录失败",
    "auth.logout": "退出团队",
    "auth.password_changed": "修改密码",
    "team.register": "注册团队",
    "team.export": "导出运营快照",
    "incident.create": "记录运维事件",
    "incident.update": "更新运维事件",
    "team_member.create": "创建成员",
    "team_member.update": "更新成员状态",
    "team_member.password_reset": "重置成员密码",
    "team_member.role_update": "更新成员角色",
    "team_role.create": "创建团队角色",
    "team_role.update": "更新团队角色",
    "project.create": "创建项目",
    "project.update": "更新项目",
    "project.archive": "归档项目",
    "project_status.create": "创建项目状态",
    "project_status.update": "更新项目状态",
    "project_status.archive": "归档项目状态",
  };
  return labels[action] ?? action;
}

export function TeamAdminPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [statuses, setStatuses] = useState<TeamStatus[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringSnapshot | null>(null);
  const [teamIncidents, setTeamIncidents] = useState<IncidentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [isResettingMember, setIsResettingMember] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isSavingIncident, setIsSavingIncident] = useState(false);
  const [isSavingStatusEdit, setIsSavingStatusEdit] = useState(false);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isSavingRoleEdit, setIsSavingRoleEdit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [editingStatusId, setEditingStatusId] = useState("");
  const [editingStatusName, setEditingStatusName] = useState("");
  const [editingStatusColor, setEditingStatusColor] = useState("#64748b");
  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingRoleDescription, setEditingRoleDescription] = useState("");
  const [editingRolePermissions, setEditingRolePermissions] = useState<CustomRolePermission[]>(["project.view"]);
  const [newRolePermissions, setNewRolePermissions] = useState<CustomRolePermission[]>(["project.view"]);
  const [workingId, setWorkingId] = useState("");
  const [resettingMemberId, setResettingMemberId] = useState("");
  const [adminNotice, setAdminNotice] = useState("");

  async function refreshAdminData() {
    setIsLoading(true);
    try {
      const [memberResponse, statusResponse, roleResponse, auditResponse, monitoringResponse, incidentResponse] = await Promise.all([
        fetch("/api/team/members"),
        fetch("/api/project-statuses"),
        fetch("/api/team/roles"),
        fetch("/api/team/audit-logs"),
        fetch("/api/team/monitoring", { cache: "no-store" }),
        fetch("/api/team/incidents", { cache: "no-store" }),
      ]);
      const memberPayload = await readJson<{ members: TeamMember[] }>(memberResponse);
      const statusPayload = await readJson<{ statuses: TeamStatus[] }>(statusResponse);
      const rolePayload = await readJson<{ roles: TeamRole[] }>(roleResponse);
      const auditPayload = await readJson<{ logs: AuditLog[] }>(auditResponse);
      const monitoringPayload = await readJson<MonitoringSnapshot>(monitoringResponse);
      const incidentPayload = await readJson<{ incidents: IncidentRecord[] }>(incidentResponse);
      setMembers(memberPayload.members);
      setStatuses(statusPayload.statuses);
      setRoles(rolePayload.roles);
      setAuditLogs(auditPayload.logs);
      setMonitoring(monitoringPayload);
      setTeamIncidents(incidentPayload.incidents);
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "暂时无法读取团队管理数据。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshAdminData(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function exportSnapshot() {
    setIsExporting(true);
    setAdminNotice("");
    try {
      const response = await fetch("/api/team/export", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as ApiError;
        throw new Error(payload.error || "运营快照导出失败。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "team-snapshot.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      await refreshAdminData();
      setAdminNotice("运营快照已下载；文件不包含密码和会话令牌，也不能替代生产 D1 备份。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "运营快照导出失败。");
    } finally {
      setIsExporting(false);
    }
  }

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingIncident(true);
    setAdminNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch("/api/team/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          severity: form.get("severity"),
          title: form.get("title"),
          impact: form.get("impact"),
          description: form.get("description"),
          temporaryAction: form.get("temporaryAction"),
        }),
      }));
      event.currentTarget.reset();
      await refreshAdminData();
      setAdminNotice("运维事件已记录，并已写入安全活动记录。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "运维事件记录失败。");
    } finally {
      setIsSavingIncident(false);
    }
  }

  async function updateIncident(incident: IncidentRecord, updates: { severity?: IncidentSeverity; status?: IncidentStatus }) {
    setWorkingId(incident.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/team/incidents/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }));
      await refreshAdminData();
      setAdminNotice(updates.status === "resolved" ? "运维事件已关闭，并保留关闭时间。" : "运维事件状态已更新。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "运维事件更新失败。");
    } finally {
      setWorkingId("");
    }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingMember(true);
    setAdminNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password"), role: form.get("role") }),
      }));
      event.currentTarget.reset();
      await refreshAdminData();
      setAdminNotice("成员已创建；请把初始密码通过安全方式交给成员，成员首次登录必须修改密码。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "成员创建失败。");
    } finally {
      setIsSavingMember(false);
    }
  }

  async function changeMemberStatus(member: TeamMember) {
    const nextStatus = member.status === "active" ? "suspended" : "active";
    setWorkingId(member.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      }));
      await refreshAdminData();
      setAdminNotice(nextStatus === "suspended" ? "成员已停用，已有会话已失效。" : "成员已恢复使用。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "成员状态更新失败。");
    } finally {
      setWorkingId("");
    }
  }

  async function changeMemberRole(member: TeamMember, role: string) {
    if (!role || role === member.role) return;
    setWorkingId(member.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }));
      await refreshAdminData();
      setAdminNotice("成员角色已更新；为避免旧权限继续生效，成员已有会话已失效。请成员重新登录。 ");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "成员角色更新失败。");
    } finally {
      setWorkingId("");
    }
  }

  function startMemberPasswordReset(member: TeamMember) {
    setResettingMemberId(member.id);
    setAdminNotice("");
  }

  function cancelMemberPasswordReset() {
    setResettingMemberId("");
  }

  async function resetMemberPassword(event: FormEvent<HTMLFormElement>, member: TeamMember) {
    event.preventDefault();
    setIsResettingMember(true);
    setAdminNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch(`/api/team/members/${member.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: form.get("newPassword") }),
      }));
      cancelMemberPasswordReset();
      await refreshAdminData();
      setAdminNotice("成员密码已重置；旧会话已失效，请通过安全方式交付新密码，成员下次登录必须修改密码。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "成员密码重置失败。");
    } finally {
      setIsResettingMember(false);
    }
  }

  function togglePermission(current: CustomRolePermission[], permission: CustomRolePermission, checked: boolean) {
    if (permission === "project.view" && !checked) return current;
    return checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission);
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingRole(true);
    setAdminNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch("/api/team/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), description: form.get("description"), permissions: newRolePermissions }),
      }));
      event.currentTarget.reset();
      setNewRolePermissions(["project.view"]);
      await refreshAdminData();
      setAdminNotice("自定义角色已创建，只影响当前团队。母账号权限不会被转授。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "自定义角色创建失败。");
    } finally {
      setIsSavingRole(false);
    }
  }

  function startRoleEdit(role: TeamRole) {
    if (role.isSystem) return;
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
    setEditingRoleDescription(role.description);
    setEditingRolePermissions(role.permissions.includes("project.view") ? role.permissions : ["project.view", ...role.permissions]);
    setAdminNotice("");
  }

  function cancelRoleEdit() {
    setEditingRoleId("");
    setEditingRoleName("");
    setEditingRoleDescription("");
    setEditingRolePermissions(["project.view"]);
  }

  async function saveRoleEdit(event: FormEvent<HTMLFormElement>, roleId: string) {
    event.preventDefault();
    setIsSavingRoleEdit(true);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/team/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingRoleName, description: editingRoleDescription, permissions: editingRolePermissions }),
      }));
      cancelRoleEdit();
      await refreshAdminData();
      setAdminNotice("自定义角色已更新。已有成员会话会在下一次请求时按新权限生效。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "自定义角色更新失败。");
    } finally {
      setIsSavingRoleEdit(false);
    }
  }

  async function toggleRole(role: TeamRole) {
    setWorkingId(role.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/team/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !role.isActive }),
      }));
      await refreshAdminData();
      setAdminNotice(role.isActive ? "角色已停用；请先确保没有成员继续使用它。" : "角色已恢复使用。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "角色状态更新失败。");
    } finally {
      setWorkingId("");
    }
  }

  async function createStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingStatus(true);
    setAdminNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch("/api/project-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), color: form.get("color") }),
      }));
      event.currentTarget.reset();
      await refreshAdminData();
      setAdminNotice("项目状态已添加到当前团队。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "项目状态创建失败。");
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function toggleStatus(status: TeamStatus) {
    setWorkingId(status.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/project-statuses/${status.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !status.isActive }),
      }));
      await refreshAdminData();
      setAdminNotice(status.isActive ? "状态已停用；已使用该状态的项目不会被删除。" : "状态已恢复使用。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "项目状态更新失败。");
    } finally {
      setWorkingId("");
    }
  }

  function startStatusEdit(status: TeamStatus) {
    setEditingStatusId(status.id);
    setEditingStatusName(status.name);
    setEditingStatusColor(status.color);
    setAdminNotice("");
  }

  function cancelStatusEdit() {
    setEditingStatusId("");
    setEditingStatusName("");
    setEditingStatusColor("#64748b");
  }

  async function saveStatusEdit(event: FormEvent<HTMLFormElement>, statusId: string) {
    event.preventDefault();
    setIsSavingStatusEdit(true);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/project-statuses/${statusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingStatusName, color: editingStatusColor }),
      }));
      cancelStatusEdit();
      await refreshAdminData();
      setAdminNotice("项目状态名称和颜色已更新。只影响当前团队。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "项目状态编辑失败。");
    } finally {
      setIsSavingStatusEdit(false);
    }
  }

  async function archiveStatus(status: TeamStatus) {
    setWorkingId(status.id);
    setAdminNotice("");
    try {
      await readJson(await fetch(`/api/project-statuses/${status.id}`, { method: "DELETE" }));
      await refreshAdminData();
      setAdminNotice("项目状态已归档。");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "项目状态归档失败。");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section className="section-card admin-panel" aria-label="团队管理">
      <div className="section-heading">
        <div><h2>团队管理</h2><p>只有团队母账号能看到这里；修改只影响当前团队。</p></div>
        <span className="role-label">安全设置</span>
      </div>
      {adminNotice ? <p className="admin-notice" role="status">{adminNotice}</p> : null}
      {monitoring ? <div className="monitoring-panel" aria-label="运行监控">
        <div className="admin-subheading"><h3>运行监控</h3><span>检查于 {formatAuditDate(monitoring.checkedAt)}</span></div>
        <div className="monitoring-grid">
          <div className="monitoring-card"><span>活跃成员</span><strong>{monitoring.activeMembers}</strong></div>
          <div className="monitoring-card"><span>活跃项目</span><strong>{monitoring.activeProjects}</strong></div>
          <div className="monitoring-card"><span>24 小时登录失败</span><strong className={monitoring.loginFailures24h ? "monitoring-warning" : ""}>{monitoring.loginFailures24h}</strong></div>
          <div className="monitoring-card"><span>24 小时安全异常</span><strong className={monitoring.securityFailures24h ? "monitoring-warning" : ""}>{monitoring.securityFailures24h}</strong></div>
        </div>
        <p className={monitoring.securityFailures24h ? "monitoring-note warning" : "monitoring-note"}>{monitoring.securityFailures24h ? `最近一次异常：${auditActionLabel(monitoring.latestFailure?.action ?? "未知事件")} · ${formatAuditDate(monitoring.latestFailure?.createdAt ?? monitoring.checkedAt)}` : `最近活动：${monitoring.latestActivity ? `${auditActionLabel(monitoring.latestActivity.action)} · ${formatAuditDate(monitoring.latestActivity.createdAt)}` : "暂无记录"}`}</p>
      </div> : null}
      <div className="admin-tools">
        <div><strong>数据安全</strong><span>导出当前团队的项目、状态、成员元数据和安全活动记录。</span></div>
        <button className="secondary-button" type="button" disabled={isExporting} onClick={() => void exportSnapshot()}>{isExporting ? "导出中…" : "导出运营快照"}</button>
      </div>
      {!isLoading ? <div className="incident-panel">
        <div className="admin-subheading"><h3>运维事件</h3><span>按 P0-P3 跟踪处理和关闭</span></div>
        <form className="incident-create" onSubmit={createIncident}>
          <select name="severity" defaultValue="P2" aria-label="事件等级">
            {INCIDENT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{INCIDENT_SEVERITY_LABELS[severity]} · 建议响应 {INCIDENT_RESPONSE_TARGETS[severity]}</option>)}
          </select>
          <input name="title" required minLength={2} maxLength={120} placeholder="事件标题" aria-label="事件标题" />
          <input name="impact" maxLength={300} placeholder="影响范围（可选）" aria-label="影响范围" />
          <textarea name="description" maxLength={2000} placeholder="现象与原始证据" aria-label="现象与原始证据" />
          <textarea name="temporaryAction" maxLength={1000} placeholder="临时措施（可选）" aria-label="临时措施" />
          <button className="secondary-button" type="submit" disabled={isSavingIncident}>{isSavingIncident ? "记录中…" : "记录事件"}</button>
        </form>
        <p className="incident-sla-note">以上响应时限是流程表中的建议值，正式 SLA 仍需团队负责人确认。</p>
        <div className="admin-list">
          {teamIncidents.length ? teamIncidents.map((incident) => <div className="incident-row" key={incident.id}>
            <div className="incident-content">
              <div className="incident-heading"><strong>{incident.code}</strong><span className={`incident-severity ${incident.severity.toLowerCase()}`}>{INCIDENT_SEVERITY_LABELS[incident.severity]}</span><span className={`incident-state ${incident.status}`}>{INCIDENT_STATUS_LABELS[incident.status]}</span><span className={`incident-response-state ${incident.responseState}`}>{INCIDENT_RESPONSE_STATE_LABELS[incident.responseState]}</span><span className="incident-target">建议响应 {INCIDENT_RESPONSE_TARGETS[incident.severity]}</span></div>
              <strong>{incident.title}</strong>
              <span>{incident.createdByUsername ?? "系统"} · 更新于 {formatAuditDate(incident.updatedAt)}</span>
              <span className="incident-response-time">响应节点：{formatAuditDate(incident.responseDueAt)}</span>
              <details className="incident-details"><summary>查看详情</summary><p>影响范围：{incident.impact || "未填写"}</p><p>事件描述：{incident.description || "未填写"}</p><p>临时措施：{incident.temporaryAction || "未填写"}</p>{incident.closedAt ? <p>关闭时间：{formatAuditDate(incident.closedAt)}</p> : null}</details>
            </div>
            <div className="incident-controls">
              <select value={incident.severity} disabled={workingId === incident.id} onChange={(event) => void updateIncident(incident, { severity: event.target.value as IncidentSeverity })} aria-label={`${incident.code} 事件等级`}>
                {INCIDENT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
              <select value={incident.status} disabled={workingId === incident.id} onChange={(event) => void updateIncident(incident, { status: event.target.value as IncidentStatus })} aria-label={`${incident.code} 事件状态`}>
                {INCIDENT_STATUSES.map((status) => <option key={status} value={status}>{INCIDENT_STATUS_LABELS[status]}</option>)}
              </select>
            </div>
          </div>) : <p className="admin-muted">当前团队还没有运维事件记录。</p>}
        </div>
      </div> : null}
      {isLoading ? <p className="admin-muted">正在读取团队管理数据…</p> : (
        <div className="admin-grid">
          <div className="admin-column">
            <div className="admin-subheading"><h3>成员账号</h3><span>{members.length} 个账号</span></div>
            <form className="admin-form" onSubmit={createMember}>
              <input name="username" required minLength={3} maxLength={32} placeholder="新成员用户名" aria-label="新成员用户名" />
              <input name="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} type="password" placeholder={`初始密码（${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位）`} aria-label="新成员初始密码" />
              <select name="role" defaultValue="member" aria-label="新成员角色">
                {roles.filter((role) => role.isActive && role.code !== "owner").map((role) => <option value={role.code} key={role.code}>{role.name}</option>)}
              </select>
              <button className="secondary-button" type="submit" disabled={isSavingMember}>{isSavingMember ? "创建中…" : "添加成员"}</button>
            </form>
            <div className="admin-list">
              {members.map((member) => <div className="admin-row" key={member.id}>
                <div><strong>{member.username}</strong><span>{member.roleName} · {member.status === "active" ? "启用中" : "已停用"} · {formatLoginDate(member.lastLoginAt)}</span></div>
                {member.role === "owner" ? <span className="admin-status active">当前账号</span> : resettingMemberId === member.id ? <form className="admin-status-edit" onSubmit={(event) => void resetMemberPassword(event, member)}><input name="newPassword" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} placeholder={`新密码（${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位）`} aria-label={`${member.username} 的新密码`} /><div className="admin-row-actions"><button className="text-button" type="submit" disabled={isResettingMember}>{isResettingMember ? "保存中…" : "保存"}</button><button className="text-button" type="button" disabled={isResettingMember} onClick={cancelMemberPasswordReset}>取消</button></div></form> : <div className="admin-row-actions"><select value={member.role} disabled={workingId === member.id} onChange={(event) => void changeMemberRole(member, event.target.value)} aria-label={`${member.username} 的角色`}>{roles.filter((role) => role.isActive && role.code !== "owner").map((role) => <option value={role.code} key={role.code}>{role.name}</option>)}</select><button className="text-button" type="button" disabled={workingId === member.id} onClick={() => changeMemberStatus(member)}>{workingId === member.id ? "处理中…" : member.status === "active" ? "停用" : "恢复"}</button><button className="text-button" type="button" onClick={() => startMemberPasswordReset(member)}>重置密码</button></div>}
              </div>)}
            </div>
            <div className="role-config-panel">
              <div className="admin-subheading"><h3>权限角色</h3><span>{roles.filter((role) => !role.isSystem).length} 个自定义</span></div>
              <p className="role-config-note">每个团队独立配置角色。母账号始终保留最高权限，不会被转授；自定义角色至少需要“查看项目”。</p>
              <form className="role-create-form" onSubmit={createRole}>
                <input name="name" required minLength={2} maxLength={40} placeholder="角色名称，例如：项目查看员" aria-label="自定义角色名称" />
                <input name="description" maxLength={200} placeholder="角色说明（可选）" aria-label="自定义角色说明" />
                <div className="role-permissions" aria-label="新角色权限">
                  {ROLE_PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" checked={newRolePermissions.includes(permission)} disabled={permission === "project.view"} onChange={(event) => setNewRolePermissions((current) => togglePermission(current, permission, event.target.checked))} />{ROLE_PERMISSION_LABELS[permission]}</label>)}
                </div>
                <button className="secondary-button" type="submit" disabled={isSavingRole}>{isSavingRole ? "创建中…" : "创建角色"}</button>
              </form>
              <div className="admin-list">
                {roles.map((role) => <div className="admin-row role-row" key={role.id}>
                  {editingRoleId === role.id ? (
                    <form className="role-edit-form" onSubmit={(event) => void saveRoleEdit(event, role.id)}>
                      <input value={editingRoleName} onChange={(event) => setEditingRoleName(event.target.value)} required maxLength={40} aria-label="编辑角色名称" />
                      <input value={editingRoleDescription} onChange={(event) => setEditingRoleDescription(event.target.value)} maxLength={200} aria-label="编辑角色说明" />
                      <div className="role-permissions" aria-label="编辑角色权限">
                        {ROLE_PERMISSIONS.map((permission) => <label key={permission}><input type="checkbox" checked={editingRolePermissions.includes(permission)} disabled={permission === "project.view"} onChange={(event) => setEditingRolePermissions((current) => togglePermission(current, permission, event.target.checked))} />{ROLE_PERMISSION_LABELS[permission]}</label>)}
                      </div>
                      <div className="admin-row-actions"><button className="text-button" type="submit" disabled={isSavingRoleEdit}>{isSavingRoleEdit ? "保存中…" : "保存"}</button><button className="text-button" type="button" disabled={isSavingRoleEdit} onClick={cancelRoleEdit}>取消</button></div>
                    </form>
                  ) : (
                    <><div><strong>{role.name}{role.isSystem ? " · 系统角色" : ""}</strong><span>{role.description || "未填写角色说明"}</span><span>{role.permissions.map((permission) => ROLE_PERMISSION_LABELS[permission as CustomRolePermission] ?? permission).join("、")} · {role.assignedCount} 人使用</span></div>{role.isSystem ? <span className="admin-status active">受保护</span> : <div className="admin-row-actions"><button className="text-button" type="button" onClick={() => startRoleEdit(role)}>编辑</button><button className="text-button" type="button" disabled={workingId === role.id} onClick={() => void toggleRole(role)}>{role.isActive ? "停用" : "启用"}</button></div>}</>
                  )}
                </div>)}
              </div>
            </div>
          </div>
          <div className="admin-column">
            <div className="admin-subheading"><h3>项目状态</h3><span>{statuses.filter((status) => status.isActive).length} 个启用</span></div>
            <form className="admin-form status-form" onSubmit={createStatus}>
              <input name="name" required maxLength={40} placeholder="例如：等待评审" aria-label="新项目状态名称" />
              <input name="color" type="color" defaultValue="#64748b" aria-label="项目状态颜色" />
              <button className="secondary-button" type="submit" disabled={isSavingStatus}>{isSavingStatus ? "添加中…" : "添加状态"}</button>
            </form>
            <div className="admin-list">
              {statuses.map((status) => <div className="admin-row" key={status.id}>
                {editingStatusId === status.id ? (
                  <form className="admin-status-edit" onSubmit={(event) => saveStatusEdit(event, status.id)}>
                    <input value={editingStatusName} onChange={(event) => setEditingStatusName(event.target.value)} maxLength={40} required aria-label="编辑项目状态名称" />
                    <input value={editingStatusColor} onChange={(event) => setEditingStatusColor(event.target.value)} type="color" aria-label="编辑项目状态颜色" />
                    <div className="admin-row-actions"><button className="text-button" type="submit" disabled={isSavingStatusEdit}>{isSavingStatusEdit ? "保存中…" : "保存"}</button><button className="text-button" type="button" disabled={isSavingStatusEdit} onClick={cancelStatusEdit}>取消</button></div>
                  </form>
                ) : (
                  <><div className="status-row-label"><i style={{ backgroundColor: status.color }} /><div><strong>{status.name}</strong><span>{status.isActive ? "启用中" : "已停用"} · {status.code}</span></div></div><div className="admin-row-actions"><button className="text-button" type="button" disabled={workingId === status.id} onClick={() => startStatusEdit(status)}>编辑</button><button className="text-button" type="button" disabled={workingId === status.id} onClick={() => toggleStatus(status)}>{status.isActive ? "停用" : "启用"}</button>{status.isActive ? <button className="text-button danger" type="button" disabled={workingId === status.id} onClick={() => archiveStatus(status)}>归档</button> : null}</div></>
                )}
              </div>)}
            </div>
          </div>
        </div>
      )}
      {!isLoading ? <div className="audit-panel"><div className="admin-subheading"><h3>安全活动记录</h3><span>最近 {auditLogs.length} 条</span></div><div className="admin-list">{auditLogs.length ? auditLogs.map((log) => <div className="admin-row" key={log.id}><div><strong>{auditActionLabel(log.action)}</strong><span>{log.username ?? "系统"} · {formatAuditDate(log.createdAt)} · {log.resourceType}</span></div><span className={`admin-status ${log.result === "success" ? "active" : "warning"}`}>{log.result}</span></div>) : <p className="admin-muted">当前团队还没有安全活动记录。</p>}</div></div> : null}
    </section>
  );
}
