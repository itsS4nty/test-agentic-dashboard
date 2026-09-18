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
