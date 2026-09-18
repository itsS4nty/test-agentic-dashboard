<script setup lang="ts">
/**
 * Bloque de código o JSON en Geist Mono con botón «Copiar». `code`, `wrap` (parte líneas largas),
 * `maxHeight` (CSS; por defecto 320px), `label?` (nombre de fichero o rótulo: añade una barra
 * superior), `copyable` (true).
 */
import { onBeforeUnmount, ref } from 'vue';

const props = withDefaults(
  defineProps<{ code: string; wrap?: boolean; maxHeight?: string; label?: string; copyable?: boolean }>(),
  {
    wrap: false,
    maxHeight: '320px',
    label: undefined,
    copyable: true,
  },
);

const copyState = ref<'idle' | 'done' | 'error'>('idle');
let resetTimer: ReturnType<typeof setTimeout> | undefined;

function fallbackCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

async function copy() {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(props.code);
      ok = true;
    } else {
      ok = fallbackCopy(props.code);
    }
  } catch {
    ok = fallbackCopy(props.code);
  }
  copyState.value = ok ? 'done' : 'error';
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => (copyState.value = 'idle'), 1600);
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <figure class="code" :class="{ 'code--labelled': !!label }">
    <figcaption v-if="label" class="code__bar">
      <span class="code__label" :title="label">{{ label }}</span>
    </figcaption>
    <button v-if="copyable" type="button" class="code__copy" :aria-label="copyState === 'done' ? 'Copiado' : 'Copiar código'" @click="copy">
      {{ copyState === 'done' ? 'Copiado' : copyState === 'error' ? 'No se pudo copiar' : 'Copiar' }}
    </button>
    <pre
      class="code__pre"
      :class="{ 'is-wrapped': wrap }"
      :style="{ maxHeight }"
      tabindex="0"
      role="region"
      :aria-label="label ?? 'Código'"
    ><code>{{ code }}</code></pre>
    <span class="sr-only" aria-live="polite">{{ copyState === 'done' ? 'Copiado al portapapeles' : '' }}</span>
  </figure>
</template>

<style scoped>
.code {
  position: relative;
  min-width: 0;
  margin: 0;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.code__bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 88px 0 12px;
  border-bottom: 1px solid var(--border);
}
.code__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}

.code__copy {
  appearance: none;
  position: absolute;
  z-index: 1;
  top: 6px;
  right: 6px;
  height: 24px;
  padding: 0 8px;
  margin: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    opacity 150ms var(--ease),
    background-color 150ms var(--ease),
    color 150ms var(--ease);
}
.code__copy:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.code__copy:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
/* Sin barra, el botón solo aparece al pasar por encima o con el foco dentro (siempre en táctil). */
@media (hover: hover) {
  .code:not(.code--labelled) .code__copy {
    opacity: 0;
  }
  .code:not(.code--labelled):hover .code__copy,
  .code:not(.code--labelled):focus-within .code__copy {
    opacity: 1;
  }
}

.code__pre {
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  white-space: pre;
  tab-size: 2;
  border-radius: 0 0 calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px);
}
.code__pre code {
  font-family: inherit;
  font-size: inherit;
}
.code__pre.is-wrapped {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code__pre:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
