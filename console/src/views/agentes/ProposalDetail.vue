<script setup lang="ts">
/**
 * Detalle de una propuesta de agente: estado de la solicitud y, si ya hay PR, rama, enlace a
 * GitHub, aprobación pendiente, activación tras fusionar, ficheros, variables de entorno nuevas,
 * pasos de validación (salida plegable) y diff contra la rama base.
 */
import { computed } from 'vue';
import type { Approval } from '../../../../platform/contracts.ts';
import { agentName } from '../../components/catalog.ts';
import { ACTOR_BADGE, Badge, Button, CodeBlock, KeyValue, StatusDot, type KeyValueItem } from '../../ui/index.ts';
import CaseLink from '../project/CaseLink.vue';
import DiffBlock from '../project/DiffBlock.vue';
import { fmtDateTime, plural } from '../project/format.ts';
import { FILE_STATUS, REQUEST_STATUS, type Proposal } from './presentation.ts';

const props = defineProps<{
  proposal: Proposal;
  baseBranch: string;
  /** Aprobación pendiente de la fusión, si la hay. */
  approval?: Approval;
}>();

const request = computed(() => props.proposal.request);
const pr = computed(() => props.proposal.pr);
const state = computed(() => REQUEST_STATUS[request.value.status] ?? { status: 'neutral' as const, label: request.value.status });
const title = computed(() => pr.value?.title ?? request.value.name);
const headingId = computed(() => `propuesta-${request.value.id}`);

const items = computed<KeyValueItem[]>(() => {
  const r = request.value;
  const p = pr.value;
  const out: KeyValueItem[] = [
    { label: 'Agente', value: r.agentId || p?.agentId || '—', mono: true },
    { label: 'Caso', slot: 'case' },
    { label: 'Escrito por', slot: 'author' },
    { label: 'Solicitado', value: fmtDateTime(r.createdAt) },
  ];
  if (p) out.push({ label: 'Pull request', value: p.github ? `${p.id} · #${p.github.number}` : p.id, mono: true });
  if (p?.mergedAt) out.push({ label: 'Fusionado', value: fmtDateTime(p.mergedAt) });
  if (p?.github) out.push({ label: 'GitHub', slot: 'github' });
  if (props.approval) out.push({ label: 'Aprobación', value: props.approval.id, mono: true });
  return out;
});

/** Nombre del agente creador tal como lo publica su manifiesto. */
const creatorName = computed(() => {
  const name = agentName('creador');
  return name === 'creador' ? 'Agente creador' : name;
});

const addedFiles = computed(() => pr.value?.files.filter((f) => f.status === 'added').length ?? 0);
const validationOk = computed(() => pr.value?.validation.ok ?? false);
</script>

<template>
  <article class="detail" :aria-labelledby="headingId">
    <header class="detail__header">
      <div class="detail__heading">
        <h3 :id="headingId" class="detail__title">{{ title }}</h3>
        <StatusDot class="detail__status" :status="state.status" :label="state.label" />
      </div>
      <p v-if="pr" class="detail__branch">
        <code>{{ pr.branch }}</code>
        <span class="detail__into" aria-hidden="true">→</span><span class="sr-only">hacia</span>
        <code>{{ baseBranch }}</code>
      </p>
      <KeyValue class="detail__meta" layout="stacked" :items="items">
        <template #case><CaseLink :case-id="request.caseId" /></template>
        <template #author>
          <span class="author">
            <Badge :variant="ACTOR_BADGE.agent.variant" :label="ACTOR_BADGE.agent.label" />
            {{ creatorName }}
          </span>
        </template>
        <template #github>
          <a
            v-if="pr?.github"
            class="gh-link"
            :href="pr.github.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="`Pull request #${pr.github.number} en GitHub`"
          >Ver en GitHub <span class="gh-link__arrow" aria-hidden="true">↗</span></a>
        </template>
      </KeyValue>
    </header>

    <!-- Qué pasa ahora, en una línea. -->
    <div v-if="request.status === 'failed'" class="callout callout--danger" role="status">
      <StatusDot status="danger">
        No se pudo preparar el agente.
        <span v-if="request.error" class="callout__muted">{{ request.error }}</span>
      </StatusDot>
    </div>
    <div v-else-if="request.status === 'queued'" class="callout" role="status">
      <StatusDot status="neutral">
        En cola. <span class="callout__muted">El agente creador empezará en cuanto quede un hueco.</span>
      </StatusDot>
    </div>
    <div v-else-if="request.status === 'working' && !pr" class="callout" role="status">
      <StatusDot status="pending">
        La IA está escribiendo el agente. <span class="callout__muted">Sigue la traza en el caso.</span>
      </StatusDot>
      <CaseLink :case-id="request.caseId" label="Ver caso" />
    </div>
    <template v-else-if="pr">
      <div v-if="pr.status === 'open' && pr.github" class="callout" role="status">
        <StatusDot status="warning">
          PR abierto en GitHub. <span class="callout__muted">Revísalo y fusiónalo allí; el agente se activa solo al detectarlo.</span>
        </StatusDot>
        <Button as="a" :href="pr.github.url" target="_blank" rel="noopener" variant="primary" size="sm">Abrir en GitHub</Button>
      </div>
      <div v-else-if="pr.status === 'open'" class="callout" role="status">
        <StatusDot status="neutral">
          PR abierto en local. <span class="callout__muted">Lo fusiona una persona; sin GitHub conectado, no hay dónde hacerlo.</span>
        </StatusDot>
      </div>
      <div v-else-if="pr.status === 'merged' && pr.activation?.state === 'active'" class="callout" role="status">
        <StatusDot status="success">
          Activo: ya aparece en Agentes y en El dial.
          <span v-if="pr.activation.detail" class="callout__muted">{{ pr.activation.detail }}</span>
        </StatusDot>
      </div>
      <div v-else-if="pr.status === 'merged' && pr.activation?.state === 'restart_required'" class="callout" role="status">
        <StatusDot status="warning">
          Reinicia el servidor para activarlo.
          <span v-if="pr.activation.detail" class="callout__muted">{{ pr.activation.detail }}</span>
        </StatusDot>
      </div>
      <div v-else-if="pr.status === 'merged'" class="callout" role="status">
        <StatusDot status="success">Fusionado en {{ baseBranch }}.</StatusDot>
      </div>
      <div v-else-if="pr.status === 'closed'" class="callout" role="status">
        <StatusDot status="neutral">
          Cerrado sin fusionar. <span class="callout__muted">El agente no se activa.</span>
        </StatusDot>
      </div>
    </template>

    <template v-if="pr">
      <section class="detail__section" :aria-labelledby="`${headingId}-ficheros`">
        <h4 :id="`${headingId}-ficheros`" class="detail__section-title">
          Ficheros <span class="detail__count">{{ pr.files.length }}</span>
          <span v-if="pr.files.length" class="detail__section-note">
            {{ plural(addedFiles, 'nuevo', 'nuevos') }} · {{ pr.files.length - addedFiles }} {{ pr.files.length - addedFiles === 1 ? 'modificado' : 'modificados' }}
          </span>
        </h4>
        <ul v-if="pr.files.length" class="files" role="list">
          <li v-for="file in pr.files" :key="file.path" class="files__row">
            <code class="files__path">{{ file.path }}</code>
            <Badge :variant="file.status === 'added' ? 'outline' : 'neutral'" :label="FILE_STATUS[file.status] ?? file.status" />
          </li>
        </ul>
        <p v-else class="detail__empty">Sin ficheros.</p>
      </section>

      <section v-if="pr.envVars.length" class="detail__section" :aria-labelledby="`${headingId}-variables`">
        <h4 :id="`${headingId}-variables`" class="detail__section-title">
          Variables de entorno nuevas <span class="detail__count">{{ pr.envVars.length }}</span>
        </h4>
        <ul class="env" role="list">
          <li v-for="name in pr.envVars" :key="name"><code class="env__var">{{ name }}</code></li>
        </ul>
        <p class="detail__hint">Van en <code>.env.example</code>; ponles valor en <code>.env</code> para conectar el agente.</p>
      </section>

      <section class="detail__section" :aria-labelledby="`${headingId}-validacion`">
        <div class="detail__section-head">
          <h4 :id="`${headingId}-validacion`" class="detail__section-title">Validación</h4>
          <StatusDot
            v-if="pr.validation.steps.length"
            :status="validationOk ? 'success' : 'danger'"
            :label="validationOk ? 'Todo en verde' : 'Con errores'"
          />
        </div>
        <ul v-if="pr.validation.steps.length" class="steps" role="list">
          <li v-for="(step, i) in pr.validation.steps" :key="`${i}:${step.name}`" class="steps__item">
            <details v-if="step.output" class="step">
              <summary class="step__summary">
                <StatusDot :status="step.ok ? 'success' : 'danger'" :label="step.name" />
                <span class="step__toggle">Salida</span>
                <svg class="step__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                  <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </summary>
              <div class="step__output">
                <CodeBlock :code="step.output" :label="step.name" wrap max-height="280px" />
              </div>
            </details>
            <div v-else class="step__summary step__summary--static">
              <StatusDot :status="step.ok ? 'success' : 'danger'" :label="step.name" />
            </div>
          </li>
        </ul>
        <p v-else class="detail__empty">Todavía no se ha validado.</p>
      </section>

      <section class="detail__section">
        <DiffBlock :title="`Diff contra ${baseBranch}`" :diff="pr.diff" />
      </section>
    </template>
  </article>
</template>

<style scoped>
.detail {
  container: proposal / inline-size;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  padding: 24px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
@container proposals (max-width: 520px) {
  .detail {
    padding: 16px;
  }
}

.detail__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.detail__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 24px;
}
.detail__title {
  flex: 1 1 28ch;
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
}
.detail__status {
  flex: none;
  margin-top: 4px;
  font-size: var(--text-sm);
}
.detail__branch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.detail__branch code {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.detail__into {
  color: var(--fg-subtle);
}
.detail__meta {
  margin-top: 8px;
}

.author {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.gh-link {
  white-space: nowrap;
}
.gh-link__arrow {
  color: var(--fg-subtle);
}
.gh-link:hover .gh-link__arrow {
  color: var(--fg);
}

.callout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 10px 12px 10px 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
}
.callout--danger {
  border-left: 2px solid var(--danger);
}
.callout__muted {
  font-weight: 400;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}

.detail__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}
.detail__section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 16px;
  font-size: var(--text-sm);
}
.detail__section-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
}
.detail__count {
  font-weight: 400;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.detail__section-note {
  margin-left: auto;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.detail__hint,
.detail__empty {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.detail__hint code {
  font-size: var(--text-xs);
  color: var(--fg);
}

/* ── Ficheros ───────────────────────────────── */
.files {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.files__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 7px 12px;
}
.files__row + .files__row {
  border-top: 1px solid var(--border);
}
.files__path {
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}

/* ── Variables ──────────────────────────────── */
.env {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.env__var {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}

/* ── Validación ─────────────────────────────── */
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.steps__item + .steps__item {
  border-top: 1px solid var(--border);
}
.step__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 8px 12px;
  font-size: var(--text-sm);
  line-height: 20px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.step__summary--static {
  cursor: default;
}
.step__summary::-webkit-details-marker {
  display: none;
}
.step__summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}
.step__summary:not(.step__summary--static):hover {
  background: var(--bg-hover);
}
.step__toggle {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}
.step__summary:hover .step__toggle {
  color: var(--fg-muted);
}
.step__chevron {
  flex: none;
  color: var(--fg-subtle);
  transition: transform 150ms var(--ease);
}
.step[open] .step__chevron {
  transform: rotate(90deg);
}
.step__output {
  padding: 0 12px 12px;
}
</style>
