import type { PlatformApi } from '../../platform/contracts.ts';
import type { AgentSpec } from './spec.ts';

export const PROJECT_ID = 'plataforma';
export const AGENT_ID = 'creador';

export type RequestStatus = 'queued' | 'working' | 'pr_open' | 'merged' | 'active' | 'closed' | 'failed';

export interface AgentRequest {
  id: string;
  caseId: string;
  name: string;
  agentId: string;
  createdAt: string;
  status: RequestStatus;
  prId?: string;
  error?: string;
}

export interface ValidationStep {
  name: string;
  ok: boolean;
  output: string;
}

export interface AgentPr {
  id: string;
  requestId: string;
  title: string;
  branch: string;
  agentId: string;
  caseId: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  mergedAt?: string;
  files: { path: string; status: 'added' | 'modified' }[];
  diff: string;
  validation: { ok: boolean; steps: ValidationStep[] };
  envVars: string[];
  activation?: { state: 'active' | 'restart_required'; detail: string };
  github?: { number: number; url: string };
}

export interface PlataformaState {
  seq: number;
  requests: AgentRequest[];
  prs: AgentPr[];
  specs: Record<string, AgentSpec>;
  validations: Record<string, { ok: boolean; steps: ValidationStep[] }>;
}

const KEY = 'plataforma.state';

export function getState(platform: PlatformApi): PlataformaState {
  let state = platform.store.getValue<PlataformaState>(KEY);
  if (!state) {
    state = { seq: 0, requests: [], prs: [], specs: {}, validations: {} };
    platform.store.setValue(KEY, state);
  }
  return state;
}

export function saveState(platform: PlatformApi, state: PlataformaState): void {
  platform.store.setValue(KEY, state);
  platform.projects.changed(PROJECT_ID);
}

export function resetState(platform: PlatformApi): void {
  platform.store.setValue(KEY, { seq: 0, requests: [], prs: [], specs: {}, validations: {} });
}

export function requestForCase(platform: PlatformApi, caseId: string): AgentRequest | undefined {
  return getState(platform).requests.find((r) => r.caseId === caseId);
}

export function updateRequest(platform: PlatformApi, id: string, patch: Partial<AgentRequest>): void {
  const state = getState(platform);
  state.requests = state.requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
  saveState(platform, state);
}
