/**
 * Formatos, rótulos en español y pequeñas utilidades compartidas por la consola.
 */
import { ref } from 'vue';
import {
  AUTONOMY_ORDER,
  type Actor,
  type ApprovalStatus,
  type AutonomyLevel,
  type CaseSource,
  type CaseStatus,
  type PolicyDecision,
  type RiskClass,
  type Severity,
  type TimelineKind,
} from '../../../platform/contracts.ts';

export const LEVELS: readonly AutonomyLevel[] = AUTONOMY_ORDER;

// ── Cifras ──────────────────────────────────────────────

const usdFormatters: Record<number, Intl.NumberFormat> = {};

/** USD con 4 decimales por debajo de 0,01 y 2 decimales en el resto (0 se muestra con 2). */
export function formatUsd(value: number | null | undefined): string {
  const amount = Number(value ?? 0) || 0;
  const digits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  usdFormatters[digits] ??= new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return usdFormatters[digits].format(amount);
}

const eurFormatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export function formatEur(value: number | null | undefined): string {
  return eurFormatter.format(Number(value ?? 0) || 0);
}

/** Porcentaje entero a partir de una fracción 0..1. */
export function formatPct(fraction: number | null | undefined): string {
  return `${Math.round((Number(fraction ?? 0) || 0) * 100)} %`;
}

const intFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
export function formatInt(value: number | null | undefined): string {
  return intFormatter.format(Number(value ?? 0) || 0);
}

export function formatLatency(ms: number | null | undefined): string {
  const value = Number(ms ?? 0) || 0;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
}

// ── Tiempo ──────────────────────────────────────────────

const now = ref(Date.now());
let ticking = false;

/** Reloj compartido que avanza cada segundo para los tiempos relativos. */
export function useNow() {
  if (!ticking) {
    ticking = true;
    setInterval(() => (now.value = Date.now()), 1000);
  }
  return now;
}

export function relativeTime(iso: string | undefined, nowMs: number): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (Number.isNaN(seconds)) return '';
  if (seconds < 2) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

/** Duración corta desde un instante: "12 s", "3 min 05 s". */
export function elapsedSince(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

export function fullTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'medium' });
}

// ── Rótulos ─────────────────────────────────────────────

export const LEVEL_LABEL: Record<AutonomyLevel, string> = {
  shadow: 'Solo observa',
  approve: 'Pide permiso',
  notify: 'Hace y avisa',
  auto: 'Hace sola',
};

export const LEVEL_HINT: Record<AutonomyLevel, string> = {
  shadow: 'Registra lo que haría, pero no ejecuta nada.',
  approve: 'Prepara la acción y espera a que una persona la apruebe.',
  notify: 'Ejecuta la acción y deja un aviso a las personas.',
  auto: 'Ejecuta la acción sin intervención humana.',
};

export function decisionLabel(decision: PolicyDecision): string {
  if (decision === 'deny') return 'Bloquea';
  if (decision === 'escalate') return 'Escala a una persona';
  return LEVEL_LABEL[decision];
}

/** Lo que hace una condición cuando se cumple, en lenguaje llano. */
export function conditionEffect(decision: PolicyDecision): string {
  if (decision === 'deny') return 'Bloquea';
  if (decision === 'escalate') return 'Escala a una persona';
  return `Baja a «${LEVEL_LABEL[decision]}»`;
}

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Abierto',
  running: 'En curso',
  waiting_approval: 'Esperando aprobación',
  resolved: 'Resuelto',
  escalated: 'Escalado',
  failed: 'Fallido',
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  executed: 'Aprobada y ejecutada',
  failed: 'Aprobada, falló',
};

export const ACTOR_LABEL: Record<Actor, string> = {
  rule: 'Regla',
  agent: 'IA',
  human: 'Persona',
};

export const KIND_LABEL: Record<TimelineKind, string> = {
  created: 'Alta',
  rule: 'Regla',
  llm: 'IA',
  tool: 'Acción',
  policy: 'Política',
  approval: 'Aprobación',
  note: 'Nota',
  status: 'Estado',
  error: 'Error',
};

export const RISK_LABEL: Record<RiskClass, string> = {
  read: 'Lectura',
  write_internal: 'Escritura interna',
  write_external: 'Hacia fuera',
  financial: 'Dinero',
  physical: 'Acción física',
  code: 'Código',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

export const SOURCE_LABEL: Record<CaseSource, string> = {
  device: 'Dispositivo',
  ticket: 'Ticket',
  invoice: 'Factura',
  code: 'Código',
  call: 'Llamada',
};

// ── Texto ───────────────────────────────────────────────

export function toJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Para títulos: un identificador con guion (DAT-01, BORR-2609-03) no se parte en dos líneas
 * (guion no separable) y el separador « · » no empieza una línea (espacio duro delante).
 * Solo para mostrar, no para buscar ni copiar valores.
 */
export function sinPartir(texto: string): string {
  return texto.replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, '\u2011').replace(/ · /g, '\u00a0· ');
}

export function excerpt(text: string | undefined, max = 160): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Navegación ──────────────────────────────────────────

/** Abre un caso en la pestaña Casos (lo escucha App.vue). */
export function openCase(caseId: string) {
  window.dispatchEvent(new CustomEvent('open-case', { detail: caseId }));
}

/** Cambia de pestaña a través de location.hash (lo escucha App.vue). */
export function goTab(tab: string) {
  location.hash = `#${tab}`;
}
