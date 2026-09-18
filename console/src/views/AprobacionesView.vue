<script setup lang="ts">
/**
 * Aprobaciones (docs/DESIGN.md § 6): cifras de feedback, las pendientes como tarjetas y el historial
 * en tabla. Lo que se decide durante la visita se queda entre las pendientes con su estado final
 * (y también pasa al historial); al cambiar de pestaña, desaparece de ahí.
 */
import { computed, onMounted, reactive, watch } from 'vue';
import type { Approval } from '../../../platform/contracts.ts';
import { live, pendingApprovals } from '../live.ts';
import ApprovalCard from '../components/ApprovalCard.vue';
import { agentName, loadAgents, loadPolicies } from '../components/catalog.ts';
import { excerpt, formatInt, formatPct } from '../components/format.ts';
import {
  ACTOR_BADGE,
  APPROVAL_STATUS,
  Badge,
  EmptyState,
  PageHeader,
  RelativeTime,
  Stat,
  StatGrid,
  StatusDot,
  riskPresentation,
  type StatusPresentation,
} from '../ui/index.ts';
import CaseLink from './project/CaseLink.vue';
import ScenarioEmptyState from './project/EmptyState.vue';

onMounted(() => {
  void loadAgents();
  void loadPolicies();
});

const pending = computed(() => pendingApprovals());

const history = computed(() =>
  Object.values(live.approvals)
    .filter((a) => a.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)),
);

// ── Feedback ────────────────────────────────────────────

const feedback = computed(() => {
  if (live.metrics) return live.metrics.feedback;
  const rejected = history.value.filter((a) => a.status === 'rejected').length;
  return { approved: history.value.length - rejected, rejected };
});

/** Sin decisiones no hay tasa: se muestra una raya en vez de un 0 % engañoso. */
const approvalRate = computed(() => {
  const total = feedback.value.approved + feedback.value.rejected;
  return total ? formatPct(feedback.value.approved / total) : null;
});

// ── Pendientes y lo decidido durante esta visita ────────

const seenPending = new Set<string>();
const decidedHere = reactive(new Set<string>());

watch(
  () =>
    Object.values(live.approvals)
      .map((a) => `${a.id}:${a.status}`)
      .join('|'),
  () => {
    for (const a of Object.values(live.approvals)) {
      if (a.status === 'pending') seenPending.add(a.id);
      else if (seenPending.has(a.id)) decidedHere.add(a.id);
    }
  },
  { immediate: true },
);

watch(
  () => live.resetCount,
  () => {
    seenPending.clear();
    decidedHere.clear();
  },
);

/** Orden de llegada, como la cola: lo recién decidido no cambia de sitio. */
const queue = computed(() =>
  Object.values(live.approvals)
    .filter((a) => a.status === 'pending' || decidedHere.has(a.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
);

// ── Historial ───────────────────────────────────────────

function outcomeOf(a: Approval): StatusPresentation {
  const base = APPROVAL_STATUS[a.status];
  const failed = a.status === 'failed' || (!!a.result && !a.result.ok);
  return failed ? { status: 'danger', label: base.label } : base;
}

function resultOf(a: Approval): string {
  if (a.result) return excerpt(a.result.content, 160);
  return a.status === 'rejected' ? 'No se ejecutó' : '';
}

function resultTitle(a: Approval): string | undefined {
  return a.result ? excerpt(a.result.content, 600) : undefined;
}
</script>

<template>
  <div class="page">
    <PageHeader title="Aprobaciones" description="Nada de lo que pide permiso se ejecuta hasta que una persona decide." />

    <StatGrid class="page__stats" :columns="3" size="sm" label="Feedback acumulado">
      <Stat label="Aprobadas" :value="formatInt(feedback.approved)" />
      <Stat label="Rechazadas" :value="formatInt(feedback.rejected)" />
      <Stat label="Tasa de aprobación" :value="approvalRate" />
    </StatGrid>

    <section class="section" aria-labelledby="pendientes-titulo">
      <div class="section__head">
        <h2 id="pendientes-titulo" class="section__title">Pendientes</h2>
        <span class="section__count" :aria-label="`${pending.length} pendientes`">{{ formatInt(pending.length) }}</span>
      </div>

      <div v-if="queue.length" class="cards">
        <ApprovalCard v-for="a in queue" :key="a.id" :approval="a" />
      </div>
      <ScenarioEmptyState
        v-else
        title="Nada pendiente"
        hint="Las acciones que piden permiso esperan aquí a una persona."
        :scenarios="['Bloqueo en un cliente que exige aprobación']"
      />
    </section>

    <section class="section" aria-labelledby="historial-titulo">
      <div class="section__head">
        <h2 id="historial-titulo" class="section__title">Historial</h2>
        <span v-if="history.length" class="section__count" :aria-label="`${history.length} decisiones`">
          {{ formatInt(history.length) }}
        </span>
      </div>

      <div v-if="history.length" class="table-wrap">
        <table class="table history">
          <thead>
            <tr>
              <th scope="col">Solicitud</th>
              <th scope="col">Propone</th>
              <th scope="col">Riesgo</th>
              <th scope="col">Resultado</th>
              <th scope="col">Decide</th>
              <th scope="col">Caso</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in history" :key="a.id">
              <td class="history__request">
                <div class="stack">
                  <span class="history__summary">{{ a.summary }}</span>
                  <span class="history__tool">{{ a.tool }}</span>
                </div>
              </td>
              <td>
                <span class="history__proposer">
                  <Badge :variant="ACTOR_BADGE[a.actor].variant" :label="ACTOR_BADGE[a.actor].label" />
                  <span v-if="a.actor === 'agent'">{{ agentName(a.agentId) }}</span>
                </span>
              </td>
              <td class="history__nowrap">
                <Badge v-if="riskPresentation(a.risk).badge" variant="outline" :label="riskPresentation(a.risk).label" />
                <span v-else class="history__muted">{{ riskPresentation(a.risk).label }}</span>
              </td>
              <td class="history__result">
                <div class="stack">
                  <StatusDot class="history__status" :status="outcomeOf(a).status" :label="outcomeOf(a).label" />
                  <span
                    v-if="resultOf(a)"
                    class="history__detail"
                    :class="{ 'is-danger': outcomeOf(a).status === 'danger' }"
                    :title="resultTitle(a)"
                  >
                    {{ resultOf(a) }}
                  </span>
                </div>
              </td>
              <td class="history__decider">
                <div class="stack">
                  <span>{{ a.decidedBy ?? 'Consola' }}</span>
                  <RelativeTime :at="a.decidedAt ?? a.createdAt" />
                  <span v-if="a.comment" class="history__muted">«{{ a.comment }}»</span>
                </div>
              </td>
              <td class="history__nowrap">
                <CaseLink :case-id="a.caseId" v-bind="live.cases[a.caseId] ? { title: `Abrir el caso «${live.cases[a.caseId].title}»` } : {}" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else title="Sin decisiones todavía" description="Cada decisión aparecerá aquí con su resultado." />
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}
.page__stats {
  margin-top: -8px;
}

/* ── Secciones ─────────────────────────────────────────── */
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.section__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.section__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
}
.section__count {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
  gap: 16px;
}

/* ── Historial ─────────────────────────────────────────── */
.history td {
  line-height: 20px;
  vertical-align: top;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.history__request {
  min-width: 240px;
}
.history__summary {
  color: var(--fg);
  font-weight: 500;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.history__tool {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  overflow-wrap: anywhere;
}
.history__proposer {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.history__nowrap {
  white-space: nowrap;
}
.history__muted {
  color: var(--fg-muted);
}
.history__result {
  min-width: 200px;
}
.history__status {
  white-space: nowrap;
}
.history__detail {
  display: -webkit-box;
  max-width: 36ch;
  padding-left: 16px;
  overflow: hidden;
  color: var(--fg-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}
.history__detail.is-danger {
  color: var(--danger);
}
.history__decider {
  min-width: 120px;
}
.history__decider .stack {
  gap: 0;
}
</style>
