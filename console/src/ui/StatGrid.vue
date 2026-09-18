<script setup lang="ts">
/**
 * Rejilla de cifras dentro de un único marco, con celdas separadas por bordes de 1px.
 * `columns` (2 · 3 · 4 · 6; por defecto 3) se adapta al ancho del propio marco: 6 → 3 → 2 → 1,
 * 4 → 2 → 1, 3 → 2 → 1, 2 → 1. `size` (md · sm) llega a cada `Stat` hijo. Slot default: `Stat`.
 */
import { provide, toRef } from 'vue';
import { STAT_SIZE_KEY } from './stat-context.ts';
import type { StatSize } from './types.ts';

const props = withDefaults(defineProps<{ columns?: 2 | 3 | 4 | 6; size?: StatSize; label?: string }>(), {
  columns: 3,
  size: 'md',
  label: undefined,
});

provide(STAT_SIZE_KEY, toRef(props, 'size'));
</script>

<template>
  <div class="stat-grid" :class="`stat-grid--${size}`" role="group" :aria-label="label">
    <div class="stat-grid__cells" :class="`cols-${columns}`">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stat-grid {
  container-type: inline-size;
  min-width: 0;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

/* El margen negativo esconde el borde derecho e inferior de las celdas del extremo bajo el marco. */
.stat-grid__cells {
  display: grid;
  margin: 0 -1px -1px 0;
}
.stat-grid__cells > :slotted(*) {
  min-width: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.cols-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.cols-6 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

/* Umbrales pensados para celdas de al menos ~180px. */
@container (min-width: 1040px) {
  .cols-6 {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
@container (max-width: 719px) {
  .cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 559px) {
  .cols-3,
  .cols-6 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 359px) {
  .cols-2,
  .cols-3,
  .cols-4,
  .cols-6 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
