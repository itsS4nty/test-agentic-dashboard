<script setup lang="ts">
/**
 * Pares etiqueta/valor en un `dl`. `items: { label, value?, mono?, slot? }[]`: el valor puede
 * sustituirse con el slot que nombre `slot`. `layout`: rows (etiqueta a la izquierda, por defecto)
 * o stacked (etiqueta encima, en columnas que se reparten el ancho).
 * Slot default para pares a mano: `<dt>`/`<dd>` en rows; `<div><dt/><dd/></div>` en stacked.
 */
import type { KeyValueItem } from './types.ts';

withDefaults(defineProps<{ items?: KeyValueItem[]; layout?: 'rows' | 'stacked' }>(), {
  items: () => [],
  layout: 'rows',
});

function isEmpty(value: KeyValueItem['value']): boolean {
  return value === undefined || value === null || value === '';
}
</script>

<template>
  <dl v-if="layout === 'rows'" class="kv kv--rows">
    <template v-for="(item, index) in items" :key="`${item.label}-${index}`">
      <dt class="kv__label">{{ item.label }}</dt>
      <dd class="kv__value" :class="{ mono: item.mono, 'kv__value--empty': !item.slot && isEmpty(item.value) }">
        <slot v-if="item.slot" :name="item.slot" :item="item">{{ item.value }}</slot>
        <template v-else>{{ isEmpty(item.value) ? '—' : item.value }}</template>
      </dd>
    </template>
    <slot />
  </dl>

  <dl v-else class="kv kv--stacked">
    <div v-for="(item, index) in items" :key="`${item.label}-${index}`" class="kv__pair">
      <dt class="kv__label">{{ item.label }}</dt>
      <dd class="kv__value" :class="{ mono: item.mono, 'kv__value--empty': !item.slot && isEmpty(item.value) }">
        <slot v-if="item.slot" :name="item.slot" :item="item">{{ item.value }}</slot>
        <template v-else>{{ isEmpty(item.value) ? '—' : item.value }}</template>
      </dd>
    </div>
    <slot />
  </dl>
</template>

<style scoped>
.kv {
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  line-height: 20px;
}

.kv--rows {
  display: grid;
  grid-template-columns: minmax(88px, max-content) minmax(0, 1fr);
  gap: 8px 24px;
  align-items: start;
}
.kv--rows > :slotted(dt) {
  grid-column: 1;
}
.kv--rows > :slotted(dd) {
  grid-column: 2;
}

.kv--stacked {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 12px 24px;
}
.kv__pair,
.kv--stacked > :slotted(div) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kv__label,
.kv > :slotted(dt),
.kv--stacked > :slotted(div) > dt {
  margin: 0;
  color: var(--fg-muted);
  font-weight: 400;
}
.kv__value,
.kv > :slotted(dd),
.kv--stacked > :slotted(div) > dd {
  min-width: 0;
  margin: 0;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.kv__value.mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.kv__value--empty {
  color: var(--fg-subtle);
}
</style>
