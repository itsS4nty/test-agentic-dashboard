<script setup lang="ts">
/**
 * Una tanda de tests, compacta: rótulo y rama, las dos cifras (pasan · fallan), el veredicto con
 * `StatusDot` y la salida plegada en un `CodeBlock`.
 * API: `label`, `sublabel` (rama), `run`. `digitos` se acepta por compatibilidad y no se usa.
 * `hideOutput` quita la salida plegable (el padre la pinta a lo ancho).
 */
import { computed } from 'vue';
import CodeBlock from '../../ui/CodeBlock.vue';
import StatusDot from '../../ui/StatusDot.vue';
import type { Status } from '../../ui/types.ts';
import type { TestRun } from './types.ts';

const props = defineProps<{ label: string; sublabel: string; run: TestRun; digitos?: number; hideOutput?: boolean }>();

const verdict = computed<{ status: Status; label: string }>(() => {
  const { passed, failed } = props.run;
  if (failed > 0) return { status: 'danger', label: failed === 1 ? '1 falla' : `${failed} fallan` };
  if (passed > 0) return { status: 'success', label: 'Todos pasan' };
  return { status: 'neutral', label: 'Sin tests' };
});
</script>

<template>
  <div class="tests" role="group" :aria-label="`${label}: ${verdict.label}`">
    <div class="tests__head">
      <div class="tests__name">
        <h4 class="tests__label">{{ label }}</h4>
        <code class="tests__branch" :title="sublabel">{{ sublabel }}</code>
      </div>
      <StatusDot class="tests__verdict" :status="verdict.status" :label="verdict.label" />
    </div>

    <p class="tests__counts">
      <span class="tests__count">
        <span class="tests__n">{{ run.passed }}</span>
        <span class="tests__word">{{ run.passed === 1 ? 'pasa' : 'pasan' }}</span>
      </span>
      <span class="tests__count" :class="{ 'tests__count--failed': run.failed > 0 }">
        <span class="tests__n">{{ run.failed }}</span>
        <span class="tests__word">{{ run.failed === 1 ? 'falla' : 'fallan' }}</span>
      </span>
    </p>

    <details v-if="run.output && !hideOutput" class="tests__output">
      <summary class="tests__summary">
        <svg class="tests__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        Ver salida
      </summary>
      <CodeBlock class="tests__code" :code="run.output" wrap max-height="240px" />
    </details>
  </div>
</template>

<style scoped>
.tests {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.tests__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px 16px;
  min-width: 0;
}
.tests__name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tests__label {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
}
.tests__branch {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-subtle);
}
.tests__verdict {
  flex: none;
  font-size: var(--text-sm);
  white-space: nowrap;
}

.tests__counts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 20px;
}
.tests__count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.tests__n {
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
.tests__word {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.tests__count--failed .tests__n {
  color: var(--danger);
}

.tests__summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: color 150ms var(--ease);
}
.tests__summary::-webkit-details-marker {
  display: none;
}
.tests__summary:hover {
  color: var(--fg);
}
.tests__chevron {
  flex: none;
  transition: transform 150ms var(--ease);
}
.tests__output[open] .tests__chevron {
  transform: rotate(90deg);
}
.tests__code {
  margin-top: 8px;
}
</style>
