<script setup lang="ts">
/**
 * Cabecera de las vistas de proyecto sobre `ui/PageHeader`: `title`, `description` y slot `aside`
 * (a la derecha). API conservada: `antetitulo` se acepta pero no se pinta.
 */
import PageHeader from '../../ui/PageHeader.vue';

defineProps<{ antetitulo?: string; title: string; description: string }>();
</script>

<template>
  <PageHeader :title="title" :description="description">
    <template v-if="$slots.aside" #actions><slot name="aside" /></template>
  </PageHeader>
</template>
