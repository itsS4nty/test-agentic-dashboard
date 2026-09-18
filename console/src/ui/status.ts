/**
 * Correspondencia fija entre estados del dominio y su presentación (docs/DESIGN.md § 3).
 * Las vistas la usan para que un mismo estado se vea igual en toda la consola.
 */
import type {
  Actor,
  ApprovalStatus,
  CaseStatus,
  PolicyDecision,
  RiskClass,
} from '../../../platform/contracts.ts';
import { decisionLabel, RISK_LABEL } from '../components/format.ts';
import type { DeviceStatus } from '../views/project/types.ts';
import type { BadgeVariant, Status } from './types.ts';

export interface StatusPresentation {
  status: Status;
  label: string;
}

export interface BadgePresentation {
  variant: BadgeVariant;
  label: string;
}

export const CASE_STATUS: Record<CaseStatus, StatusPresentation> = {
  resolved: { status: 'success', label: 'Resuelto' },
  open: { status: 'neutral', label: 'Abierto' },
  running: { status: 'pending', label: 'En curso' },
  waiting_approval: { status: 'warning', label: 'Pendiente de aprobación' },
  escalated: { status: 'danger', label: 'Escalado' },
  failed: { status: 'danger', label: 'Fallido' },
};

export const DEVICE_STATUS: Record<DeviceStatus, StatusPresentation> = {
  ok: { status: 'success', label: 'Operativo' },
  restarting: { status: 'pending', label: 'Reiniciando' },
  paper_out: { status: 'warning', label: 'Sin papel' },
  locked: { status: 'danger', label: 'Bloqueado' },
  offline: { status: 'danger', label: 'Sin conexión' },
};

export const APPROVAL_STATUS: Record<ApprovalStatus, StatusPresentation> = {
  pending: { status: 'warning', label: 'Pendiente' },
  approved: { status: 'success', label: 'Aprobada' },
  executed: { status: 'success', label: 'Aprobada y ejecutada' },
  rejected: { status: 'neutral', label: 'Rechazada' },
  failed: { status: 'danger', label: 'Falló' },
};

export const ACTOR_BADGE: Record<Actor, BadgePresentation> = {
  rule: { variant: 'neutral', label: 'Regla' },
  agent: { variant: 'inverted', label: 'IA' },
  human: { variant: 'outline', label: 'Persona' },
};

export function decisionBadge(decision: PolicyDecision): BadgePresentation {
  const variant: BadgeVariant =
    decision === 'deny' || decision === 'escalate' ? 'danger' : decision === 'approve' ? 'warning' : 'neutral';
  return { variant, label: decisionLabel(decision) };
}

/** Riesgos que se destacan como `Badge` outline; el resto va como texto `--fg-muted`. */
const RISK_HIGHLIGHT: ReadonlySet<RiskClass> = new Set(['financial', 'physical', 'code']);

export function riskPresentation(risk: RiskClass): { label: string; badge: boolean } {
  return { label: RISK_LABEL[risk], badge: RISK_HIGHLIGHT.has(risk) };
}
