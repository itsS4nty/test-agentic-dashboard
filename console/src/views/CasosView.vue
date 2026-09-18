<script setup lang="ts">
/**
 * Casos: lista a la izquierda con buscador y filtros; a la derecha, el detalle del caso elegido con
 * su estado, metadatos, coste (Reglas · IA · Total), traza y aprobaciones.
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { Actor, Case, CaseStatus } from '../../../platform/contracts.ts';
import { api } from '../api.ts';
import { live, sortedCases } from '../live.ts';
import ApprovalCard from '../components/ApprovalCard.vue';
import { agentName, describeScope, projectName, projectOrder } from '../components/catalog.ts';
import { SEVERITY_LABEL, SOURCE_LABEL, formatInt, formatUsd, fullTime, sinPartir, toJson } from '../components/format.ts';
import TraceEntry from '../components/TraceEntry.vue';
import {
  Button,
  CASE_STATUS,
  Card,
  CodeBlock,
  EmptyState,
  KeyValue,
  PageHeader,
  RelativeTime,
  Stat,
  StatGrid,
  StatusDot,
  Timeline,
  TimelineItem,
  type KeyValueItem,
  type StatusPresentation,
} from '../ui/index.ts';
import ScenarioEmptyState from './project/EmptyState.vue';

const props = defineProps<{ caseId: string | null }>();
const emit = defineEmits<{ select: [caseId: string | null] }>();

// ── Filtros ─────────────────────────────────────────────
type StatusFilter = 'all' | 'active' | 'waiting_approval' | 'escalated' | 'resolved';
const STATUS_FILTERS: { id: StatusFilter; label: string; match: (s: CaseStatus) => boolean }[] = [
  { id: 'all', label: 'Estado: todos', match: () => true },
  { id: 'active', label: 'Abiertos', match: (s) => s === 'open' || s === 'running' },
  { id: 'waiting_approval', label: 'Pendientes', match: (s) => s === 'waiting_approval' },
  { id: 'escalated', label: 'Escalados', match: (s) => s === 'escalated' || s === 'failed' },
  { id: 'resolved', label: 'Resueltos', match: (s) => s === 'resolved' },
];

const statusFilter = ref<StatusFilter>('all');
const projectFilter = ref('');
const query = ref('');

const allCases = computed(() => sortedCases());
const projects = computed(() => {
  const present = new Set(allCases.value.map((c) => c.project));
  return projectOrder().filter((p) => present.has(p));
});

const narrowed = computed(() => {
  const text = query.value.trim().toLowerCase();
  return allCases.value.filter((c) => {
    if (projectFilter.value && c.project !== projectFilter.value) return false;
    if (!text) return true;
    return [c.title, c.id, describeScope(c.scope), c.agentId ?? '', c.summary ?? ''].some((field) =>
      field.toLowerCase().includes(text),
    );
  });
});

const counts = computed(() =>
  Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, narrowed.value.filter((c) => f.match(c.status)).length])),
);

const filtered = computed(() => {
  const filter = STATUS_FILTERS.find((f) => f.id === statusFilter.value) ?? STATUS_FILTERS[0];
  return narrowed.value.filter((c) => filter.match(c.status));
});

const hasFilters = computed(() => !!query.value.trim() || !!projectFilter.value || statusFilter.value !== 'all');
function clearFilters() {
  query.value = '';
  projectFilter.value = '';
  statusFilter.value = 'all';
}

// ── Caso seleccionado ───────────────────────────────────
const fetched = ref<Case | null>(null);
const missing = ref(false);

watch(
  () => [props.caseId, live.resetCount] as const,
  async ([id]) => {
    missing.value = false;
    if (!id || live.cases[id]) return;
    try {
      const found = await api.case(id);
      if (props.caseId === id) fetched.value = found;
    } catch {
      if (props.caseId === id && !live.cases[id]) missing.value = true;
    }
  },
  { immediate: true },
);

const selected = computed<Case | null>(() => {
  const id = props.caseId;
  if (!id) return null;
  return live.cases[id] ?? (fetched.value?.id === id ? fetched.value : null);
});

const stats = computed(() => {
  const c = selected.value;
  if (!c) return null;
  let llm = 0;
  let tools = 0;
  let blocked = 0;
  let rules = 0;
  for (const e of c.timeline) {
    if (e.kind === 'llm') llm++;
    if (e.kind === 'tool') tools++;
    if (e.kind === 'rule') rules++;
    if (e.decision === 'deny' || e.decision === 'escalate') blocked++;
  }
  return { llm, tools, blocked, rules };
});

const caseApprovals = computed(() => {
  const id = selected.value?.id;
  if (!id) return [];
  return Object.values(live.approvals)
    .filter((a) => a.caseId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});
const pendingForCase = computed(() => caseApprovals.value.filter((a) => a.status === 'pending'));

const isRunning = computed(() => !!selected.value && live.runs.some((r) => r.caseId === selected.value?.id));
const hasData = computed(() => !!selected.value && Object.keys(selected.value.data ?? {}).length > 0);

function select(id: string) {
  emit('select', props.caseId === id ? null : id);
}

/* Al abrir un caso desde otra vista («Ver caso»), su fila queda a la vista en la lista. */
const listRef = ref<HTMLElement | null>(null);
watch(
  () => [props.caseId, allCases.value.length > 0] as const,
  async ([id]) => {
    if (!id) return;
    await nextTick();
    const container = listRef.value;
    const row = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !row) return;
    const box = container.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) container.scrollTop += rect.top - box.top - 8;
  },
  { immediate: true },
);

// ── Presentación ────────────────────────────────────────
const RESOLVED_BY: Record<Actor, string> = { rule: 'regla', agent: 'IA', human: 'persona' };

function caseStatus(c: Case): StatusPresentation {
  const base = CASE_STATUS[c.status];
  if (c.status === 'resolved' && c.resolvedBy) return { ...base, label: `Resuelto por ${RESOLVED_BY[c.resolvedBy]}` };
  return base;
}

/** «17 sept, 13:40»; la fecha completa va en `title`. */
function shortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const count = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

const meta = computed<KeyValueItem[]>(() => {
  const c = selected.value;
  if (!c) return [];
  return [
    { label: 'Proyecto', value: projectName(c.project) },
    { label: 'Agente', value: c.agentId ? agentName(c.agentId) : null },
    { label: 'Ámbito', value: describeScope(c.scope) },
    { label: 'Origen', value: SOURCE_LABEL[c.source] ?? c.source },
    { label: 'Severidad', value: SEVERITY_LABEL[c.severity] },
    { label: 'Creado', slot: 'created' },
    { label: 'Actualizado', slot: 'updated' },
    { label: 'ID', value: c.id, mono: true },
  ];
});

const costStats = computed(() => {
  const c = selected.value;
  const s = stats.value;
  if (!c || !s) return null;
  return {
    rulesHint: count(s.rules, 'paso de regla', 'pasos de regla'),
    ai: formatUsd(c.costUsd),
    aiHint: s.llm
      ? `${count(s.llm, 'llamada', 'llamadas')} · ${formatInt(c.tokens.input + c.tokens.output)} tokens`
      : 'Sin llamadas a IA',
    aiTitle: `${formatInt(c.tokens.input)} tokens de entrada · ${formatInt(c.tokens.output)} de salida`,
    totalHint: `${count(s.tools, 'acción', 'acciones')} · ${count(s.blocked, 'bloqueo', 'bloqueos')}`,
  };
});

/** Lleva a las aprobaciones del caso, que van debajo de la traza. */
async function goToApprovals() {
  await nextTick();
  const target = document.getElementById('aprobaciones-del-caso');
  if (!target) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}
</script>

<template>
  <div class="casos-view">
    <PageHeader title="Casos" description="Cada incidencia con su traza, sus decisiones y su coste." />

    <div class="casos" :class="{ 'has-selection': !!caseId }">
      <!-- Lista -->
      <aside class="list" aria-label="Lista de casos">
        <div class="list__filters">
          <input
            v-model="query"
            type="search"
            class="list__search"
            placeholder="Buscar por título, tienda o agente"
            aria-label="Buscar casos"
          />
          <div class="list__selects">
            <select v-model="statusFilter" aria-label="Filtrar por estado">
              <option v-for="f in STATUS_FILTERS" :key="f.id" :value="f.id">
                {{ f.id === 'all' ? f.label : `${f.label} · ${counts[f.id]}` }}
              </option>
            </select>
            <select v-model="projectFilter" aria-label="Filtrar por proyecto">
              <option value="">Proyecto: todos</option>
              <option v-for="p in projects" :key="p" :value="p">{{ projectName(p) }}</option>
            </select>
          </div>
        </div>

        <div ref="listRef" class="list__scroll">
          <ul v-if="filtered.length" class="list__rows">
            <li v-for="c in filtered" :key="c.id">
              <button
                type="button"
                class="row"
                :aria-current="c.id === caseId ? 'true' : undefined"
                @click="select(c.id)"
              >
                <span class="row__top">
                  <span class="row__title">{{ sinPartir(c.title) }}</span>
                  <RelativeTime :at="c.updatedAt" class="row__time" />
                </span>
                <span class="row__scope">{{ projectName(c.project) }} · {{ describeScope(c.scope) }}</span>
                <span class="row__bottom">
                  <StatusDot :status="caseStatus(c).status" :label="caseStatus(c).label" class="row__status" />
                  <span class="row__cost" :class="{ 'is-zero': !c.costUsd }">{{ formatUsd(c.costUsd) }}</span>
                </span>
              </button>
            </li>
          </ul>
          <div v-else class="list__empty">
            <ScenarioEmptyState
              v-if="!allCases.length"
              compact
              title="Aún no hay casos."
              hint="Lanza un escenario desde el director de demo."
              :scenarios="['Datáfono bloqueado']"
            />
            <EmptyState v-else compact title="Ningún caso coincide con los filtros.">
              <template v-if="hasFilters" #action>
                <Button size="sm" variant="secondary" @click="clearFilters">Quitar filtros</Button>
              </template>
            </EmptyState>
          </div>
        </div>
      </aside>

      <!-- Detalle -->
      <article
        v-if="selected && stats && costStats"
        class="detail"
        aria-labelledby="caso-titulo"
      >
        <header class="detail__header">
          <div class="detail__title-row">
            <h2 id="caso-titulo" class="detail__title">{{ sinPartir(selected.title) }}</h2>
            <div class="detail__actions">
              <Button v-if="pendingForCase.length" variant="primary" size="sm" @click="goToApprovals">
                {{ pendingForCase.length === 1 ? 'Revisar aprobación' : `Revisar ${pendingForCase.length} aprobaciones` }}
              </Button>
              <Button variant="ghost" size="sm" @click="emit('select', null)">Cerrar</Button>
            </div>
          </div>
          <div class="detail__status">
            <StatusDot :status="caseStatus(selected).status" :label="caseStatus(selected).label" />
            <StatusDot v-if="isRunning && selected.status !== 'running'" status="pending" label="Agente trabajando" muted />
          </div>
          <p v-if="selected.summary" class="detail__summary">{{ selected.summary }}</p>
        </header>

        <KeyValue class="detail__meta" layout="stacked" :items="meta">
          <template #created>
            <time :datetime="selected.createdAt" :title="fullTime(selected.createdAt)">{{
              shortDateTime(selected.createdAt)
            }}</time>
          </template>
          <template #updated>
            <RelativeTime :at="selected.updatedAt" class="detail__updated" />
          </template>
        </KeyValue>

        <StatGrid :columns="3" size="sm" label="Coste del caso">
          <Stat label="Reglas" :value="formatUsd(0)" :hint="costStats.rulesHint" />
          <Stat label="IA" :value="costStats.ai">
            <template #hint><span :title="costStats.aiTitle">{{ costStats.aiHint }}</span></template>
          </Stat>
          <Stat label="Total" :value="costStats.ai" :hint="costStats.totalHint" />
        </StatGrid>

        <Card title="Traza" :heading-level="3">
          <template #actions>
            <span class="detail__count">{{ count(selected.timeline.length, 'paso', 'pasos') }}</span>
          </template>
          <Timeline :aria-label="`Traza del caso, ${count(selected.timeline.length, 'paso', 'pasos')}`">
            <TraceEntry v-for="entry in selected.timeline" :key="entry.id" :entry="entry" />
            <TimelineItem
              v-if="isRunning"
              status="pending"
              status-label="En curso"
              title="El agente sigue trabajando"
            />
          </Timeline>
        </Card>

        <section
          v-if="caseApprovals.length"
          id="aprobaciones-del-caso"
          class="approvals"
          aria-labelledby="aprobaciones-del-caso-titulo"
          tabindex="-1"
        >
          <h3 id="aprobaciones-del-caso-titulo" class="approvals__title">
            Aprobaciones
            <span class="approvals__count">{{ caseApprovals.length }}</span>
          </h3>
          <div class="approvals__list">
            <ApprovalCard v-for="a in caseApprovals" :key="a.id" :approval="a" :show-case-link="false" />
          </div>
        </section>

        <details v-if="hasData" class="fold">
          <summary class="fold__summary">
            <svg class="fold__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
              <path
                d="M4.5 2.5 8 6l-3.5 3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Datos del caso
          </summary>
          <CodeBlock class="fold__code" :code="toJson(selected.data)" label="JSON" max-height="360px" />
        </details>
      </article>

      <div v-else class="detail detail--empty">
        <EmptyState v-if="caseId && missing" title="Este caso ya no existe" description="Puede que se haya reiniciado la demo.">
          <template #action>
            <Button size="sm" @click="emit('select', null)">Volver a la lista</Button>
          </template>
        </EmptyState>
        <EmptyState v-else-if="caseId" title="Cargando el caso…" />
        <EmptyState v-else title="Elige un caso" description="Verás su traza, quién actuó y cuánto costó." />
      </div>
    </div>
  </div>
</template>

<style scoped>
.casos-view {
  container: casos / inline-size;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.casos {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
@container casos (max-width: 759px) {
  .casos {
    grid-template-columns: minmax(0, 1fr);
  }
  .casos.has-selection .detail {
    order: -1;
  }
  .casos:not(.has-selection) .detail--empty {
    display: none;
  }
}

/* ── Lista ─────────────────────────────────────────────── */
.list {
  position: sticky;
  top: calc(var(--header-h) + var(--tabs-h) + 24px);
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 48px);
  min-height: 240px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
@container casos (max-width: 759px) {
  .list {
    position: static;
    max-height: 60vh;
  }
}

.list__filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
.list__search {
  width: 100%;
  min-width: 0;
}
.list__selects {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.list__selects select {
  width: 100%;
  min-width: 0;
  padding: 0 4px 0 8px;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
}

.list__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.list__rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.list__rows > li + li {
  border-top: 1px solid var(--border);
}
.list__empty {
  padding: 16px;
}

.row {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 12px 16px;
  border: 0;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms var(--ease);
}
.row:hover {
  background: var(--bg-hover);
}
.row[aria-current='true'] {
  background: var(--bg-muted);
  box-shadow: inset 2px 0 0 var(--fg);
}
.row:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.row__top,
.row__bottom {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.row__title {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.row__time {
  flex: none;
  font-size: var(--text-xs);
  line-height: 20px;
}
.row__scope {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-muted);
}
.row__bottom {
  margin-top: 6px;
  align-items: center;
}
.row__bottom .row__status {
  font-size: var(--text-sm);
}
.row__cost {
  flex: none;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row__cost.is-zero {
  color: var(--fg-subtle);
}
/* Sobre el fondo de la fila elegida o en hover, el gris más claro no llega a AA: sube un tono. */
.row:hover .row__time,
.row[aria-current='true'] .row__time,
.row:hover .row__cost.is-zero,
.row[aria-current='true'] .row__cost.is-zero {
  color: var(--fg-muted);
}

/* ── Detalle ───────────────────────────────────────────── */
.detail {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.detail__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.detail__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
}
.detail__title {
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.detail__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 28px;
}
.detail__status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: var(--text-sm);
}
.detail__summary {
  max-width: 72ch;
  margin-top: 4px;
  font-size: var(--text-base);
  line-height: 22px;
  color: var(--fg-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
@container casos (max-width: 519px) {
  .detail__title-row {
    flex-direction: column-reverse;
  }
  .detail__actions {
    justify-content: flex-start;
  }
}

.detail__meta {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.detail__meta .detail__updated {
  color: var(--fg);
}

.detail__count {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Aprobaciones del caso ─────────────────────────────── */
.approvals {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  scroll-margin-top: calc(var(--header-h) + var(--tabs-h) + 16px);
}
.approvals:focus-visible {
  outline-offset: 4px;
  border-radius: var(--radius-sm);
}
.approvals__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
}
.approvals__count {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.approvals__list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Datos del caso ────────────────────────────────────── */
.fold__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
  list-style: none;
  cursor: pointer;
  user-select: none;
  transition: color 150ms var(--ease);
}
.fold__summary::-webkit-details-marker {
  display: none;
}
.fold__summary:hover {
  color: var(--fg);
}
.fold__chevron {
  flex: none;
  transition: transform 150ms var(--ease);
}
.fold[open] .fold__chevron {
  transform: rotate(90deg);
}
.fold__code {
  margin-top: 8px;
}
</style>
