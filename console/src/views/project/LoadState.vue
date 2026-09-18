<script setup lang="ts">
/**
 * Carga inicial y errores del snapshot. Con datos previos, el error no tapa la vista.
 * API conservada: `loading`, `error`, `hasData`, `what`.
 */
import StatusDot from '../../ui/StatusDot.vue';

defineProps<{ loading: boolean; error: string | null; hasData: boolean; what: string }>();
</script>

<template>
  <p v-if="!hasData && loading" class="load" role="status">
    <StatusDot status="pending" muted :label="`Cargando ${what}…`" />
  </p>
  <div v-else-if="error" class="load-error" role="status">
    <StatusDot status="danger" :label="`No se pudo cargar ${what}.`" class="load-error__title" />
    <p class="load-error__detail">
      <span class="mono">{{ error }}</span>
      <template v-if="hasData"> · Se muestra el último estado conocido.</template>
    </p>
  </div>
</template>

<style scoped>
.load {
  margin: 0;
  font-size: var(--text-sm);
}
.load-error {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 2px solid var(--danger);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}
.load-error__title {
  font-weight: 500;
}
.load-error__detail {
  padding-left: 16px;
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
</style>
