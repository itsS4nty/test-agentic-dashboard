<script setup lang="ts">
/**
 * Un paso de la traza de un caso, sobre `TimelineItem` (se usa dentro de `Timeline`).
 * - Marcador: rojo si bloquea, escala, falla o da error; ámbar si pide aprobación; verde si
 *   resuelve o se aprueba; gris en el resto.
 * - A la derecha, el actor (`Badge` Regla · IA · Persona) y la hora.
 * - Meta: en llamadas a IA, agente, modelo, tokens, coste y latencia; en acciones y políticas,
 *   la acción, la decisión y si se ejecutó.
 * - Detalle: el texto del paso y, plegados en «Detalles», la salida completa y los datos.
 */
import { computed } from 'vue';
import type { TimelineEntry } from '../../../platform/contracts.ts';
import Badge from '../ui/Badge.vue';
import CodeBlock from '../ui/CodeBlock.vue';
import TimelineItem from '../ui/TimelineItem.vue';
import { ACTOR_BADGE, decisionBadge } from '../ui/status.ts';
import type { Status } from '../ui/types.ts';
import { agentName } from './catalog.ts';
import { excerpt, formatInt, formatLatency, formatUsd, sinPartir, toJson } from './format.ts';

const props = defineProps<{ entry: TimelineEntry }>();

const OUTPUT_EXCERPT = 160;

const marker = computed<{ status: Status; label?: string }>(() => {
  const e = props.entry;
  if (e.kind === 'error') return { status: 'danger', label: 'Error' };
  if (e.decision === 'deny') return { status: 'danger', label: 'Bloqueado' };
  if (e.decision === 'escalate') return { status: 'danger', label: 'Escalado' };
  if (e.kind === 'tool' && e.data?.ok === false) return { status: 'danger', label: 'Falló' };
  if (e.kind === 'policy' && e.decision === 'approve') return { status: 'warning', label: 'Pendiente de aprobación' };
  if (e.kind === 'approval') {
    return e.data?.decision === 'approved'
      ? { status: 'success', label: 'Aprobado' }
      : { status: 'neutral', label: 'Rechazado' };
  }
  if (e.kind === 'status') {
    if (/^Resuelto/.test(e.title)) return { status: 'success', label: 'Resuelto' };
    if (/^Escalado/.test(e.title)) return { status: 'danger', label: 'Escalado' };
  }
  return { status: 'neutral' };
});

const actor = computed(() => (props.entry.actor ? ACTOR_BADGE[props.entry.actor] : null));
const isLlm = computed(() => props.entry.kind === 'llm');

const tokens = computed(() => {
  const { inputTokens, outputTokens } = props.entry;
  if (inputTokens == null && outputTokens == null) return null;
  return {
    total: `${formatInt((inputTokens ?? 0) + (outputTokens ?? 0))} tokens`,
    title: `${formatInt(inputTokens)} de entrada · ${formatInt(outputTokens)} de salida`,
  };
});

/** Acción, decisión y ejecución: solo en pasos que pasan por la política. */
const policy = computed(() => {
  const e = props.entry;
  if (isLlm.value) return null;
  const withDecision = !!e.decision || e.kind === 'policy';
  return {
    tool: e.tool,
    decision: withDecision && e.decision ? decisionBadge(e.decision) : null,
    executed: withDecision ? e.executed : undefined,
  };
});

const hasMeta = computed(() => {
  if (isLlm.value) return true;
  const p = policy.value;
  return !!p && (!!p.tool || !!p.decision || p.executed !== undefined);
});

const text = computed(() => {
  const { detail, kind } = props.entry;
  if (!detail) return '';
  return kind === 'tool' ? excerpt(detail, OUTPUT_EXCERPT) : detail;
});
const longOutput = computed(() => props.entry.kind === 'tool' && (props.entry.detail ?? '').length > OUTPUT_EXCERPT);
const hasData = computed(() => !!props.entry.data && Object.keys(props.entry.data).length > 0);
const hasDetail = computed(() => !!text.value || longOutput.value || hasData.value);
</script>

<template>
  <TimelineItem
    :status="marker.status"
    :status-label="marker.label"
    :title="sinPartir(entry.title)"
    :time="entry.at"
  >
    <template v-if="actor" #aside>
      <Badge :variant="actor.variant" :label="actor.label" />
    </template>

    <template v-if="hasMeta" #meta>
      <template v-if="isLlm">
        <span v-if="entry.agentId">{{ agentName(entry.agentId) }}</span>
        <span v-if="entry.model" class="trace__mono">{{ entry.model }}</span>
        <span v-if="tokens" :title="tokens.title">{{ tokens.total }}</span>
        <span v-if="entry.costUsd != null">{{ formatUsd(entry.costUsd) }}</span>
        <span v-if="entry.latencyMs != null">{{ formatLatency(entry.latencyMs) }}</span>
      </template>
      <template v-else-if="policy">
        <span v-if="policy.tool" class="trace__mono">{{ policy.tool }}</span>
        <Badge v-if="policy.decision" :variant="policy.decision.variant" :label="policy.decision.label" />
        <span v-if="policy.executed === true">Ejecutada</span>
        <span v-else-if="policy.executed === false" class="trace__not-executed">No ejecutada</span>
      </template>
    </template>

    <template v-if="hasDetail" #default>
      <p v-if="text" class="trace__text">{{ text }}</p>
      <details v-if="longOutput || hasData" class="fold">
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
          Detalles
        </summary>
        <div class="fold__body">
          <CodeBlock v-if="longOutput" :code="entry.detail ?? ''" label="Salida" max-height="240px" wrap />
          <CodeBlock v-if="hasData" :code="toJson(entry.data)" label="Datos" max-height="240px" />
        </div>
      </details>
    </template>
  </TimelineItem>
</template>

<style scoped>
.trace__mono {
  font-family: var(--font-mono);
  color: var(--fg-muted);
}
.trace__not-executed {
  font-weight: 500;
  color: var(--fg);
}

.trace__text {
  white-space: pre-wrap;
  text-wrap: pretty;
}

.fold {
  margin-top: 4px;
}
.fold__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
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
.fold__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
