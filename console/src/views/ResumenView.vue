<script setup lang="ts">
/**
 * Resumen: cifras de la plataforma, actividad en vivo con filtros y, al lado, los agentes en
 * ejecución, el coste por proyecto y los avisos.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Notification, TimelineEntry } from '../../../platform/contracts.ts';
import { live, pendingApprovals, type FeedItem } from '../live.ts';
import { agentName, loadAgents, projectName, projectOrder } from '../components/catalog.ts';
import { elapsedSince, excerpt, formatInt, formatUsd, fullTime, sinPartir, useNow } from '../components/format.ts';
import {
  ACTOR_BADGE,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  RelativeTime,
  SegmentedControl,
  Stat,
  StatGrid,
  StatusDot,
  decisionBadge,
  type BadgePresentation,
  type SegmentedOption,
  type Status,
} from '../ui/index.ts';
import CaseLink from './project/CaseLink.vue';
import ScenarioEmptyState from './project/EmptyState.vue';

const MAX_CONCURRENCY = 3;
const FEED_VISIBLE = 60;
const NOTIFICATIONS_VISIBLE = 5;

onMounted(() => void loadAgents());
const now = useNow();

const metrics = computed(() => live.metrics);
const pendingCount = computed(() => pendingApprovals().length);

// ── Cifras ──────────────────────────────────────────────
/** Pasos de la traza hechos por reglas frente a llamadas a IA. */
const workSplit = computed(() => {
  let rule = 0;
  let llm = 0;
  for (const c of Object.values(live.cases)) {
    for (const entry of c.timeline) {
      if (entry.kind === 'llm') llm++;
      else if (entry.kind === 'rule' || (entry.kind === 'tool' && entry.actor === 'rule')) rule++;
    }
  }
  return { rule, llm };
});

const stats = computed(() => {
  const m = metrics.value;
  const resolved = m?.casesResolved ?? 0;
  const blocked = m?.blockedByPolicy ?? 0;
  const tokens = (m?.tokens.input ?? 0) + (m?.tokens.output ?? 0);
  return {
    cases: formatInt(m?.casesTotal),
    casesHint: `${formatInt(m?.casesOpen)} abiertos · ${formatInt(resolved)} resueltos`,
    auto: resolved ? `${Math.round((m?.autoResolutionRate ?? 0) * 100)} %` : null,
    autoHint: resolved
      ? `${formatInt(m?.resolvedByRule)} por regla · ${formatInt(m?.resolvedByAgent)} por IA · ${formatInt(m?.resolvedByHuman)} por persona`
      : 'Sin casos resueltos',
    autoTitle: resolved
      ? `${formatInt(m?.resolvedByRule)} por regla, ${formatInt(m?.resolvedByAgent)} por IA y ${formatInt(m?.resolvedByHuman)} por una persona`
      : undefined,
    cost: formatUsd(m?.costUsd),
    costHint: `${formatInt(tokens)} tokens`,
    costTitle: `${formatInt(m?.tokens.input)} tokens de entrada · ${formatInt(m?.tokens.output)} de salida`,
    blocked,
  };
});

// ── Actividad ───────────────────────────────────────────
type FeedFilter = 'all' | 'rule' | 'agent' | 'human' | 'blocked';
const FEED_FILTERS: SegmentedOption<FeedFilter>[] = [
  { value: 'all', label: 'Todo' },
  { value: 'rule', label: 'Reglas' },
  { value: 'agent', label: 'IA' },
  { value: 'human', label: 'Personas' },
  { value: 'blocked', label: 'Bloqueos' },
];
const feedFilter = ref<FeedFilter>('all');

function isBlocked(entry: TimelineEntry) {
  return entry.decision === 'deny' || entry.decision === 'escalate' || entry.kind === 'error';
}
function matchesFeed(item: FeedItem) {
  const { entry } = item;
  switch (feedFilter.value) {
    case 'all':
      return true;
    case 'blocked':
      return isBlocked(entry);
    case 'agent':
      return entry.actor === 'agent' || entry.kind === 'llm';
    default:
      return entry.actor === feedFilter.value;
  }
}

/** Lo que va a la derecha de cada fila: el coste en las llamadas a IA, la decisión en las de política. */
function rowAside(entry: TimelineEntry): { cost?: string; badge?: BadgePresentation } {
  if (entry.kind === 'llm') return { cost: formatUsd(entry.costUsd) };
  if (entry.kind === 'error') return { badge: { variant: 'danger', label: 'Error' } };
  if (entry.kind === 'policy' && entry.decision) return { badge: decisionBadge(entry.decision) };
  return {};
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** El enlace al caso se muestra una vez por tramo de filas seguidas del mismo caso. */
const feed = computed(() =>
  live.feed
    .filter(matchesFeed)
    .slice(0, FEED_VISIBLE)
    .map((item, i, list) => ({
      item,
      opensRun: i === 0 || list[i - 1].caseId !== item.caseId,
      actor: item.entry.actor ? ACTOR_BADGE[item.entry.actor] : null,
      aside: rowAside(item.entry),
      blockedDetail: isBlocked(item.entry) && item.entry.detail ? item.entry.detail : '',
    })),
);

/*
 * Solo se animan las filas que llegan por SSE. Lo que ya estaba al entrar en la vista, o lo que
 * trae una recarga completa (reinicio, reconexión), aparece sin animar.
 */
const NEW_ROW_MS = 1600;
const known = new Set(live.feed.map((item) => item.key));
const fresh = ref(new Set<string>());
const timers = new Set<ReturnType<typeof setTimeout>>();

watch(
  () => [live.feed, live.feed[0]?.key] as const,
  ([list], [previous]) => {
    if (list !== previous) {
      known.clear();
      for (const item of list) known.add(item.key);
      fresh.value = new Set();
      return;
    }
    const arrivals = list.filter((item) => !known.has(item.key)).map((item) => item.key);
    if (!arrivals.length) return;
    for (const key of arrivals) known.add(key);
    fresh.value = new Set([...fresh.value, ...arrivals]);
    const timer = setTimeout(() => {
      timers.delete(timer);
      const rest = new Set(fresh.value);
      for (const key of arrivals) rest.delete(key);
      fresh.value = rest;
    }, NEW_ROW_MS);
    timers.add(timer);
  },
);
onBeforeUnmount(() => {
  for (const timer of timers) clearTimeout(timer);
});

// ── En ejecución ────────────────────────────────────────
const runs = computed(() =>
  live.runs.map((run) => {
    const c = live.cases[run.caseId];
    return {
      run,
      agent: agentName(run.agentId),
      title: c?.title ?? run.caseId,
      last: c?.timeline[c.timeline.length - 1],
    };
  }),
);
const capacity = computed(() => Math.max(MAX_CONCURRENCY, live.runs.length));
const full = computed(() => live.runs.length >= MAX_CONCURRENCY);

// ── Por proyecto ────────────────────────────────────────
const PROJECT_TAB: Record<string, string> = { bugs: 'codigo', flota: 'dispositivo' };

const byProject = computed(() => {
  const data = metrics.value?.byProject ?? {};
  const order = projectOrder();
  return Object.entries(data)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, p]) => ({ id, name: projectName(id), href: `#${PROJECT_TAB[id] ?? id}`, ...p }));
});
const projectTotals = computed(() =>
  byProject.value.reduce(
    (acc, p) => ({ cases: acc.cases + p.cases, resolved: acc.resolved + p.resolved, cost: acc.cost + p.costUsd }),
    { cases: 0, resolved: 0, cost: 0 },
  ),
);
const topSpender = computed(() => {
  const top = [...byProject.value].sort((a, b) => b.costUsd - a.costUsd)[0];
  return top && top.costUsd > 0 ? top.id : '';
});

// ── Avisos ──────────────────────────────────────────────
const notifications = computed(() => [...live.notifications].reverse().slice(0, NOTIFICATIONS_VISIBLE));
const NOTIFICATION_STATUS: Record<Notification['level'], { status: Status; label: string }> = {
  info: { status: 'neutral', label: 'Aviso' },
  warning: { status: 'warning', label: 'Atención' },
  critical: { status: 'danger', label: 'Crítico' },
};
</script>

<template>
  <div class="resumen">
    <PageHeader title="Resumen" description="Qué resuelven las reglas, la IA y las personas, y cuánto cuesta.">
      <template v-if="pendingCount" #actions>
        <Button as="a" href="#aprobaciones" variant="primary">
          {{ pendingCount === 1 ? 'Revisar 1 aprobación' : `Revisar ${pendingCount} aprobaciones` }}
        </Button>
      </template>
    </PageHeader>

    <StatGrid :columns="6" label="Indicadores">
      <Stat label="Casos" :value="stats.cases" :hint="stats.casesHint" />
      <Stat label="Sin intervención humana" :value="stats.auto">
        <template #hint><span :title="stats.autoTitle">{{ stats.autoHint }}</span></template>
      </Stat>
      <Stat
        label="Aprobaciones pendientes"
        :value="formatInt(pendingCount)"
        :tone="pendingCount ? 'warning' : 'default'"
        :hint="pendingCount ? 'Esperan a una persona' : 'Nada en espera'"
      />
      <Stat label="Coste de IA" :value="stats.cost">
        <template #hint><span :title="stats.costTitle">{{ stats.costHint }}</span></template>
      </Stat>
      <Stat
        label="Acciones de reglas / llamadas a IA"
        :value="`${formatInt(workSplit.rule)} / ${formatInt(workSplit.llm)}`"
        hint="Las reglas no tienen coste"
      />
      <Stat
        label="Bloqueos por política"
        :value="formatInt(stats.blocked)"
        :tone="stats.blocked ? 'danger' : 'default'"
        hint="Acciones no ejecutadas"
      />
    </StatGrid>

    <div class="board">
      <!-- Actividad en vivo -->
      <Card class="activity" title="Actividad" :padded="false">
        <template #actions>
          <SegmentedControl v-model="feedFilter" :options="FEED_FILTERS" size="sm" aria-label="Filtrar la actividad" />
        </template>

        <ol
          v-if="feed.length"
          class="activity__list"
          role="log"
          aria-live="polite"
          aria-label="Actividad, lo más reciente primero"
          tabindex="0"
        >
          <li
            v-for="row in feed"
            :key="row.item.key"
            class="activity__row"
            :class="{ 'is-new': fresh.has(row.item.key) }"
          >
            <time class="activity__time" :datetime="row.item.at" :title="fullTime(row.item.at)">{{
              clock(row.item.at)
            }}</time>
            <span class="activity__actor">
              <Badge v-if="row.actor" :variant="row.actor.variant" :label="row.actor.label" />
            </span>
            <div class="activity__body">
              <p class="activity__title" :title="row.item.entry.title">{{ sinPartir(row.item.entry.title) }}</p>
              <p v-if="row.blockedDetail" class="activity__detail" :title="row.blockedDetail">
                {{ excerpt(row.blockedDetail, 140) }}
              </p>
              <CaseLink
                v-if="row.opensRun"
                class="activity__case"
                :case-id="row.item.caseId"
                :label="sinPartir(`${projectName(row.item.project)} · ${row.item.caseTitle}`)"
              />
            </div>
            <span class="activity__aside">
              <span v-if="row.aside.cost" class="activity__cost">{{ row.aside.cost }}</span>
              <Badge v-else-if="row.aside.badge" :variant="row.aside.badge.variant" :label="row.aside.badge.label" />
            </span>
          </li>
        </ol>
        <div v-else class="activity__empty">
          <ScenarioEmptyState
            v-if="!live.feed.length"
            compact
            title="Todavía no hay actividad."
            hint="Lanza un escenario desde el director de demo."
            :scenarios="['Datáfono bloqueado']"
          />
          <EmptyState v-else compact title="No hay actividad de este tipo." />
        </div>
      </Card>

      <div class="side">
        <!-- En ejecución -->
        <Card title="En ejecución">
          <template #actions>
            <span class="capacity" :class="{ 'is-full': full }">
              <span class="capacity__meter" aria-hidden="true">
                <span v-for="n in capacity" :key="n" class="capacity__slot" :class="{ 'is-on': n <= runs.length }"></span>
              </span>
              <span class="capacity__text">{{ runs.length }} de {{ MAX_CONCURRENCY }}</span>
            </span>
          </template>

          <ul v-if="runs.length" class="runs">
            <li v-for="r in runs" :key="`${r.run.caseId}:${r.run.agentId}`" class="run">
              <div class="run__head">
                <StatusDot status="pending" :label="r.agent" class="run__agent" />
                <span class="run__elapsed" :title="`Desde ${fullTime(r.run.startedAt)}`">{{
                  elapsedSince(r.run.startedAt, now)
                }}</span>
              </div>
              <div class="run__body">
                <CaseLink class="run__case" :case-id="r.run.caseId" :label="sinPartir(r.title)" />
                <p v-if="r.last" class="run__step" :title="r.last.title">{{ r.last.title }}</p>
              </div>
            </li>
          </ul>
          <EmptyState v-else compact title="Ningún agente trabajando." />
        </Card>

        <!-- Por proyecto -->
        <Card title="Por proyecto" :padded="false">
          <table v-if="byProject.length" class="table projects">
            <thead>
              <tr>
                <th scope="col">Proyecto</th>
                <th scope="col" class="num">Casos</th>
                <th scope="col" class="num">Resueltos</th>
                <th scope="col" class="num">Coste</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in byProject" :key="p.id">
                <td><a :href="p.href" class="projects__link">{{ p.name }}</a></td>
                <td class="num">{{ formatInt(p.cases) }}</td>
                <td class="num">{{ formatInt(p.resolved) }}</td>
                <td
                  class="num"
                  :class="{ 'projects__top': p.id === topSpender }"
                  :title="p.id === topSpender ? 'Proyecto con más coste de IA' : undefined"
                >
                  {{ formatUsd(p.costUsd) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="num">{{ formatInt(projectTotals.cases) }}</td>
                <td class="num">{{ formatInt(projectTotals.resolved) }}</td>
                <td class="num">{{ formatUsd(projectTotals.cost) }}</td>
              </tr>
            </tfoot>
          </table>
          <div v-else class="projects__empty">
            <EmptyState compact title="Sin casos todavía." />
          </div>
        </Card>

        <!-- Avisos -->
        <Card title="Avisos" :padded="false">
          <ul v-if="notifications.length" class="notices">
            <li v-for="n in notifications" :key="n.id" class="notice">
              <div class="notice__head">
                <StatusDot :status="NOTIFICATION_STATUS[n.level].status" class="notice__title">
                  <span class="sr-only">{{ NOTIFICATION_STATUS[n.level].label }}: </span>{{ sinPartir(n.title) }}
                </StatusDot>
                <RelativeTime :at="n.at" class="notice__time" />
              </div>
              <p v-if="n.detail" class="notice__detail" :title="n.detail">{{ n.detail }}</p>
              <CaseLink v-if="n.caseId" class="notice__case" :case-id="n.caseId" label="Ver caso" />
            </li>
          </ul>
          <div v-else class="notices__empty">
            <EmptyState compact title="Sin avisos." />
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resumen {
  container: resumen / inline-size;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

/* ── Actividad a la izquierda, lateral a la derecha ───── */
.board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
/* Por debajo, la actividad ocupa el ancho y el lateral se reparte en columnas sin huecos. */
@container resumen (max-width: 879px) {
  .board {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: block;
    columns: 2 300px;
    column-gap: 24px;
    margin-bottom: -24px;
  }
  .side > * {
    break-inside: avoid;
    margin-bottom: 24px;
  }
}

/* ── Actividad ─────────────────────────────────────────── */
.activity {
  container: actividad / inline-size;
}
/* En tarjetas estrechas, los filtros bajan bajo el título en lugar de desbordar. */
@container actividad (max-width: 459px) {
  .activity :deep(.card__header) {
    flex-direction: column;
    gap: 12px;
  }
  .activity :deep(.card__actions) {
    height: auto;
    max-width: 100%;
  }
}

.activity__list {
  max-height: 640px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.activity__list:focus-visible {
  outline-offset: -2px;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.activity__row {
  display: grid;
  grid-template-columns: 64px 60px minmax(0, 1fr) auto;
  grid-template-areas: 'time actor body aside';
  column-gap: 12px;
  align-items: start;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  line-height: 20px;
}
.activity__row:last-child {
  border-bottom: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .activity__row.is-new {
    animation: row-in 1.2s var(--ease) both;
  }
}
@keyframes row-in {
  0% {
    opacity: 0;
    transform: translateY(-4px);
    background-color: var(--bg-muted);
  }
  20% {
    opacity: 1;
    transform: none;
    background-color: var(--bg-muted);
  }
  100% {
    background-color: transparent;
  }
}

.activity__time {
  grid-area: time;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.activity__actor {
  grid-area: actor;
  display: flex;
  min-height: 20px;
}
.activity__body {
  grid-area: body;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.activity__title {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.activity__detail {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.activity__body .activity__case {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.activity__aside {
  grid-area: aside;
  display: flex;
  justify-content: flex-end;
  min-height: 20px;
}
.activity__cost {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.activity__empty {
  padding: 16px;
}

@container actividad (max-width: 519px) {
  .activity__row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'time actor aside'
      'body body body';
    row-gap: 4px;
  }
}

/* ── En ejecución ──────────────────────────────────────── */
.capacity {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.capacity.is-full {
  font-weight: 500;
  color: var(--fg);
}
.capacity__meter {
  display: inline-flex;
  gap: 2px;
}
.capacity__slot {
  width: 12px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
}
.capacity__slot.is-on {
  background: var(--fg);
}

.runs {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.run + .run {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.run__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.run__head .run__agent {
  font-size: var(--text-base);
  font-weight: 500;
}
.run__elapsed {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* Alineado con el texto del agente: punto de 8px más 8px de hueco. */
.run__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding-left: 16px;
  font-size: var(--text-sm);
  line-height: 20px;
}
.run__step {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}

/* ── Por proyecto ──────────────────────────────────────── */
.projects th,
.projects td {
  padding-left: 8px;
  padding-right: 8px;
}
.projects tfoot th,
.projects tfoot td {
  padding-top: 9px;
  padding-bottom: 9px;
  border-top: 1px solid var(--border);
  border-bottom: 0;
  background: transparent;
  font-weight: 500;
  color: var(--fg);
  text-align: left;
}
.projects tfoot td.num {
  text-align: right;
}
.projects__link {
  text-decoration-color: var(--border-strong);
}
.projects__top {
  font-weight: 600;
}
.projects__empty,
.notices__empty {
  padding: 16px;
}

/* ── Avisos ────────────────────────────────────────────── */
.notices {
  margin: 0;
  padding: 0;
  list-style: none;
}
.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  line-height: 20px;
}
.notice:last-child {
  border-bottom: 0;
}
.notice__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.notice__head .notice__title {
  font-weight: 500;
}
.notice__time {
  flex: none;
  font-size: var(--text-xs);
  line-height: 20px;
}
.notice__detail,
.notice__case {
  margin-left: 16px;
}
.notice__detail {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.notice .notice__case {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
</style>
