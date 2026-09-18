<script setup lang="ts">
/**
 * Estado vacío, centrado y sin iconos. `title`, `description?` (una línea gris), slot `action`.
 * `compact`: sin marco y alineado a la izquierda, para huecos dentro de otra pieza.
 * Slot `description` para una descripción con marcado.
 */
withDefaults(defineProps<{ title: string; description?: string; compact?: boolean }>(), {
  description: undefined,
  compact: false,
});
</script>

<template>
  <div class="empty" :class="{ 'empty--compact': compact }">
    <p class="empty__title">{{ title }}</p>
    <p v-if="description || $slots.description" class="empty__description">
      <slot name="description">{{ description }}</slot>
    </p>
    <div v-if="$slots.action" class="empty__action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 40px 24px;
  text-align: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.empty__title {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
  color: var(--fg);
  text-wrap: balance;
}
.empty__description {
  max-width: 56ch;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  text-wrap: balance;
}
.empty__action {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

.empty--compact {
  align-items: flex-start;
  padding: 0;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 0;
}
.empty--compact .empty__title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-muted);
}
.empty--compact .empty__description {
  color: var(--fg-subtle);
}
.empty--compact .empty__action {
  justify-content: flex-start;
  margin-top: 8px;
}
</style>
