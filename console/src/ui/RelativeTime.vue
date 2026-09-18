<script setup lang="ts">
/** Tiempo relativo («hace 12 s») que avanza solo, con la fecha completa en `title`. `at`: ISO. */
import { computed } from 'vue';
import { fullTime, relativeTime, useNow } from '../components/format.ts';

const props = withDefaults(defineProps<{ at?: string | null }>(), { at: undefined });

const now = useNow();
const text = computed(() => relativeTime(props.at ?? undefined, now.value));
const title = computed(() => fullTime(props.at ?? undefined));
</script>

<template>
  <time v-if="at" class="relative-time" :datetime="at" :title="title">{{ text }}</time>
</template>

<style scoped>
.relative-time {
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
