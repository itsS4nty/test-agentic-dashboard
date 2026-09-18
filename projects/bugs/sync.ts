/**
 * Seguimiento de los PRs abiertos en GitHub: estado (abierto, fusionado, cerrado) y, si el
 * repositorio tiene CI, su resultado. La demo no añade ninguna: entonces el estado es `none` y lo
 * único que sigue el sondeo es el PR.
 *
 * Si alguien fusiona el PR directamente en GitHub, se hace el mismo cierre que al aprobar la fusión en
 * la consola (versión nueva, `code.fix_merged`) y la aprobación pendiente se resuelve como aprobada por
 * «GitHub». Si lo cierra sin fusionar, el PR queda cerrado y la aprobación, rechazada.
 */
import type { Approval, PlatformApi } from '../../platform/contracts.ts';
import { describeGitHubError, linkFor, type RemotePull } from './github.ts';
import { getState, saveState, type PullRequest } from './state.ts';
import { mergePullRequest } from './tools.ts';

const DECIDED_BY = 'GitHub';

function pendingMergeApproval(platform: PlatformApi, prId: string): Approval | undefined {
  return platform.approvals
    .list({ status: 'pending' })
    .find((approval) => approval.tool === 'bugs_merge_pr' && String((approval.input as { prId?: unknown })?.prId) === prId);
}

function noteOnCase(platform: PlatformApi, pr: PullRequest, title: string, detail?: string): void {
  if (!platform.cases.get(pr.caseId)) return;
  platform.cases.addTimeline(pr.caseId, { kind: 'note', actor: 'human', title, detail, data: { prId: pr.id, github: pr.github } });
}

async function closeMerged(platform: PlatformApi, pr: PullRequest): Promise<void> {
  const approval = pendingMergeApproval(platform, pr.id);
  if (approval) {
    try {
      // Aprobar ejecuta bugs_merge_pr, que ve el PR ya fusionado y solo hace el cierre.
      await platform.approvals.decide(approval.id, 'approved', DECIDED_BY, 'Fusionado directamente en GitHub.');
      return;
    } catch {
      // Otra persona acaba de decidirla: el cierre de abajo es idempotente.
    }
  }
  const result = await mergePullRequest(platform, pr.id);
  noteOnCase(
    platform,
    pr,
    `${pr.id} (#${pr.github?.number}) fusionado directamente en GitHub`,
    result.ok ? result.content : `No se ha completado el cierre: ${result.content}`,
  );
}

async function closeUnmerged(platform: PlatformApi, pr: PullRequest): Promise<void> {
  const current = getState(platform).prs.find((item) => item.id === pr.id);
  if (!current || current.status !== 'open') return;
  const closed: PullRequest = { ...current, status: 'closed', closedAt: new Date().toISOString() };
  saveState(platform, { prs: getState(platform).prs.map((item) => (item.id === closed.id ? closed : item)) });

  const approval = pendingMergeApproval(platform, pr.id);
  if (approval) {
    try {
      await platform.approvals.decide(approval.id, 'rejected', DECIDED_BY, 'PR cerrado en GitHub sin fusionar.');
      return;
    } catch {
      // Ya decidida por otra vía.
    }
  }
  noteOnCase(platform, pr, `${pr.id} (#${pr.github?.number}) cerrado en GitHub sin fusionar`);
}

/**
 * Un sondeo: revisa cada PR abierto en GitHub. Devuelve si quedan PRs abiertos que seguir.
 * El servidor lo llama cada ~10 s; las comprobaciones pueden llamarlo a mano.
 */
export async function syncGitHub(platform: PlatformApi): Promise<boolean> {
  const link = linkFor(platform);
  if (link.mode !== 'github') return false;

  const open = getState(platform).prs.filter((pr) => pr.status === 'open' && pr.github);
  for (const pr of open) {
    let remote: RemotePull;
    try {
      remote = await link.getPull(pr.github!.number);
    } catch (error) {
      console.warn(`[bugs] No se puede consultar ${pr.id} en GitHub: ${describeGitHubError(error)}`);
      continue;
    }

    if (remote.merged) {
      await closeMerged(platform, pr);
      continue;
    }
    if (remote.state === 'closed') {
      await closeUnmerged(platform, pr);
      continue;
    }

    const ci = await link.ciStatus(remote.headSha);
    const current = getState(platform).prs.find((item) => item.id === pr.id);
    if (current?.github && current.status === 'open' && current.github.ci !== ci) {
      const updated: PullRequest = { ...current, github: { ...current.github, ci } };
      saveState(platform, { prs: getState(platform).prs.map((item) => (item.id === updated.id ? updated : item)) });
    }
  }

  // Fusionados con la CI aún en curso: se sigue su resultado hasta que termine. Sin CI en el
  // repositorio (`none`, lo normal en la demo) no hay nada que seguir y el sondeo se para.
  for (const pr of getState(platform).prs.filter((item) => item.status === 'merged' && item.github?.ci === 'pending' && item.headSha)) {
    const ci = await link.ciStatus(pr.headSha!);
    const current = getState(platform).prs.find((item) => item.id === pr.id);
    if (current?.github && current.github.ci !== ci) {
      const updated: PullRequest = { ...current, github: { ...current.github, ci } };
      saveState(platform, { prs: getState(platform).prs.map((item) => (item.id === updated.id ? updated : item)) });
    }
  }

  return getState(platform).prs.some((pr) => pr.github && (pr.status === 'open' || (pr.status === 'merged' && pr.github.ci === 'pending')));
}
