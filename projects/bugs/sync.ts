/**
 * Seguimiento de los PRs abiertos en GitHub: estado (abierto, fusionado, cerrado) y, si el
 * repositorio tiene CI, su resultado.
 *
 * El agente nunca fusiona: los PRs los fusiona una persona a mano en GitHub. Cuando el sondeo ve un PR
 * fusionado, hace el cierre en local sin tocar GitHub (`closeMergedPullRequest`: fusión en el `main`
 * local, versión nueva y `code.fix_merged`). Si lo cierran sin fusionar, el PR queda cerrado.
 */
import type { PlatformApi } from '../../platform/contracts.ts';
import { describeGitHubError, linkFor, type RemotePull } from './github.ts';
import { getState, saveState, type PullRequest } from './state.ts';
import { closeMergedPullRequest } from './tools.ts';

function noteOnCase(platform: PlatformApi, pr: PullRequest, title: string, detail?: string): void {
  if (!platform.cases.get(pr.caseId)) return;
  platform.cases.addTimeline(pr.caseId, { kind: 'note', actor: 'human', title, detail, data: { prId: pr.id, github: pr.github } });
}

async function closeMerged(platform: PlatformApi, pr: PullRequest): Promise<void> {
  const result = await closeMergedPullRequest(platform, pr.id);
  noteOnCase(
    platform,
    pr,
    `${pr.id} (#${pr.github?.number}) fusionado a mano en GitHub`,
    result.ok ? result.content : `No se ha completado el cierre: ${result.content}`,
  );
}

async function closeUnmerged(platform: PlatformApi, pr: PullRequest): Promise<void> {
  const current = getState(platform).prs.find((item) => item.id === pr.id);
  if (!current || current.status !== 'open') return;
  const closed: PullRequest = { ...current, status: 'closed', closedAt: new Date().toISOString() };
  saveState(platform, { prs: getState(platform).prs.map((item) => (item.id === closed.id ? closed : item)) });
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
