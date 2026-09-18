/**
 * Presentación de las propuestas de agentes: estados de solicitud y de PR, ficheros y la
 * aprobación que espera la fusión. Misma correspondencia de colores que docs/DESIGN.md § 3.
 */
import type { Approval } from '../../../../platform/contracts.ts';
import { live } from '../../live.ts';
import type { StatusPresentation } from '../../ui/index.ts';
import type { AgentPr, AgentPrFile, AgentRequest, AgentRequestStatus } from '../project/types.ts';

export const PLATAFORMA = 'plataforma';

export const REQUEST_STATUS: Record<AgentRequestStatus, StatusPresentation> = {
  queued: { status: 'neutral', label: 'En cola' },
  working: { status: 'pending', label: 'Trabajando' },
  pr_open: { status: 'warning', label: 'PR abierto' },
  merged: { status: 'success', label: 'Fusionado' },
  active: { status: 'success', label: 'Activo' },
  closed: { status: 'neutral', label: 'Cerrado' },
  failed: { status: 'danger', label: 'Falló' },
};

export const FILE_STATUS: Record<AgentPrFile['status'], string> = {
  added: 'Añadido',
  modified: 'Modificado',
};

/** Una solicitud con su PR, si ya lo hay. */
export interface Proposal {
  request: AgentRequest;
  pr?: AgentPr;
}

/** Estado de solicitud equivalente para un PR que no casa con ninguna solicitud. */
function statusFromPr(pr: AgentPr): AgentRequestStatus {
  if (pr.status === 'open') return 'pr_open';
  if (pr.status === 'closed') return 'closed';
  return pr.activation?.state === 'active' ? 'active' : 'merged';
}

/** Solicitudes con su PR, de la más reciente a la más antigua. Un PR sin solicitud también sale. */
export function proposalsOf(requests: AgentRequest[], prs: AgentPr[]): Proposal[] {
  const used = new Set<string>();
  const out: Proposal[] = requests.map((request) => {
    const pr =
      (request.prId ? prs.find((p) => p.id === request.prId) : undefined) ??
      prs.find((p) => !used.has(p.id) && p.caseId === request.caseId);
    if (pr) used.add(pr.id);
    return { request, pr };
  });
  for (const pr of prs) {
    if (used.has(pr.id)) continue;
    out.push({
      pr,
      request: {
        id: pr.id,
        caseId: pr.caseId,
        name: pr.title,
        agentId: pr.agentId,
        createdAt: pr.createdAt,
        status: statusFromPr(pr),
        prId: pr.id,
      },
    });
  }
  return out.sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt));
}

/** Aprobación pendiente que espera la fusión del PR de una propuesta. */
export function pendingMerge(proposal: Proposal): Approval | undefined {
  const { request, pr } = proposal;
  if (pr && pr.status !== 'open') return undefined;
  return Object.values(live.approvals)
    .filter(
      (a) =>
        a.status === 'pending' &&
        (a.project === PLATAFORMA || a.tool.startsWith(`${PLATAFORMA}_`)) &&
        ((pr && (a.input as { prId?: unknown } | null)?.prId === pr.id) || a.caseId === request.caseId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
