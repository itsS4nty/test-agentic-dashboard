<script setup lang="ts">
/**
 * Tarjeta: borde de 1px, radio 8px, sin sombra. Cabecera opcional con `title` (14px 600),
 * `description` (una línea gris) y slot `actions`. `padded=false` deja el cuerpo a sangre
 * (tablas, listas): la cabecera lleva entonces un borde inferior y las celdas de una
 * `table.table` se alinean con el título. Slots: default, `actions`, `header` (sustituye
 * título y descripción) y `footer`.
 */
import { computed, useSlots } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    padded?: boolean;
    as?: 'section' | 'article' | 'div';
    headingLevel?: 2 | 3 | 4;
  }>(),
  {
    title: undefined,
    description: undefined,
    padded: true,
    as: 'section',
    headingLevel: 2,
  },
);

const slots = useSlots();
const hasHeader = computed(() => !!(props.title || props.description || slots.header || slots.actions));
</script>

<template>
  <component :is="as" class="card" :class="{ 'card--flush': !padded }">
    <header v-if="hasHeader" class="card__header">
      <div class="card__heading">
        <slot name="header">
          <component :is="`h${headingLevel}`" v-if="title" class="card__title">{{ title }}</component>
          <p v-if="description" class="card__description">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="card__actions"><slot name="actions" /></div>
    </header>
    <div class="card__body" :class="{ 'card__body--after-header': hasHeader }">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="card__footer"><slot name="footer" /></footer>
  </component>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 16px 16px 0;
}
.card--flush .card__header {
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border);
}
.card__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.card__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
  letter-spacing: -0.005em;
  color: var(--fg);
}
.card__description {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
/* Alto fijo de una línea de título: botones y controles quedan centrados con él sin engordar la cabecera. */
.card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: none;
  height: 20px;
}

.card__body {
  flex: 1;
  min-width: 0;
  padding: 16px;
}
.card__body--after-header {
  padding-top: 12px;
}
.card--flush .card__body {
  padding: 0;
  overflow-x: auto;
  border-radius: 0 0 calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px);
}

/* Tablas a sangre: las celdas extremas se alinean con el título de la tarjeta. */
.card--flush .card__body :deep(table.table th:first-child),
.card--flush .card__body :deep(table.table td:first-child) {
  padding-left: 16px;
}
.card--flush .card__body :deep(table.table th:last-child),
.card--flush .card__body :deep(table.table td:last-child) {
  padding-right: 16px;
}
.card--flush:not(:has(.card__header)) .card__body :deep(table.table thead tr:first-child th:first-child) {
  border-top-left-radius: calc(var(--radius-lg) - 1px);
}
.card--flush:not(:has(.card__header)) .card__body :deep(table.table thead tr:first-child th:last-child) {
  border-top-right-radius: calc(var(--radius-lg) - 1px);
}

.card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
  border-radius: 0 0 calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px);
}
.card--flush .card__body:has(+ .card__footer) {
  border-radius: 0;
}
</style>
