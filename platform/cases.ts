/** Casos y su traza. Toda mutación emite `case.upsert` (y `timeline` al añadir entradas). */
import type { Actor, Case, CaseService, CaseStatus, PlatformApi, Scope, TimelineEntry } from './contracts.ts';
import { newId, nowIso, truncate } from './util.ts';

const COLLECTION = 'cases';
const OPEN_STATUSES: CaseStatus[] = ['open', 'running', 'waiting_approval', 'escalated'];
const RESOLVED_BY: Record<Actor, string> = { rule: 'una regla', agent: 'el agente', human: 'una persona' };

export function createCaseService(platform: PlatformApi): CaseService {
  const { store, events } = platform;

  function mustGet(id: string): Case {
    const found = store.get<Case>(COLLECTION, id);
    if (!found) throw new Error(`Caso no encontrado: ${id}`);
    return found;
  }

  function save(record: Case): Case {
    record.updatedAt = nowIso();
    store.put(COLLECTION, record);
    events.emit({ type: 'case.upsert', case: record });
    return record;
  }

  function completeScope(scope: Scope): Scope {
    const out: Scope = { ...scope };
    if (out.siteId && !out.clientId) {
      const site = platform.directory.site(out.siteId);
      if (site) out.clientId = site.clientId;
    }
    return out;
  }

  const service: CaseService = {
    create(input) {
      const at = nowIso();
      const scope = completeScope(input.scope ?? {});
      const record: Case = {
        id: newId('case'),
        project: input.project,
        agentId: input.agentId,
        title: input.title,
        summary: input.summary,
        source: input.source,
        scope,
        status: 'open',
        severity: input.severity ?? 'medium',
        createdAt: at,
        updatedAt: at,
        data: input.data ?? {},
        costUsd: 0,
        tokens: { input: 0, output: 0 },
        timeline: [],
      };
      store.put(COLLECTION, record);
      service.addTimeline(record.id, {
        kind: 'created',
        title: 'Caso creado',
        detail: `${input.title} · ${platform.directory.describeScope(scope)}`,
      });
      return record;
    },

    get: (id) => store.get<Case>(COLLECTION, id),

    list(filter = {}) {
      return store
        .list<Case>(COLLECTION)
        .filter((c) => (!filter.project || c.project === filter.project) && (!filter.status || c.status === filter.status));
    },

    findOpen(predicate) {
      return store.list<Case>(COLLECTION).find((c) => OPEN_STATUSES.includes(c.status) && predicate(c));
    },

    update(id, patch) {
      const record = mustGet(id);
      Object.assign(record, patch);
      return save(record);
    },

    addTimeline(id, entry) {
      const record = mustGet(id);
      const full: TimelineEntry = { ...entry, id: newId('tl'), at: nowIso() };
      record.timeline.push(full);
      if (full.kind === 'llm') {
        record.costUsd += full.costUsd ?? 0;
        record.tokens.input += full.inputTokens ?? 0;
        record.tokens.output += full.outputTokens ?? 0;
      }
      record.updatedAt = full.at;
      store.put(COLLECTION, record);
      events.emit({ type: 'timeline', caseId: id, entry: full });
      events.emit({ type: 'case.upsert', case: record });
      return full;
    },

    resolve(id, by, summary) {
      const record = mustGet(id);
      record.status = 'resolved';
      record.resolvedBy = by;
      if (summary) record.summary = summary;
      service.addTimeline(id, {
        kind: 'status',
        title: `Resuelto por ${RESOLVED_BY[by]}`,
        detail: summary ? truncate(summary, 600) : undefined,
        actor: by,
      });
      return record;
    },

    escalate(id, reason) {
      const record = mustGet(id);
      record.status = 'escalated';
      service.addTimeline(id, { kind: 'status', title: 'Escalado a una persona', detail: reason });
      platform.notifications.push({
        level: 'warning',
        title: `Caso escalado: ${record.title}`,
        detail: reason,
        caseId: id,
        project: record.project,
      });
      return record;
    },
  };

  return service;
}
