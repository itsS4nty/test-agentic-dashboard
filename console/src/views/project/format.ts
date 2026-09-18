/**
 * Formato de cifras y fechas, y utilidades compartidas por las vistas de proyecto.
 */
import type { Approval, Case, CaseStatus } from '../../../../platform/contracts.ts';
import { live } from '../../live.ts';

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const eurSigned = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  signDisplay: 'exceptZero',
});

export const fmtEur = (n: number): string => eur.format(n);
export const fmtEurSigned = (n: number): string => eurSigned.format(n);

/** Dólares con los decimales justos para que un coste pequeño de IA no se lea como 0. */
export function fmtUsd(n: number): string {
  const digits = n === 0 ? 2 : Math.abs(n) < 0.01 ? 4 : Math.abs(n) < 1 ? 3 : 2;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function parse(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "09:41:07" */
export function fmtTime(iso?: string): string {
  const d = parse(iso);
  return d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}

/** "15 sept, 09:41" */
export function fmtDateTime(iso?: string): string {
  const d = parse(iso);
  return d
    ? d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** "03/09/2026". Las fechas sin hora se leen tal cual, sin desplazamiento de zona. */
export function fmtDate(value?: string): string {
  if (!value) return '—';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const d = parse(value);
  return d ? d.toLocaleDateString('es-ES') : value;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Abre un caso en la pestaña Casos (App.vue escucha este evento). */
export function openCase(caseId: string): void {
  window.dispatchEvent(new CustomEvent('open-case', { detail: caseId }));
}

const CLOSED: CaseStatus[] = ['resolved', 'failed'];

/** Casos no cerrados de un proyecto, del más reciente al más antiguo. */
export function openCasesOf(project: string): Case[] {
  return Object.values(live.cases)
    .filter((c) => c.project === project && !CLOSED.includes(c.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Aprobaciones pendientes de una herramienta cuyo input cumple el filtro. */
export function pendingApprovalsFor(tool: string, match: (input: Record<string, unknown>) => boolean): Approval[] {
  return Object.values(live.approvals).filter(
    (a) =>
      a.status === 'pending' &&
      a.tool === tool &&
      typeof a.input === 'object' &&
      a.input !== null &&
      match(a.input as Record<string, unknown>),
  );
}

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'abierto',
  running: 'en curso',
  waiting_approval: 'espera aprobación',
  resolved: 'resuelto',
  escalated: 'escalado',
  failed: 'fallido',
};
