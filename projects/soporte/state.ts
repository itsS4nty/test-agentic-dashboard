/**
 * Estado del proyecto soporte: la bandeja de tickets y los abonos registrados.
 * Vive en `store.setValue('soporte', …)`; cada cambio avisa a la consola.
 */
import { readFileSync } from 'node:fs';
import type { Case, PlatformApi, Scope, Severity } from '../../platform/contracts.ts';
import type { InjectionMatch } from './injection.ts';

export const PROJECT_ID = 'soporte';
export const AGENT_ID = 'soporte';
/** El ticket con el intento de manipulación. Llega por su propio escenario. */
export const INJECTION_TICKET_ID = 'T-106';

export const CATEGORIES = ['incidencia', 'facturacion', 'consulta', 'sugerencia', 'queja', 'otro'] as const;
export type TicketCategory = (typeof CATEGORIES)[number];

export const PRIORITIES = ['baja', 'media', 'alta', 'urgente'] as const;
export type TicketPriority = (typeof PRIORITIES)[number];

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  incidencia: 'incidencia técnica',
  facturacion: 'facturación',
  consulta: 'consulta',
  sugerencia: 'sugerencia',
  queja: 'queja',
  otro: 'otro',
};

export const PRIORITY_SEVERITY: Record<TicketPriority, Severity> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
  urgente: 'critical',
};

export type TicketStatus = 'new' | 'triaged' | 'answered' | 'escalated' | 'auto_answered';

/** Ticket tal como viene en `data/tickets.json`. */
export interface SeedTicket {
  id: string;
  siteId: string;
  from: string;
  subject: string;
  body: string;
  /** Antigüedad simulada al llegar a la bandeja. */
  minutesAgo: number;
}

export interface Ticket {
  id: string;
  from: string;
  siteId: string;
  clientId: string;
  subject: string;
  body: string;
  receivedAt: string;
  status: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  draftReply?: string;
  sentReply?: string;
  sentAt?: string;
  caseId?: string;
  // Filtro de entrada
  screenedAt?: string;
  injectionDetected?: boolean;
  injectionPatterns?: InjectionMatch[];
  injectionCheck?: string;
  // Decisiones posteriores
  faqId?: string;
  routedAt?: string;
  flaggedReason?: string;
  escalationReason?: string;
}

export interface CreditRecord {
  id: string;
  ticketId: string;
  caseId: string;
  amountEur: number;
  ibanMasked: string;
  at: string;
}

export interface SoporteState {
  tickets: Ticket[];
  credits: CreditRecord[];
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

export const SEED_TICKETS: SeedTicket[] = readJson<{ tickets: SeedTicket[] }>('./data/tickets.json').tickets;

export function emptyState(): SoporteState {
  return { tickets: [], credits: [] };
}

export function loadState(platform: PlatformApi): SoporteState {
  const current = platform.store.getValue<SoporteState>(PROJECT_ID);
  if (current && Array.isArray(current.tickets)) {
    if (!Array.isArray(current.credits)) current.credits = [];
    return current;
  }
  const fresh = emptyState();
  platform.store.setValue(PROJECT_ID, fresh);
  return fresh;
}

export function saveState(platform: PlatformApi, state: SoporteState): void {
  platform.store.setValue(PROJECT_ID, state);
  platform.projects.changed(PROJECT_ID);
}

export function normalizeTicketId(id: unknown): string {
  return String(id ?? '').trim().toUpperCase();
}

export function findTicket(platform: PlatformApi, id: unknown): Ticket | undefined {
  const key = normalizeTicketId(id);
  return loadState(platform).tickets.find((t) => t.id === key);
}

export function findSeed(id: unknown): SeedTicket | undefined {
  const key = normalizeTicketId(id);
  return SEED_TICKETS.find((t) => t.id === key);
}

export function updateTicket(platform: PlatformApi, id: string, patch: Partial<Ticket>): Ticket {
  const state = loadState(platform);
  const ticket = state.tickets.find((t) => t.id === id);
  if (!ticket) throw new Error(`No existe el ticket ${id}`);
  Object.assign(ticket, patch);
  saveState(platform, state);
  return ticket;
}

/** Mete el ticket en la bandeja (desde los datos de la demo). Idempotente. */
export function receiveTicket(platform: PlatformApi, id: unknown): Ticket | undefined {
  const state = loadState(platform);
  const key = normalizeTicketId(id);
  const existing = state.tickets.find((t) => t.id === key);
  if (existing) return existing;

  const seed = findSeed(key);
  if (!seed) return undefined;
  const site = platform.directory.site(seed.siteId);
  const ticket: Ticket = {
    id: seed.id,
    from: seed.from,
    siteId: seed.siteId,
    clientId: site?.clientId ?? '',
    subject: seed.subject,
    body: seed.body,
    receivedAt: new Date(Date.now() - seed.minutesAgo * 60_000).toISOString(),
    status: 'new',
  };
  state.tickets.push(ticket);
  saveState(platform, state);
  return ticket;
}

export function ticketScope(ticket: { siteId: string; clientId?: string }): Scope {
  return ticket.clientId ? { clientId: ticket.clientId, siteId: ticket.siteId } : { siteId: ticket.siteId };
}

export function siteLabel(platform: PlatformApi, ticket: { siteId: string; clientId?: string }): string {
  return platform.directory.describeScope(ticketScope(ticket));
}

export function ticketText(ticket: { subject: string; body: string }): string {
  return `${ticket.subject}\n${ticket.body}`;
}

/** Caso del ticket: lo reutiliza si existe o lo crea. */
export function ensureTicketCase(platform: PlatformApi, ticket: Ticket, severity: Severity = 'medium'): Case {
  const existing = ticket.caseId ? platform.cases.get(ticket.caseId) : undefined;
  if (existing) return existing;
  const created = platform.cases.create({
    project: PROJECT_ID,
    title: `Ticket ${ticket.id}: ${ticket.subject}`,
    source: 'ticket',
    scope: ticketScope(ticket),
    severity,
    data: { ticketId: ticket.id, from: ticket.from, subject: ticket.subject },
  });
  updateTicket(platform, ticket.id, { caseId: created.id });
  return created;
}

export function mergeCaseData(
  platform: PlatformApi,
  caseId: string,
  data: Record<string, unknown>,
  patch: { severity?: Severity } = {},
): Case | undefined {
  const record = platform.cases.get(caseId);
  if (!record) return undefined;
  return platform.cases.update(caseId, { ...patch, data: { ...record.data, ...data } });
}

export function firstName(from: string): string {
  const name = from.replace(/<[^>]*>/g, '').trim();
  return name.split(/\s+/)[0] || 'equipo';
}

/** 5000 → "5.000,00 €" */
export function formatEur(amount: number): string {
  const [integer, decimals] = Math.abs(amount).toFixed(2).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 ? '-' : ''}${grouped},${decimals} €`;
}

/** "ES91 2100 0418 4502 0005 1332" → "ES91 **** 1332" */
export function maskIban(iban: string): string {
  const compact = iban.replace(/[\s-]+/g, '').toUpperCase();
  return compact.length <= 8 ? '****' : `${compact.slice(0, 4)} **** ${compact.slice(-4)}`;
}

export const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?\d{1,3})?\b/i;
export const EURO_AMOUNT_IN_TEXT = /\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*€/;

/** "5.000 €" → 5000 */
export function parseEur(text: string): number | undefined {
  const value = Number(text.replace(/[€\s.]/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
