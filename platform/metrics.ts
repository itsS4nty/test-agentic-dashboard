/** Métricas calculadas a demanda desde casos, aprobaciones y trazas. */
import type { Metrics, PlatformApi } from './contracts.ts';
import { readFeedback } from './approvals.ts';

const OPEN = new Set(['open', 'running', 'waiting_approval', 'escalated']);
const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

export function computeMetrics(platform: PlatformApi): Metrics {
  const cases = platform.cases.list();
  const resolved = cases.filter((c) => c.status === 'resolved');
  const resolvedBy = (actor: string) => resolved.filter((c) => c.resolvedBy === actor).length;

  let llmCalls = 0;
  let toolCalls = 0;
  let blockedByPolicy = 0;
  let costUsd = 0;
  const tokens = { input: 0, output: 0 };
  const byProject: Metrics['byProject'] = {};

  for (const c of cases) {
    costUsd += c.costUsd;
    tokens.input += c.tokens.input;
    tokens.output += c.tokens.output;
    const project = (byProject[c.project] ??= { cases: 0, resolved: 0, costUsd: 0 });
    project.cases++;
    if (c.status === 'resolved') project.resolved++;
    project.costUsd += c.costUsd;

    for (const entry of c.timeline) {
      if (entry.kind === 'llm') llmCalls++;
      else if (entry.kind === 'tool') toolCalls++;
      else if (entry.kind === 'policy' && entry.decision === 'deny') blockedByPolicy++;
    }
  }
  for (const project of Object.values(byProject)) project.costUsd = round(project.costUsd);

  const resolvedByRule = resolvedBy('rule');
  const resolvedByAgent = resolvedBy('agent');

  return {
    casesTotal: cases.length,
    casesOpen: cases.filter((c) => OPEN.has(c.status)).length,
    casesResolved: resolved.length,
    resolvedByRule,
    resolvedByAgent,
    resolvedByHuman: resolvedBy('human'),
    autoResolutionRate: resolved.length ? (resolvedByRule + resolvedByAgent) / resolved.length : 0,
    pendingApprovals: platform.approvals.list({ status: 'pending' }).length,
    costUsd: round(costUsd),
    tokens,
    llmCalls,
    toolCalls,
    blockedByPolicy,
    feedback: readFeedback(platform),
    byProject,
  };
}
