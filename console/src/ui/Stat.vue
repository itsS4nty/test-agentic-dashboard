<script setup lang="ts">
/**
 * Cifra con etiqueta. `label`, `value`, `hint?` (línea gris), `tone` (default · success · warning ·
 * danger: colorea solo el valor). `size` hereda el de `StatGrid` (md 24px · sm 20px).
 * Slots: default (sustituye al valor), `hint`, `label`.
 */
import { computed, inject } from 'vue';
import { STAT_SIZE_KEY } from './stat-context.ts';
import type { StatSize, StatTone } from './types.ts';

const props = withDefaults(
  defineProps<{
    label: string;
    value?: string | number | null;
    hint?: string;
    tone?: StatTone;
    size?: StatSize;
  }>(),
  {
    value: undefined,
    hint: undefined,
    tone: 'default',
    size: undefined,
  },
);

const fromGrid = inject(STAT_SIZE_KEY, null);
const resolvedSize = computed<StatSize>(() => props.size ?? fromGrid?.value ?? 'md');
const display = computed(() => (props.value === null || props.value === undefined || props.value === '' ? '—' : props.value));
</script>

<template>
  <div class="stat" :class="[`stat--${resolvedSize}`, `stat--${tone}`]">
    <div class="stat__label"><slot name="label">{{ label }}</slot></div>
    <div class="stat__value"><slot>{{ display }}</slot></div>
    <div v-if="hint || $slots.hint" class="stat__hint"><slot name="hint">{{ hint }}</slot></div>
  </div>
</template>

<style scoped>
/*
 * Dentro de StatGrid cada cifra ocupa tres filas de la rejilla (etiqueta, valor, pista) con subgrid:
 * si una etiqueta pasa a dos líneas, los valores de esa fila siguen alineados.
 */
.stat {
  display: grid;
  grid-row: span 3;
  grid-template-rows: subgrid;
  row-gap: 0;
  align-content: start;
  min-width: 0;
  background: var(--bg);
}
.stat--md {
  padding: 16px;
}
.stat--sm {
  padding: 12px 16px;
}
/* Márgenes en vez de row-gap: una fila de pistas vacía no añade aire. */
.stat--md .stat__value,
.stat--md .stat__hint {
  margin-top: 4px;
}
.stat--sm .stat__value,
.stat--sm .stat__hint {
  margin-top: 2px;
}

.stat__label {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
  text-wrap: balance;
}
.stat__value {
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.stat--md .stat__value {
  font-size: var(--text-xl);
  line-height: 32px;
}
.stat--sm .stat__value {
  font-size: var(--text-lg);
  line-height: 28px;
}
.stat--success .stat__value {
  color: var(--success);
}
.stat--warning .stat__value {
  color: var(--warning);
}
.stat--danger .stat__value {
  color: var(--danger);
}
.stat__hint {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
</style>
