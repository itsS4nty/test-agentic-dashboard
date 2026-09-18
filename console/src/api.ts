/**
 * Cliente HTTP de la consola. Refleja exactamente la API de server/.
 * Fuente del contrato: docs/CONTRACTS.md § API del servidor.
 */
import type {
  ActionPolicy,
  ActiveRun,
  AgentManifest,
  Approval,
  AutonomyLevel,
  Case,
  CaseStatus,
  Client,
  LlmProviderId,
  Metrics,
  Notification,
  PolicyConfig,
  RiskClass,
  Scope,
} from '../../platform/contracts.ts';

export interface StatusInfo {
  provider: LlmProviderId;
  providerLabel: string;
  models: { reasoning: string; fast: string };
  projects: { id: string; name: string; description: string }[];
  startedAt: string;
}

export interface ActionInfo {
  name: string;
  project: string;
  description: string;
  risk: RiskClass;
  policy?: ActionPolicy;
}

export interface PoliciesInfo {
  config: PolicyConfig;
  actions: ActionInfo[];
  clients: Client[];
}

export interface ScenarioInfo {
  id: string;
  project: string;
  title: string;
  description: string;
  order: number;
}

export interface RuleInfo {
  id: string;
  project: string;
  description: string;
  on: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(json?.error ?? `${method} ${path} → ${res.status}`);
  }
  return json as T;
}

const q = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  status: () => request<StatusInfo>('GET', '/api/status'),
  metrics: () => request<Metrics>('GET', '/api/metrics'),

  cases: (filter: { project?: string; status?: CaseStatus } = {}) =>
    request<Case[]>('GET', `/api/cases${q(filter)}`),
  case: (id: string) => request<Case>('GET', `/api/cases/${encodeURIComponent(id)}`),

  approvals: (status?: Approval['status']) => request<Approval[]>('GET', `/api/approvals${q({ status })}`),
  decide: (id: string, decision: 'approved' | 'rejected', comment?: string) =>
    request<Approval>('POST', `/api/approvals/${encodeURIComponent(id)}/decision`, { decision, comment }),

  policies: () => request<PoliciesInfo>('GET', '/api/policies'),
  setActionLevel: (action: string, level: AutonomyLevel) =>
    request<PolicyConfig>('PUT', `/api/policies/actions/${encodeURIComponent(action)}`, { level }),
  setOverride: (scope: Scope, action: string, level: AutonomyLevel | null) =>
    request<PolicyConfig>('PUT', '/api/policies/overrides', { scope, action, level }),
  resetPolicies: () => request<PolicyConfig>('POST', '/api/policies/reset'),

  agents: () => request<AgentManifest[]>('GET', '/api/agents'),
  rules: () => request<RuleInfo[]>('GET', '/api/rules'),
  runs: () => request<ActiveRun[]>('GET', '/api/runs'),
  notifications: () => request<Notification[]>('GET', '/api/notifications'),

  project: <T>(id: string) => request<T>('GET', `/api/projects/${encodeURIComponent(id)}`),
  scenarios: () => request<ScenarioInfo[]>('GET', '/api/scenarios'),
  runScenario: (id: string) =>
    request<{ message: string; caseIds?: string[] }>('POST', `/api/scenarios/${encodeURIComponent(id)}/run`),

  reset: () => request<{ ok: true }>('POST', '/api/reset'),
};
