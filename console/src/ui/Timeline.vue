<script setup lang="ts">
/** Lista vertical con línea de 1px que une los marcadores de sus `TimelineItem`. */
withDefaults(defineProps<{ ariaLabel?: string }>(), { ariaLabel: undefined });
</script>

<template>
  <ol class="timeline" role="list" :aria-label="ariaLabel">
    <slot />
  </ol>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
