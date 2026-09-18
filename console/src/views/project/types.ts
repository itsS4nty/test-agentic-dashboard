/**
 * Formas de los snapshots de proyecto tal y como las sirve `GET /api/projects/:id`.
 * Reflejan docs/CONTRACTS.md § 6; si el servidor cambia la forma, se cambia aquí.
 */

// ── Dispositivo (§ 6.1) ───────────────────────────────────────────

export type DeviceStatus = 'ok' | 'locked' | 'offline' | 'paper_out' | 'restarting';
export type DeviceType = 'datafono' | 'impresora' | 'router';

export interface DispositivoDevice {
  id: string;
  type: DeviceType;
  label: string;
  model: string;
  softwareVersion: string;
  status: DeviceStatus;
  transactionInFlight: boolean;
  restartsLastHour: number;
  lastRestartAt?: string;
}

export interface DispositivoSite {
  id: string;
  name: string;
  city: string;
  clientId: string;
  clientName: string;
  open: string;
  close: string;
  devices: DispositivoDevice[];
}

export interface DispositivoStoreNotice {
  at: string;
  siteId: string;
  message: string;
}

export interface DispositivoFieldTicket {
  id: string;
  at: string;
  siteId: string;
  deviceId?: string;
  summary: string;
}

export interface DispositivoSnapshot {
  ambient: boolean;
  clients: { id: string; name: string }[];
  sites: DispositivoSite[];
  storeNotices: DispositivoStoreNotice[];
  fieldTickets: DispositivoFieldTicket[];
}

// ── Código (§ 6.2) ──────────────────────────────────────────

export interface TestRun {
  passed: number;
  failed: number;
  output: string;
}

/**
 * Resultado de la CI del repositorio para el último commit del PR. `none` = no hay CI (lo normal:
 * la demo no la añade); entonces la vista no muestra ningún indicador de tests de GitHub.
 */
export type CiStatus = 'none' | 'pending' | 'success' | 'failure';

export interface PullRequest {
  id: string;
  title: string;
  branch: string;
  /** `closed`: cerrado en GitHub sin fusionar. */
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  mergedAt?: string;
  closedAt?: string;
  caseId: string;
  description: string;
  diff: string;
  testsBefore: TestRun;
  testsAfter: TestRun;
  headSha?: string;
  /** Solo en modo GitHub. */
  github?: { number: number; url: string; ci: CiStatus };
}

export interface BugsSnapshot {
  repoPath: string;
  version: string;
  branches: string[];
  prs: PullRequest[];
  /** `github` cuando hay un repositorio de GitHub conectado. */
  mode: 'local' | 'github';
  remote?: { repo: string; url: string };
  /** GitHub configurado pero no utilizable: por qué se trabaja en local. */
  warning?: string;
}

// ── Facturas (§ 6.3) ────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'issued';
export type FindingLayer = 'rule' | 'llm';
export type FindingStatus = 'open' | 'corrected' | 'dismissed';

export interface InvoiceRow {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  date: string;
  status: InvoiceStatus;
  total: number;
  findings: number;
}

export interface Finding {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  layer: FindingLayer;
  check: string;
  title: string;
  detail: string;
  amountImpact: number;
  status: FindingStatus;
  caseId?: string;
}

export interface FacturasStats {
  invoicesChecked: number;
  ruleFindings: number;
  llmFindings: number;
  /** Siempre 0: las reglas no gastan tokens. */
  ruleCostUsd: number;
  llmCostUsd: number;
}

export interface FacturasSnapshot {
  invoices: InvoiceRow[];
  findings: Finding[];
  stats: FacturasStats;
}

// ── Soporte (§ 6.4) ─────────────────────────────────────────

export type TicketStatus = 'new' | 'triaged' | 'answered' | 'escalated' | 'auto_answered';

export interface Ticket {
  id: string;
  from: string;
  siteId: string;
  clientId: string;
  subject: string;
  body: string;
  receivedAt: string;
  category?: string;
  priority?: string;
  status: TicketStatus;
  draftReply?: string;
  sentReply?: string;
  injectionDetected?: boolean;
  caseId?: string;
}

export interface SoporteSnapshot {
  tickets: Ticket[];
}

// ── Plataforma: agente creador ──────────────────────────────
// Entrada de `POST /api/agent-requests` (réplica de `projects/plataforma/spec.ts`, fuente de verdad)
// y snapshot de `GET /api/projects/plataforma`.

export type AgentTrigger = 'manual' | 'event';
export type ConnectionKind = 'http' | 'webhook';
export type OperationAccess = 'read' | 'write';
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type AgentSpecTier = 'fast' | 'reasoning';

export interface OperationSpec {
  name: string;
  description: string;
  access: OperationAccess;
  money?: boolean;
  method?: HttpMethod;
  path?: string;
}

export interface ConnectionSpec {
  /** 2–40 */
  name: string;
  kind: ConnectionKind;
  /** ≤ 300 */
  description: string;
  /** 1–8 */
  operations: OperationSpec[];
}

export interface AgentSpec {
  /** 3–60 */
  name: string;
  /** Slug `^[a-z][a-z0-9-]{2,29}$`; si falta, el servidor lo deriva de `name`. */
  id?: string;
  /** Qué debe hacer, en lenguaje natural: 20–4000. */
  purpose: string;
  trigger: AgentTrigger;
  /** Con `trigger: 'event'`: un evento de dominio existente (docs/CONTRACTS.md § 5). */
  event?: string;
  /** 0–6; la IA propone las que falten a partir de `purpose`. */
  connections: ConnectionSpec[];
  /** Procedimientos, reglas y tono: ≤ 8000. */
  context: string;
  tier: AgentSpecTier;
  /** 0,05–5 US$ por caso. */
  budgetUsd: number;
  /** 3–25 */
  maxTurns: number;
  /** 2–60 */
  owner: string;
}

/** Error de validación de un campo. `field` con puntos o corchetes: `connections[0].operations[1].name`. */
export interface SpecError {
  field: string;
  message: string;
}

export interface AgentRequestCreated {
  requestId: string;
  caseId: string;
  message: string;
}

export type AgentRequestStatus = 'queued' | 'working' | 'pr_open' | 'merged' | 'active' | 'closed' | 'failed';

export interface AgentRequest {
  id: string;
  caseId: string;
  name: string;
  agentId: string;
  createdAt: string;
  status: AgentRequestStatus;
  prId?: string;
  error?: string;
}

export interface AgentPrFile {
  path: string;
  status: 'added' | 'modified';
}

export interface ValidationStep {
  name: string;
  ok: boolean;
  output: string;
}

export interface AgentActivation {
  state: 'active' | 'restart_required';
  detail: string;
}

export interface AgentPr {
  id: string;
  title: string;
  branch: string;
  agentId: string;
  caseId: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  mergedAt?: string;
  files: AgentPrFile[];
  diff: string;
  validation: { ok: boolean; steps: ValidationStep[] };
  envVars: string[];
  activation?: AgentActivation;
  github?: { number: number; url: string };
}

export interface PlataformaSnapshot {
  mode: 'local' | 'github';
  remote?: { repo: string; url: string };
  /** GitHub configurado pero no utilizable: por qué se trabaja en local. */
  warning?: string;
  baseBranch: string;
  requests: AgentRequest[];
  prs: AgentPr[];
}
