/**
 * Tema de la consola: fuente única de verdad.
 *
 * - `system` sigue a `prefers-color-scheme` (sin atributo en `<html>`); `light` y `dark` lo fuerzan
 *   con `data-theme` en `<html>`. `styles.css` define los tres casos.
 * - Se guarda en `localStorage` con la clave `consola.tema`. Si el almacenamiento no está
 *   disponible, el tema funciona igual durante la sesión.
 * - `applySavedTheme()` se llama en `main.ts` antes de montar la app, para que no haya parpadeo.
 * - `useTheme()` da el tema reactivo para leerlo y cambiarlo desde cualquier componente.
 */
import { computed, ref, type WritableComputedRef } from 'vue';

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export const THEME_LABEL: Record<Theme, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Oscuro',
};

const STORAGE_KEY = 'consola.tema';

const current = ref<Theme>('system');
let listening = false;

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* almacenamiento no disponible */
  }
  return 'system';
}

function writeStored(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* almacenamiento no disponible */
  }
}

function applyToDocument(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/**
 * Aplica el tema sin transiciones: los controles con `transition` en color o fondo cambiarían con
 * retraso respecto al resto de la página.
 */
function applyWithoutTransitions(theme: Theme) {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  applyToDocument(theme);
  // Fuerza el recálculo de estilos con las transiciones desactivadas antes de restaurarlas.
  void document.body.offsetHeight;
  requestAnimationFrame(() => style.remove());
}

/** Cambios hechos en otra pestaña de la consola. */
function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const next = readStored();
  if (next === current.value) return;
  current.value = next;
  applyWithoutTransitions(next);
}

/** Lee el tema guardado y lo aplica a `<html>`. Llamar una vez al arrancar, antes de montar la app. */
export function applySavedTheme(): Theme {
  current.value = readStored();
  applyToDocument(current.value);
  if (!listening) {
    window.addEventListener('storage', onStorage);
    listening = true;
  }
  return current.value;
}

/** Cambia el tema, lo aplica y lo guarda. */
export function setTheme(theme: Theme) {
  if (!isTheme(theme) || theme === current.value) return;
  current.value = theme;
  applyWithoutTransitions(theme);
  writeStored(theme);
}

export interface UseTheme {
  /** Tema elegido; se puede usar con `v-model`. */
  theme: WritableComputedRef<Theme>;
  setTheme: (theme: Theme) => void;
}

/** Tema reactivo compartido por toda la consola. */
export function useTheme(): UseTheme {
  const theme = computed<Theme>({
    get: () => current.value,
    set: setTheme,
  });
  return { theme, setTheme };
}
