<script setup lang="ts">
/**
 * Aprobación (docs/DESIGN.md § 6). Tarjeta con lo que se pide: resumen, acción, ámbito, quién lo
 * propone, riesgo y caso; el motivo; la entrada JSON plegada; y la decisión (comentario opcional,
 * Rechazar y Aprobar). Tras decidir, el pie muestra el estado final con StatusDot, quién decidió,
 * cuándo, el comentario y el resultado.
 * API conservada: props `approval` y `showCaseLink` (true); sin eventos.
 */
import { computed, nextTick, ref, useId } from 'vue';
import type { Approval } from '../../../platform/contracts.ts';
import { api } from '../api.ts';
import { live } from '../live.ts';
import {
  ACTOR_BADGE,
  APPROVAL_STATUS,
  Badge,
  Button,
  Card,
  CodeBlock,
  KeyValue,
  RelativeTime,
  StatusDot,
  riskPresentation,
  type KeyValueItem,
  type StatusPresentation,
} from '../ui/index.ts';
import CaseLink from '../views/project/CaseLink.vue';
import { agentName, describeScope, projectName } from './catalog.ts';
import { errorMessage, excerpt, sinPartir, toJson } from './format.ts';

const props = withDefaults(defineProps<{ approval: Approval; showCaseLink?: boolean }>(), { showCaseLink: true });

const comment = ref('');
const busy = ref<'' | 'approved' | 'rejected'>('');
const error = ref('');

const root = ref<{ $el: HTMLElement } | null>(null);
const decision = ref<HTMLElement | null>(null);
const titleId = `aprobacion-${useId()}`;

const pending = computed(() => props.approval.status === 'pending');
const caseTitle = computed(() => live.cases[props.approval.caseId]?.title);
const actor = computed(() => ACTOR_BADGE[props.approval.actor]);
const risk = computed(() => riskPresentation(props.approval.risk));
const inputJson = computed(() => toJson(props.approval.input));

const fields = computed<KeyValueItem[]>(() => [
  { label: 'Acción', value: props.approval.tool, mono: true },
  { label: 'Ámbito', value: describeScope(props.approval.scope) },
  { label: 'Propone', slot: 'propone' },
  { label: 'Riesgo', slot: 'riesgo' },
  ...(props.showCaseLink ? [{ label: 'Caso', slot: 'caso' }] : []),
]);

// ── Resultado ───────────────────────────────────────────

const executing = computed(() => busy.value === 'approved' && props.approval.status === 'approved');
const failed = computed(
  () => props.approval.status === 'failed' || (!!props.approval.result && !props.approval.result.ok),
);

const outcome = computed<StatusPresentation>(() => {
  if (executing.value) return { status: 'pending', label: 'Aprobada · ejecutando…' };
  const base = APPROVAL_STATUS[props.approval.status];
  return failed.value ? { status: 'danger', label: base.label } : base;
});

const detail = computed(() => {
  const a = props.approval;
  if (a.result) return excerpt(a.result.content, 220);
  if (a.status === 'rejected') return 'No se ejecutó';
  return '';
});

// ── Decidir ─────────────────────────────────────────────

async function decide(choice: 'approved' | 'rejected') {
  if (busy.value) return;
  busy.value = choice;
  error.value = '';
  try {
    const updated = await api.decide(props.approval.id, choice, comment.value.trim() || undefined);
    live.approvals[updated.id] = updated;
    await nextTick();
    // Los botones desaparecen al decidir: el foco pasa al resultado si no se ha ido a otra parte.
    const active = document.activeElement;
    const card = root.value?.$el;
    if (!active || active === document.body || card?.contains(active)) {
      decision.value?.focus({ preventScroll: true });
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <Card ref="root" as="article" class="approval" :heading-level="3" :aria-labelledby="titleId">
    <template #header>
      <h3 :id="titleId" class="approval__title">{{ sinPartir(approval.summary) }}</h3>
      <p class="approval__meta">
        {{ projectName(approval.project) }}
        <span aria-hidden="true">·</span>
        <span class="approval__id">{{ approval.id }}</span>
      </p>
    </template>
    <template #actions>
      <RelativeTime :at="approval.createdAt" class="approval__time" />
    </template>

    <div class="approval__body">
      <KeyValue :items="fields">
        <template #propone>
          <span class="approval__proposer">
            <Badge :variant="actor.variant" :label="actor.label" />
            <span v-if="approval.actor === 'agent'">{{ agentName(approval.agentId) }}</span>
          </span>
        </template>
        <template #riesgo>
          <Badge v-if="risk.badge" variant="outline" :label="risk.label" />
          <span v-else class="approval__muted">{{ risk.label }}</span>
        </template>
        <template #caso>
          <CaseLink
            :case-id="approval.caseId"
            :label="caseTitle"
            v-bind="caseTitle ? { title: `Abrir el caso «${caseTitle}»` } : {}"
          />
        </template>
      </KeyValue>

      <p v-if="approval.reason" class="approval__reason">{{ approval.reason }}</p>

      <details v-if="inputJson" class="fold">
        <summary class="fold__summary">
          <svg class="fold__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Entrada de la acción (JSON)
        </summary>
        <CodeBlock class="fold__code" :code="inputJson" max-height="200px" wrap />
      </details>
    </div>

    <template #footer>
      <div class="approval__footer">
        <div
          ref="decision"
          class="approval__decision"
          tabindex="-1"
          role="group"
          :aria-label="pending ? 'Decisión' : 'Decisión registrada'"
          aria-live="polite"
        >
          <form v-if="pending" class="approval__form" @submit.prevent>
            <input
              v-model="comment"
              class="approval__comment"
              type="text"
              placeholder="Comentario (opcional)"
              aria-label="Comentario para la decisión"
              :disabled="!!busy"
            />
            <div class="approval__buttons">
              <Button :loading="busy === 'rejected'" :disabled="busy === 'approved'" @click="decide('rejected')">
                Rechazar
              </Button>
              <Button variant="primary" :loading="busy === 'approved'" :disabled="busy === 'rejected'" @click="decide('approved')">
                Aprobar
              </Button>
            </div>
          </form>

          <div v-else class="approval__outcome">
            <p class="approval__outcome-head">
              <StatusDot class="approval__status" :status="outcome.status" :label="outcome.label" />
              <span class="approval__by">
                <span aria-hidden="true">·</span>
                {{ approval.decidedBy ?? 'Consola' }}
              </span>
              <RelativeTime :at="approval.decidedAt" class="approval__decided-at" />
            </p>
            <p v-if="approval.comment" class="approval__line">«{{ approval.comment }}»</p>
            <p v-if="detail" class="approval__line" :class="{ 'is-danger': failed }">{{ detail }}</p>
          </div>
        </div>

        <p v-if="error" class="approval__error" role="alert">
          <StatusDot status="danger" :label="`No se pudo registrar la decisión: ${error}`" />
        </p>
      </div>
    </template>
  </Card>
</template>

<style scoped>
/* ── Cabecera ──────────────────────────────────────────── */
.approval__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
  letter-spacing: -0.005em;
  color: var(--fg);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.approval__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 6px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.approval__id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.approval__time {
  font-size: var(--text-sm);
  line-height: 20px;
}

/* ── Cuerpo ────────────────────────────────────────────── */
.approval__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.approval__proposer {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
  vertical-align: top;
}
.approval__muted {
  color: var(--fg-muted);
}
.approval__reason {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

/* ── Plegable ──────────────────────────────────────────── */
.fold__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
  list-style: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  user-select: none;
  transition: color 150ms var(--ease);
}
.fold__summary::-webkit-details-marker {
  display: none;
}
.fold__summary:hover {
  color: var(--fg);
}
.fold__summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
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

/* ── Pie: decisión ─────────────────────────────────────── */
.approval__footer {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.approval__decision {
  min-width: 0;
  border-radius: var(--radius-sm);
}
.approval__decision:focus {
  outline: none;
}
.approval__decision:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.approval__form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.approval__comment {
  flex: 1 1 200px;
  min-width: 0;
}
.approval__comment:disabled {
  color: var(--fg-subtle);
  background: var(--bg-muted);
  cursor: not-allowed;
}
.approval__buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.approval__outcome {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 20px;
}
.approval__outcome-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0 6px;
}
.approval__status {
  font-weight: 500;
}
.approval__by {
  display: inline-flex;
  gap: 6px;
  color: var(--fg-muted);
}
.approval__decided-at {
  margin-left: auto;
}
.approval__line {
  padding-left: 16px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.approval__line.is-danger {
  color: var(--danger);
}

.approval__error {
  font-size: var(--text-sm);
  color: var(--danger);
}

@media (max-width: 479px) {
  .approval__buttons {
    flex: 1 1 100%;
  }
  .approval__buttons > * {
    flex: 1 1 0;
  }
}
</style>
