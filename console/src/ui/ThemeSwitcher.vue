<script setup lang="ts">
/**
 * Selector de tema: Sistema · Claro · Oscuro, con iconos (monitor, sol, luna).
 * Lee y cambia el tema con `useTheme()` (ui/theme.ts), la única fuente de verdad.
 *
 * - Por defecto: control segmentado de 3 iconos con el lenguaje de `SegmentedControl` sm, accesible
 *   como `radiogroup` (Tab entra en la opción elegida; flechas, Inicio y Fin eligen). Cada opción
 *   tiene su nombre accesible y `title` "Tema: …".
 * - `labels`: muestra también el texto junto al icono.
 * - `compact`: un solo botón de 28px con el icono del tema elegido que pasa al siguiente al
 *   pulsarlo, para cabeceras sin sitio (móvil).
 */
import { computed, nextTick, ref } from 'vue';
import { THEME_LABEL, THEMES, useTheme, type Theme } from './theme.ts';

withDefaults(defineProps<{ labels?: boolean; compact?: boolean }>(), { labels: false, compact: false });

/** Iconos de 16×16 con trazo `currentColor`. */
const ICON_PATH: Record<Theme, string> = {
  system:
    'M3.25 2.5h9.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5ZM8 11v2.5M5.5 13.5h5',
  light:
    'M10.5 8a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0ZM8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.23 3.23l1.06 1.06M11.71 11.71l1.06 1.06M3.23 12.77l1.06-1.06M11.71 4.29l1.06-1.06',
  dark: 'M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a5 5 0 0 0 7 7Z',
};

const { theme, setTheme } = useTheme();
const root = ref<HTMLElement | null>(null);

const next = computed<Theme>(() => THEMES[(THEMES.indexOf(theme.value) + 1) % THEMES.length]);

function titleFor(option: Theme): string {
  return `Tema: ${THEME_LABEL[option]}`;
}

function onKeydown(event: KeyboardEvent, index: number) {
  let target: number;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      target = (index + 1) % THEMES.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      target = (index - 1 + THEMES.length) % THEMES.length;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = THEMES.length - 1;
      break;
    case ' ':
    case 'Enter':
      event.preventDefault();
      setTheme(THEMES[index]);
      return;
    default:
      return;
  }
  event.preventDefault();
  setTheme(THEMES[target]);
  void nextTick(() => {
    root.value?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  });
}
</script>

<template>
  <button
    v-if="compact"
    type="button"
    class="theme-toggle"
    :aria-label="titleFor(theme)"
    :title="`${titleFor(theme)} · cambiar a ${THEME_LABEL[next]}`"
    @click="setTheme(next)"
  >
    <svg
      class="theme-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path :d="ICON_PATH[theme]" />
    </svg>
  </button>

  <div
    v-else
    ref="root"
    class="theme-switcher"
    :class="{ 'theme-switcher--labels': labels }"
    role="radiogroup"
    aria-label="Tema"
  >
    <button
      v-for="(option, index) in THEMES"
      :key="option"
      type="button"
      role="radio"
      class="theme-switcher__option"
      :class="{ 'is-checked': option === theme }"
      :aria-checked="option === theme"
      :tabindex="option === theme ? 0 : -1"
      :title="titleFor(option)"
      @click="setTheme(option)"
      @keydown="onKeydown($event, index)"
    >
      <svg
        class="theme-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path :d="ICON_PATH[option]" />
      </svg>
      <span class="theme-switcher__label">{{ THEME_LABEL[option] }}</span>
    </button>
  </div>
</template>

<style scoped>
.theme-icon {
  display: block;
  flex: none;
}

/* ── Segmentado (por defecto) ──────────────── */
.theme-switcher {
  display: inline-flex;
  flex: none;
  align-items: stretch;
  gap: 2px;
  height: 28px;
  padding: 2px;
  background: var(--bg-muted);
  border-radius: var(--radius);
  vertical-align: middle;
}

.theme-switcher__option {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 150ms var(--ease),
    border-color 150ms var(--ease),
    color 150ms var(--ease);
}
.theme-switcher--labels .theme-switcher__option {
  gap: 6px;
  width: auto;
  padding: 0 8px 0 7px;
}

/* Sin `labels`, el texto sigue siendo el nombre accesible de cada opción. */
.theme-switcher:not(.theme-switcher--labels) .theme-switcher__label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.theme-switcher__option:hover {
  color: var(--fg);
}
.theme-switcher__option.is-checked {
  background: var(--bg);
  border-color: var(--border);
  color: var(--fg);
}
.theme-switcher__option:focus-visible {
  z-index: 1;
  outline: 2px solid var(--focus);
  outline-offset: 0;
}

/* ── Compacto: un botón que rota el tema ───── */
.theme-toggle {
  appearance: none;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
  transition: background-color 150ms var(--ease);
}
.theme-toggle:hover {
  background: var(--bg-hover);
}
.theme-toggle:active {
  background: var(--bg-muted);
}
.theme-toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
