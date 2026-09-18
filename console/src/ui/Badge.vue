<script setup lang="ts">
/**
 * Etiqueta corta de 20px. `variant`: neutral (por defecto) · inverted · outline · success · warning ·
 * danger. `mono` para versiones e IDs. Contenido por slot o por `label`.
 */
import type { BadgeVariant } from './types.ts';

withDefaults(defineProps<{ variant?: BadgeVariant; label?: string; mono?: boolean }>(), {
  variant: 'neutral',
  label: undefined,
  mono: false,
});
</script>

<template>
  <span class="badge" :class="[`badge--${variant}`, { 'badge--mono': mono }]">
    <slot>{{ label }}</slot>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  flex: none;
  max-width: 100%;
  height: 20px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}
.badge--mono {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.badge--neutral {
  background: var(--bg-muted);
  color: var(--fg);
}
.badge--inverted {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}
.badge--outline {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--fg);
}
.badge--success {
  background: var(--success-bg);
  color: var(--success);
}
.badge--warning {
  background: var(--warning-bg);
  color: var(--warning);
}
.badge--danger {
  background: var(--danger-bg);
  color: var(--danger);
}
</style>
