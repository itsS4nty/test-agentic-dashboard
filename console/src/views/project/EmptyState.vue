<script setup lang="ts">
/**
 * Estado vacío de las vistas de proyecto sobre `ui/EmptyState`: el motivo, una línea de ayuda y
 * un botón por escenario que lo llena. Cada botón emite el evento global `abrir-director`
 * (detail = nombre del escenario); App.vue abre el director y lleva el foco a ese escenario.
 * API conservada: `title`, `scenarios`, `hint`, `compact`.
 */
import { computed } from 'vue';
import Button from '../../ui/Button.vue';
import UiEmptyState from '../../ui/EmptyState.vue';

const props = defineProps<{ title: string; scenarios: string[]; hint?: string; compact?: boolean }>();

/* Como título centrado va sin punto final; en la versión compacta es una frase. */
const title = computed(() => (props.compact ? props.title : props.title.replace(/\.$/, '')));

function openDirector(scenario: string) {
  window.dispatchEvent(new CustomEvent('abrir-director', { detail: scenario }));
}
</script>

<template>
  <UiEmptyState :title="title" :description="hint" :compact="compact">
    <template v-if="scenarios.length" #action>
      <Button
        v-for="scenario in scenarios"
        :key="scenario"
        size="sm"
        :title="`Abrir «${scenario}» en el director de demo`"
        @click="openDirector(scenario)"
      >
        {{ scenario }}
      </Button>
    </template>
  </UiEmptyState>
</template>
