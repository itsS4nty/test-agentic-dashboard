<script setup lang="ts">
/**
 * Pestañas con subrayado de 2px en la activa. `items: { id, label, count? }[]`, `modelValue` (id
 * activo). Con `hrefFor` son enlaces de navegación (`nav` + `aria-current="page"`); sin él, un
 * `tablist` accesible con flechas, Inicio y Fin. Emite `update:modelValue` al elegir.
 * `alignText` (true) desplaza la tira para que el texto de la primera pestaña quede alineado con
 * el contenido del contenedor.
 */
import { nextTick, onMounted, ref, watch } from 'vue';
import type { TabItem } from './types.ts';

const props = withDefaults(
  defineProps<{
    items: TabItem[];
    modelValue: string;
    hrefFor?: (id: string) => string;
    ariaLabel?: string;
    alignText?: boolean;
  }>(),
  {
    hrefFor: undefined,
    ariaLabel: 'Secciones',
    alignText: true,
  },
);

const emit = defineEmits<{ 'update:modelValue': [id: string] }>();

const root = ref<HTMLElement | null>(null);

function hasCount(item: TabItem): boolean {
  return item.count !== undefined && item.count !== null;
}

function select(id: string) {
  if (id !== props.modelValue) emit('update:modelValue', id);
}

function onKeydown(event: KeyboardEvent, index: number) {
  const last = props.items.length - 1;
  let next = -1;
  if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
  else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = last;
  if (next < 0) return;
  event.preventDefault();
  const item = props.items[next];
  select(item.id);
  void nextTick(() => {
    root.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  });
}

function revealActive() {
  const active = root.value?.querySelector<HTMLElement>('.is-active');
  const scroller = root.value;
  if (!active || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < scroller.scrollLeft) scroller.scrollLeft = left - 8;
  else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth + 8;
}

onMounted(revealActive);
watch(
  () => props.modelValue,
  () => void nextTick(revealActive),
);
</script>

<template>
  <nav v-if="hrefFor" ref="root" class="tabs" :class="{ 'tabs--align': alignText }" :aria-label="ariaLabel">
    <ul class="tabs__list">
      <li v-for="item in items" :key="item.id" class="tabs__cell">
        <a
          class="tabs__tab"
          :class="{ 'is-active': item.id === modelValue }"
          :href="hrefFor(item.id)"
          :aria-current="item.id === modelValue ? 'page' : undefined"
          @click="select(item.id)"
        >
          <span class="tabs__inner">
            <span class="tabs__label">{{ item.label }}</span>
            <span v-if="hasCount(item)" class="tabs__count">{{ item.count }}</span>
          </span>
        </a>
      </li>
    </ul>
  </nav>

  <div v-else ref="root" class="tabs" :class="{ 'tabs--align': alignText }">
    <div class="tabs__list" role="tablist" :aria-label="ariaLabel">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        role="tab"
        class="tabs__tab"
        :class="{ 'is-active': item.id === modelValue }"
        :aria-selected="item.id === modelValue"
        :tabindex="item.id === modelValue ? 0 : -1"
        @click="select(item.id)"
        @keydown="onKeydown($event, index)"
      >
        <span class="tabs__inner">
          <span class="tabs__label">{{ item.label }}</span>
          <span v-if="hasCount(item)" class="tabs__count">{{ item.count }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tabs--align {
  margin-inline: -12px;
  padding-inline: 0;
}

.tabs__list {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-height: 40px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tabs__cell {
  display: flex;
}

.tabs__tab {
  appearance: none;
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
  margin: 0;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: 400;
  line-height: 20px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: color 150ms var(--ease);
}
.tabs__tab:focus-visible {
  outline: none;
}
.tabs__tab:focus-visible .tabs__inner {
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

.tabs__inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius);
  transition: background-color 150ms var(--ease);
}
.tabs__tab:hover {
  color: var(--fg);
}
.tabs__tab:hover .tabs__inner {
  background: var(--bg-hover);
}

.tabs__tab.is-active {
  color: var(--fg);
}
.tabs__tab.is-active::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 0;
  height: 2px;
  background: var(--fg);
  border-radius: 1px 1px 0 0;
}

.tabs__count {
  min-width: 16px;
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 16px;
  text-align: center;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.tabs__tab.is-active .tabs__count {
  color: var(--fg-muted);
}
</style>
