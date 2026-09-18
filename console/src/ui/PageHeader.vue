<script setup lang="ts">
/**
 * Cabecera de página: `title` (h1, 24px 600), `description?` (una línea gris) y slot `actions`
 * a la derecha. Slot `description` para una descripción con marcado.
 */
withDefaults(defineProps<{ title: string; description?: string }>(), { description: undefined });
</script>

<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="description || $slots.description" class="page-header__description">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 24px;
  min-width: 0;
}
.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 320px;
  min-width: 0;
}
.page-header__title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  line-height: 32px;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.page-header__description {
  max-width: 72ch;
  font-size: var(--text-base);
  line-height: 20px;
  color: var(--fg-muted);
}
.page-header__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: none;
}
</style>
