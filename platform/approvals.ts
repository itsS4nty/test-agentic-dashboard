/** Cola de aprobaciones humanas. Aprobar ejecuta la acción; cada decisión cuenta como feedback. */
import type { Approval, ApprovalService, PlatformApi } from './contracts.ts';
import { newId, nowIso } from './util.ts';

const COLLECTION = 'approvals';
const FEEDBACK_KEY = 'feedback';

export interface Feedback {
  approved: number;
  rejected: number;
}

export function readFeedback(platform: PlatformApi): Feedback {
  return platform.store.getValue<Feedback>(FEEDBACK_KEY) ?? { approved: 0, rejected: 0 };
}

export function createApprovalService(platform: PlatformApi): ApprovalService {
  function save(approval: Approval): Approval {
    platform.store.put(COLLECTION, approval);
    platform.events.emit({ type: 'approval.upsert', approval });
    return approval;
  }

  function countFeedback(decision: 'approved' | 'rejected'): void {
    const feedback = { ...readFeedback(platform) };
    feedback[decision] += 1;
    platform.store.setValue(FEEDBACK_KEY, feedback);
  }

  const service: ApprovalService = {
    create(input) {
      return save({ ...input, id: newId('apr'), status: 'pending', createdAt: nowIso() });
    },

    get: (id) => platform.store.get<Approval>(COLLECTION, id),

    /** Más recientes primero. */
    list(filter = {}) {
      return platform.store
        .list<Approval>(COLLECTION)
        .filter((a) => (!filter.status || a.status === filter.status) && (!filter.caseId || a.caseId === filter.caseId))
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async decide(id, decision, by, comment) {
      const approval = service.get(id);
      if (!approval) throw new Error(`Aprobación no encontrada: ${id}`);
      if (decision !== 'approved' && decision !== 'rejected') throw new Error(`Decisión no válida: ${decision}`);
      if (approval.status !== 'pending') throw new Error(`La aprobación ${id} ya está decidida (${approval.status}).`);

      approval.status = decision;
      approval.decidedAt = nowIso();
      approval.decidedBy = by;
      if (comment) approval.comment = comment;
      save(approval);
      countFeedback(decision);

      const caseExists = Boolean(platform.cases.get(approval.caseId));
      if (caseExists) {
        platform.cases.addTimeline(approval.caseId, {
          kind: 'approval',
          title: `${decision === 'approved' ? 'Aprobado' : 'Rechazado'} por ${by}: ${approval.summary}`,
          detail: comment,
          actor: 'human',
          tool: approval.tool,
          data: { approvalId: approval.id, decision },
        });
      }

      if (decision === 'approved') {
        const outcome = await platform.tools.invoke(approval.tool, approval.input, {
          caseId: approval.caseId,
          actor: 'human',
          reason: comment ?? `Aprobado por ${by}`,
          skipPolicy: true,
        });
        approval.result = outcome.result;
        approval.status = outcome.result.ok ? 'executed' : 'failed';
        save(approval);
      }

      const record = platform.cases.get(approval.caseId);
      if (record && record.status === 'waiting_approval' && service.list({ caseId: record.id, status: 'pending' }).length === 0) {
        platform.cases.resolve(record.id, 'human');
      }
      return approval;
    },
  };

  return service;
}
