<script setup lang="ts">
/**
 * Paso de una `Timeline`. `status` colorea el marcador; `title`; `time?` (ISO → hora hh:mm:ss en
 * mono con la fecha completa en `title`; cualquier otro texto se muestra tal cual); `statusLabel?`
 * para lectores de pantalla. Slots: `title` (sustituye al título), `meta` (línea gris: modelo,
 * tokens, coste…), `aside` (a la derecha, antes de la hora) y default (detalle).
 */
import { computed } from 'vue';
import { fullTime } from '../components/format.ts';
import type { Status } from './types.ts';

const props = withDefaults(
  defineProps<{ status?: Status; title?: string; time?: string; statusLabel?: string }>(),
  {
    status: 'neutral',
    title: undefined,
    time: undefined,
    statusLabel: undefined,
  },
);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const timeInfo = computed(() => {
  const value = props.time;
  if (!value) return null;
  if (ISO.test(value) && !Number.isNaN(Date.parse(value))) {
    return {
      text: new Date(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      datetime: value,
      title: fullTime(value),
    };
  }
  return { text: value, datetime: undefined, title: undefined };
});
</script>

<template>
  <li class="tl-item" :class="`tl-item--${status}`">
    <span class="tl-item__dot" aria-hidden="true"></span>
    <div class="tl-item__body">
      <div class="tl-item__head">
        <p class="tl-item__title">
          <span v-if="statusLabel" class="sr-only">{{ statusLabel }}: </span>
          <slot name="title">{{ title }}</slot>
        </p>
        <div v-if="$slots.aside" class="tl-item__aside"><slot name="aside" /></div>
        <time v-if="timeInfo" class="tl-item__time" :datetime="timeInfo.datetime" :title="timeInfo.title">{{
          timeInfo.text
        }}</time>
      </div>
      <div v-if="$slots.meta" class="tl-item__meta"><slot name="meta" /></div>
      <div v-if="$slots.default" class="tl-item__detail"><slot /></div>
    </div>
  </li>
</template>

<style scoped>
.tl-item {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 12px;
  padding-bottom: 20px;
}
.tl-item:last-child {
  padding-bottom: 0;
}

/* Tramo de línea entre este marcador y el siguiente, con 4px de aire a cada lado. */
.tl-item::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 18px;
  bottom: -2px;
  width: 1px;
  background: var(--border-strong);
}
.tl-item:last-child::before {
  display: none;
}

.tl-item__dot {
  position: absolute;
  left: 3.5px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-subtle);
}
.tl-item--success .tl-item__dot {
  background: var(--success);
}
.tl-item--warning .tl-item__dot {
  background: var(--warning);
}
.tl-item--danger .tl-item__dot {
  background: var(--danger);
}
.tl-item--neutral .tl-item__dot {
  background: var(--fg-subtle);
}
.tl-item--pending .tl-item__dot {
  background: var(--fg);
}
@media (prefers-reduced-motion: no-preference) {
  .tl-item--pending .tl-item__dot {
    animation: pulse-dot 1.6s ease-in-out infinite;
  }
}

.tl-item__body {
  grid-column: 2;
  min-width: 0;
}
.tl-item__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.tl-item__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.tl-item__aside {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 20px;
}
.tl-item__time {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tl-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 2px;
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.tl-item__detail {
  margin-top: 4px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
</style>
