<script setup lang="ts">
/**
 * Punto de estado de 8px con texto. `status`: success · warning · danger · neutral (por defecto) ·
 * pending (pulso suave; quieto con reduced motion). Texto por `label` o slot. Sin texto visible,
 * el punto se anuncia con `label` o con el nombre del estado.
 */
import { computed, useSlots } from 'vue';
import type { Status } from './types.ts';

const props = withDefaults(defineProps<{ status?: Status; label?: string; muted?: boolean }>(), {
  status: 'neutral',
  label: undefined,
  muted: false,
});

const slots = useSlots();

const FALLBACK: Record<Status, string> = {
  success: 'Correcto',
  warning: 'Requiere atención',
  danger: 'Error',
  neutral: 'Sin actividad',
  pending: 'En curso',
};

const hasText = computed(() => !!props.label || !!slots.default);
</script>

<template>
  <span class="status" :class="[`status--${status}`, { 'status--muted': muted }]">
    <span
      class="status__dot"
      :role="hasText ? undefined : 'img'"
      :aria-hidden="hasText ? 'true' : undefined"
      :aria-label="hasText ? undefined : FALLBACK[status]"
    ></span>
    <span v-if="hasText" class="status__label"><slot>{{ label }}</slot></span>
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  color: var(--fg);
  font-size: inherit;
  line-height: 20px;
  vertical-align: middle;
}
.status--muted {
  color: var(--fg-muted);
}
.status__dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--fg-subtle);
}
.status__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.status--success .status__dot {
  background: var(--success);
}
.status--warning .status__dot {
  background: var(--warning);
}
.status--danger .status__dot {
  background: var(--danger);
}
.status--neutral .status__dot {
  background: var(--fg-subtle);
}
.status--pending .status__dot {
  background: var(--fg);
}
@media (prefers-reduced-motion: no-preference) {
  .status--pending .status__dot {
    animation: pulse-dot 1.6s ease-in-out infinite;
  }
}
</style>
