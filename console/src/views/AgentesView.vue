<script setup lang="ts">
/**
 * Agentes (docs/DESIGN.md § 6): una tarjeta por agente con sus datos (proyecto, modelo, esfuerzo,
 * turnos, presupuesto, responsable y actividad), sus herramientas con el nivel del dial y, plegados,
 * el manifiesto YAML y las instrucciones. Debajo, las reglas deterministas.
 */
import { computed, onMounted, ref } from 'vue';
import type { AgentManifest, Effort, ModelTier } from '../../../platform/contracts.ts';
import { live } from '../live.ts';
import { catalog, defaultLevel, loadAgents, loadPolicies, projectName, projectOrder } from '../components/catalog.ts';
import { LEVEL_HINT, formatInt, formatUsd } from '../components/format.ts';
import {
  Badge,
  Card,
  CodeBlock,
  EmptyState,
  KeyValue,
  PageHeader,
  StatusDot,
  decisionBadge,
  type BadgeVariant,
  type KeyValueItem,
} from '../ui/index.ts';
import LoadState from './project/LoadState.vue';

const loaded = ref(false);

onMounted(() => {
  void loadAgents().finally(() => (loaded.value = true));
  void loadPolicies();
});

const TIER_LABEL: Record<ModelTier, string> = { reasoning: 'Razonamiento', fast: 'Rápido' };
const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo',
};

const agents = computed(() => {
  const order = projectOrder();
  return [...catalog.agents].sort(
    (a, b) => order.indexOf(a.project) - order.indexOf(b.project) || a.name.localeCompare(b.name),
  );
});

const rules = computed(() => {
  const order = projectOrder();
  return [...catalog.rules].sort((a, b) => order.indexOf(a.project) - order.indexOf(b.project));
});

function activity(agent: AgentManifest) {
  const cases = Object.values(live.cases).filter((c) => c.agentId === agent.id);
  return {
    cases: cases.length,
    running: live.runs.some((r) => r.agentId === agent.id),
    costUsd: cases.reduce((sum, c) => sum + (c.costUsd ?? 0), 0),
  };
}

function modelFor(agent: AgentManifest): string {
  return live.status?.models[agent.tier] ?? '';
}

function fields(agent: AgentManifest): KeyValueItem[] {
  const { cases, costUsd } = activity(agent);
  return [
    { label: 'Proyecto', value: projectName(agent.project) },
    { label: 'Modelo', slot: 'modelo' },
    { label: 'Esfuerzo', value: agent.effort ? (EFFORT_LABEL[agent.effort] ?? agent.effort) : null },
    { label: 'Turnos máx.', value: formatInt(agent.maxTurns) },
    {
      label: 'Presupuesto',
      value: `${formatUsd(agent.budget.usdPerCase)} · ${formatInt(agent.budget.tokensPerCase)} tokens por caso`,
    },
    ...(agent.owner ? [{ label: 'Responsable', value: agent.owner }] : []),
    { label: 'Actividad', value: `${formatInt(cases)} ${cases === 1 ? 'caso' : 'casos'} · ${formatUsd(costUsd)}` },
  ];
}

interface ToolRow {
  tool: string;
  badge?: { variant: BadgeVariant; label: string; title: string };
}

/** Cada herramienta con su techo en el dial (el configurado o el de por defecto). */
function tools(agent: AgentManifest): ToolRow[] {
  return agent.tools.map((tool) => {
    if (!catalog.policies) return { tool };
    const { level, configured } = defaultLevel(tool);
    const { variant, label } = decisionBadge(level);
    return { tool, badge: { variant, label, title: configured ? LEVEL_HINT[level] : `${LEVEL_HINT[level]} (nivel por defecto)` } };
  });
}
</script>

<template>
  <div class="page">
    <PageHeader title="Agentes" description="Cada agente es un fichero YAML." />

    <LoadState
      :loading="!loaded && !catalog.agents.length"
      :error="catalog.agentsError || null"
      :has-data="catalog.agents.length > 0"
      what="los agentes"
    />

    <EmptyState v-if="loaded && !catalog.agents.length && !catalog.agentsError" title="Sin agentes">
      <template #description>El servidor no ha leído ningún <code>agents/*/agent.yaml</code>.</template>
    </EmptyState>

    <ul v-if="agents.length" class="agents" role="list">
      <li v-for="agent in agents" :key="agent.id" class="agents__item">
        <Card as="article" class="agent" :aria-labelledby="`agente-${agent.id}`">
          <template #header>
            <h2 :id="`agente-${agent.id}`" class="agent__name">{{ agent.name }}</h2>
            <p class="agent__description" :title="agent.description">{{ agent.description }}</p>
          </template>
          <template #actions>
            <StatusDot v-if="activity(agent).running" class="agent__running" status="pending" label="Trabajando" />
            <Badge mono :label="`v${agent.version}`" :title="`Versión ${agent.version} del manifiesto`" />
          </template>

          <div class="agent__body">
            <KeyValue :items="fields(agent)">
              <template #modelo>
                {{ TIER_LABEL[agent.tier] ?? agent.tier }}<template v-if="modelFor(agent)">
                  <span class="agent__sep" aria-hidden="true"> · </span>
                  <span class="agent__model">{{ modelFor(agent) }}</span>
                </template>
              </template>
            </KeyValue>

            <section class="tools" :aria-labelledby="`herramientas-${agent.id}`">
              <h3 :id="`herramientas-${agent.id}`" class="tools__title">
                Herramientas <span class="tools__count">{{ agent.tools.length }}</span>
              </h3>
              <ul class="tools__list" role="list">
                <li v-for="row in tools(agent)" :key="row.tool" class="tools__row">
                  <code class="tools__name">{{ row.tool }}</code>
                  <Badge v-if="row.badge" :variant="row.badge.variant" :label="row.badge.label" :title="row.badge.title" />
                </li>
              </ul>
            </section>

            <div class="folds">
              <details class="fold">
                <summary class="fold__summary">
                  <svg class="fold__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                    <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <span class="fold__label">Manifiesto YAML</span>
                  <span class="fold__path">{{ agent.manifestPath }}</span>
                </summary>
                <div class="fold__content">
                  <CodeBlock :code="agent.manifestYaml" :label="agent.manifestPath" max-height="320px" />
                </div>
              </details>
              <details class="fold">
                <summary class="fold__summary">
                  <svg class="fold__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                    <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <span class="fold__label">Instrucciones</span>
                  <span class="fold__path">prompt.md</span>
                </summary>
                <div class="fold__content">
                  <CodeBlock :code="agent.prompt" label="prompt.md" max-height="320px" wrap />
                </div>
              </details>
            </div>
          </div>
        </Card>
      </li>
    </ul>

    <Card
      v-if="rules.length"
      title="Reglas deterministas"
      description="Resuelven lo repetitivo antes de llamar a la IA, con coste 0."
      :padded="false"
    >
      <table class="table rules">
        <thead>
          <tr>
            <th scope="col">Regla</th>
            <th scope="col">Proyecto</th>
            <th scope="col">Se activa con</th>
            <th scope="col">Qué hace</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td class="rules__nowrap"><code class="rules__id">{{ rule.id }}</code></td>
            <td class="rules__nowrap">{{ projectName(rule.project) }}</td>
            <td class="rules__nowrap"><code class="rules__event">{{ rule.on }}</code></td>
            <td class="rules__description" :title="rule.description"><span class="rules__clamp">{{ rule.description }}</span></td>
          </tr>
        </tbody>
      </table>
    </Card>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}

/* ── Rejilla de agentes ────────────────────────────────── */
.agents {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.agents__item {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.agent {
  flex: 1;
}

.agent__name {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
  letter-spacing: -0.005em;
  color: var(--fg);
}
.agent__description {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  text-wrap: pretty;
}
.agent__running {
  font-size: var(--text-sm);
  white-space: nowrap;
}

/* El cuerpo ocupa todo el alto de la tarjeta: los plegables quedan abajo y alineados entre tarjetas. */
.agent__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  min-width: 0;
}
.agent__sep {
  color: var(--fg-subtle);
}
.agent__model {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

/* ── Herramientas ──────────────────────────────────────── */
.tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tools__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
}
.tools__count {
  margin-left: 4px;
  font-weight: 400;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.tools__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tools__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.tools__name {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}

/* ── Plegables ─────────────────────────────────────────── */
.folds {
  margin: auto -16px -16px;
  border-top: 1px solid var(--border);
}
.fold + .fold {
  border-top: 1px solid var(--border);
}
.fold__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 10px 16px;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.fold__summary::-webkit-details-marker {
  display: none;
}
.fold__summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}
.fold__chevron {
  flex: none;
  color: var(--fg-subtle);
  transition:
    transform 150ms var(--ease),
    color 150ms var(--ease);
}
.fold__summary:hover .fold__chevron {
  color: var(--fg);
}
.fold[open] .fold__chevron {
  transform: rotate(90deg);
}
.fold__label {
  flex: none;
}
.fold__path {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--fg-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Abierto, la ruta ya figura en la barra del bloque de código. */
.fold[open] .fold__path {
  visibility: hidden;
}
.fold__content {
  padding: 0 16px 16px;
}

/* ── Reglas ────────────────────────────────────────────── */
.rules td {
  line-height: 20px;
  vertical-align: top;
}
.rules__nowrap {
  white-space: nowrap;
}
.rules__id,
.rules__event {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.rules__id {
  color: var(--fg);
}
.rules__event {
  color: var(--fg-muted);
}
.rules__description {
  min-width: 280px;
  color: var(--fg-muted);
  text-wrap: pretty;
}
/* Dos líneas; la descripción completa queda en el title de la celda. */
.rules__clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
</style>
