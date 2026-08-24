export const INCIDENT_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];

export const INCIDENT_STATUSES = ["open", "investigating", "resolved"] as const;
export type IncidentStatus = typeof INCIDENT_STATUSES[number];

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  P0: "P0 紧急",
  P1: "P1 高优",
  P2: "P2 一般",
  P3: "P3 优化",
};

export const INCIDENT_RESPONSE_TARGETS: Record<IncidentSeverity, string> = {
  P0: "15 分钟内",
  P1: "1 小时内",
  P2: "1 个工作日内",
  P3: "2 个工作日内确认",
};

export const INCIDENT_RESPONSE_WINDOWS_MS: Record<IncidentSeverity, number> = {
  P0: 15 * 60 * 1000,
  P1: 60 * 60 * 1000,
  P2: 24 * 60 * 60 * 1000,
  P3: 2 * 24 * 60 * 60 * 1000,
};

export const INCIDENT_RESPONSE_STATES = ["waiting", "overdue", "acknowledged", "resolved"] as const;
export type IncidentResponseState = typeof INCIDENT_RESPONSE_STATES[number];

export const INCIDENT_RESPONSE_STATE_LABELS: Record<IncidentResponseState, string> = {
  waiting: "待响应",
  overdue: "已超时",
  acknowledged: "已接手",
  resolved: "已关闭",
};

export function incidentResponseDueAt(createdAt: string, severity: IncidentSeverity) {
  return new Date(new Date(createdAt).getTime() + INCIDENT_RESPONSE_WINDOWS_MS[severity]).toISOString();
}

export function incidentResponseState(status: IncidentStatus, createdAt: string, severity: IncidentSeverity, now = Date.now()): IncidentResponseState {
  if (status === "resolved") return "resolved";
  if (status === "investigating") return "acknowledged";
  return new Date(createdAt).getTime() + INCIDENT_RESPONSE_WINDOWS_MS[severity] < now ? "overdue" : "waiting";
}

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "待处理",
  investigating: "处理中",
  resolved: "已解决",
};

export function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return typeof value === "string" && INCIDENT_SEVERITIES.includes(value as IncidentSeverity);
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && INCIDENT_STATUSES.includes(value as IncidentStatus);
}
