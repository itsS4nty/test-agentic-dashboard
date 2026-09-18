<script setup lang="ts">
/**
 * Enlace a un caso: abre la pestaña Casos (evento global `open-case`). Sin `label` muestra el ID
 * en mono. API conservada: `caseId`, `label`.
 */
import { openCase } from './format.ts';

defineProps<{ caseId?: string; label?: string }>();
</script>

<template>
  <button
    v-if="caseId"
    type="button"
    class="case-link"
    :class="{ 'case-link--id': !label }"
    :title="`Abrir el caso ${caseId}`"
    @click.stop="openCase(caseId)"
  >
    <span class="case-link__text">{{ label ?? caseId }}</span>
    <svg class="case-link__arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4.5 3h4.5v4.5M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
  <span v-else class="case-link-none" aria-label="Sin caso">—</span>
</template>

<style scoped>
.case-link {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: inherit;
  line-height: 20px;
  text-align: left;
  vertical-align: bottom;
  cursor: pointer;
}
.case-link--id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.case-link__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 3px;
  transition: text-decoration-color 150ms var(--ease);
}
.case-link:hover .case-link__text {
  text-decoration-color: var(--fg);
}
.case-link__arrow {
  flex: none;
  color: var(--fg-subtle);
  transition: color 150ms var(--ease);
}
.case-link:hover .case-link__arrow {
  color: var(--fg);
}
.case-link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.case-link-none {
  color: var(--fg-subtle);
}
</style>
