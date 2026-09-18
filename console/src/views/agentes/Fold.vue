<script setup lang="ts">
/**
 * Apartado plegable (`details`) con chevron, como los plegables de las fichas de agente.
 * `title`, `meta?` (resumen gris a la derecha), `v-model:open`. Slot default: el contenido.
 */
const open = defineModel<boolean>('open', { default: false });

withDefaults(defineProps<{ title: string; meta?: string }>(), { meta: undefined });

function onToggle(event: Event) {
  open.value = (event.target as HTMLDetailsElement).open;
}
</script>

<template>
  <details class="fold" :open="open" @toggle="onToggle">
    <summary class="fold__summary">
      <svg class="fold__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="fold__title">{{ title }}</span>
      <span v-if="meta" class="fold__meta">{{ meta }}</span>
    </summary>
    <div class="fold__content">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.fold {
  min-width: 0;
  border-top: 1px solid var(--border);
}
.fold__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 12px 0;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.fold__summary::-webkit-details-marker {
  display: none;
}
.fold__summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.fold__chevron {
  flex: none;
  color: var(--fg-subtle);
  transition:
    transform 150ms var(--ease),
    color 150ms var(--ease);
}
.fold__summary:hover .fold__chevron {
  color: var(--fg);
}
.fold[open] .fold__chevron {
  transform: rotate(90deg);
}
.fold__title {
  flex: none;
}
.fold__meta {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  font-size: var(--text-xs);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fold__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 0 0 20px;
}
</style>
