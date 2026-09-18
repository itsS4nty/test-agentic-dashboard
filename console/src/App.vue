<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { api } from './api.ts';
import { live, pendingApprovals } from './live.ts';
import { loadAgents, loadPolicies } from './components/catalog.ts';
import DemoDirector from './components/DemoDirector.vue';
import { errorMessage } from './components/format.ts';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import StatusDot from './ui/StatusDot.vue';
import Tabs from './ui/Tabs.vue';
import ThemeSwitcher from './ui/ThemeSwitcher.vue';
import type { TabItem } from './ui/types.ts';
import AgentesView from './views/AgentesView.vue';
import AprobacionesView from './views/AprobacionesView.vue';
import CasosView from './views/CasosView.vue';
import CodigoView from './views/CodigoView.vue';
import DispositivoView from './views/DispositivoView.vue';
import DialView from './views/DialView.vue';
import FacturasView from './views/FacturasView.vue';
import ResumenView from './views/ResumenView.vue';
import SoporteView from './views/SoporteView.vue';


/** Ruta oculta con todos los componentes base, para revisión visual. No aparece en las pestañas. */
const Showcase = defineAsyncComponent(() => import('./ui/Showcase.vue'));

type TabId = 'resumen' | 'dispositivo' | 'codigo' | 'facturas' | 'soporte' | 'casos' | 'aprobaciones' | 'dial' | 'agentes';
type RouteId = TabId | 'muestrario';

interface Tab {
  id: TabId;
  label: string;
  component: Component;
}

const TABS: Tab[] = [
  { id: 'resumen', label: 'Resumen', component: ResumenView },
  { id: 'dispositivo', label: 'Dispositivos', component: DispositivoView },
  { id: 'codigo', label: 'Código', component: CodigoView },
  { id: 'facturas', label: 'Facturas', component: FacturasView },
  { id: 'soporte', label: 'Soporte', component: SoporteView },
  { id: 'casos', label: 'Casos', component: CasosView },
  { id: 'aprobaciones', label: 'Aprobaciones', component: AprobacionesView },
  { id: 'dial', label: 'El dial', component: DialView },
  { id: 'agentes', label: 'Agentes', component: AgentesView },
];

// ── Navegación con location.hash ────────────────────────
function parseHash(): { tab: RouteId; caseId: string | null } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [first, ...rest] = raw.split('/');
  if (first === 'muestrario') return { tab: 'muestrario', caseId: null };
  // Enlaces antiguos a #flota llevan a la pestaña Dispositivos.
  const head = first === 'flota' ? 'dispositivo' : first;
  const tab = TABS.find((t) => t.id === head)?.id ?? 'resumen';
  const caseId = tab === 'casos' && rest.length ? decodeURIComponent(rest.join('/')) : null;
  return { tab, caseId };
}

const initial = parseHash();
const tab = ref<RouteId>(initial.tab);
const caseId = ref<string | null>(initial.caseId);
const lastCaseId = ref<string | null>(initial.caseId);

function hashFor(target: string): string {
  if (target === 'casos' && lastCaseId.value) return `#casos/${encodeURIComponent(lastCaseId.value)}`;
  return `#${target}`;
}

watch([tab, caseId], ([currentTab, currentCase]) => {
  const next = currentTab === 'casos' && currentCase ? `#casos/${encodeURIComponent(currentCase)}` : `#${currentTab}`;
  if (location.hash !== next) location.hash = next;
});

function onHashChange() {
  const parsed = parseHash();
  tab.value = parsed.tab;
  caseId.value = parsed.caseId;
  if (parsed.caseId) lastCaseId.value = parsed.caseId;
}

function selectCase(id: string | null) {
  caseId.value = id;
  lastCaseId.value = id;
}

function onOpenCase(event: Event) {
  const id = (event as CustomEvent<unknown>).detail;
  if (typeof id !== 'string' || !id) return;
  selectCase(id);
  tab.value = 'casos';
  window.scrollTo({ top: 0 });
}

const currentTab = computed(() => TABS.find((t) => t.id === tab.value) ?? TABS[0]);
const pendingCount = computed(() => pendingApprovals().length);

const tabItems = computed<TabItem[]>(() =>
  TABS.map((t) => ({
    id: t.id,
    label: t.label,
    count: t.id === 'aprobaciones' && pendingCount.value > 0 ? pendingCount.value : undefined,
  })),
);

// ── Anchura de la ventana ───────────────────────────────
function useMedia(query: string) {
  const list = window.matchMedia(query);
  const matches = ref(list.matches);
  const update = (event: MediaQueryListEvent) => (matches.value = event.matches);
  list.addEventListener('change', update);
  onBeforeUnmount(() => list.removeEventListener('change', update));
  return matches;
}
/** Desde 1200px el director se acopla a la derecha; por debajo se superpone al contenido. */
const wide = useMedia('(min-width: 1200px)');
const narrow = useMedia('(max-width: 639px)');
/** Por debajo de 768px el selector de tema se queda en un solo botón para que la cabecera quepa. */
const compactHeader = useMedia('(max-width: 767px)');

// ── Director de demo ────────────────────────────────────
const DIRECTOR_KEY = 'consola.director';
function readDirectorPref(): boolean {
  try {
    const stored = localStorage.getItem(DIRECTOR_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    /* almacenamiento no disponible */
  }
  return window.innerWidth >= 1280;
}
const directorOpen = ref(readDirectorPref());
watch(directorOpen, (open) => {
  try {
    localStorage.setItem(DIRECTOR_KEY, open ? '1' : '0');
  } catch {
    /* almacenamiento no disponible */
  }
});
const directorDocked = computed(() => directorOpen.value && wide.value);

/** Escenario al que llevar el foco cuando un estado vacío abre el director. */
const directorFoco = ref<{ titulo: string; vez: number } | null>(null);
function onAbrirDirector(event: Event) {
  const escenario = (event as CustomEvent<unknown>).detail;
  directorOpen.value = true;
  if (typeof escenario === 'string' && escenario) {
    directorFoco.value = { titulo: escenario, vez: (directorFoco.value?.vez ?? 0) + 1 };
  }
}

/** Superpuesto (menos de 1200px), Escape pliega el director y devuelve el foco a su botón. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !directorOpen.value || wide.value || event.defaultPrevented) return;
  directorOpen.value = false;
  document.getElementById('director-toggle')?.focus();
}

// ── Reinicio de la demo ─────────────────────────────────
const resetState = ref<'idle' | 'confirm' | 'busy'>('idle');
const flash = ref('');
const flashFallo = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

async function onReset() {
  if (resetState.value === 'idle') {
    resetState.value = 'confirm';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      if (resetState.value === 'confirm') resetState.value = 'idle';
    }, 4000);
    return;
  }
  if (resetState.value !== 'confirm') return;
  clearTimeout(resetTimer);
  resetState.value = 'busy';
  flash.value = '';
  try {
    await api.reset();
    selectCase(null);
    flashFallo.value = false;
    flash.value = 'Demo reiniciada: estado, políticas y proyectos vuelven al punto de partida.';
  } catch (err) {
    flashFallo.value = true;
    flash.value = `No se pudo reiniciar la demo: ${errorMessage(err)}`;
  } finally {
    resetState.value = 'idle';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash.value = ''), 5000);
  }
}

const resetLabel = computed(() => (resetState.value === 'confirm' ? 'Confirmar reinicio' : 'Reiniciar demo'));

// ── Modo de IA ──────────────────────────────────────────
const aiMode = computed(() => {
  const s = live.status;
  if (!s) return { variant: 'neutral' as const, text: 'Conectando…', title: 'Esperando al servidor' };
  const title = `${s.providerLabel} · razonamiento: ${s.models.reasoning} · rápido: ${s.models.fast}`;
  if (s.provider === 'mock') return { variant: 'neutral' as const, text: 'Simulado', title };
  return { variant: 'outline' as const, text: `IA real · ${s.models.reasoning}`, title };
});

watch(
  pendingCount,
  (count) => {
    document.title = count ? `(${count}) Consola de agentes` : 'Consola de agentes';
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('open-case', onOpenCase);
  window.addEventListener('abrir-director', onAbrirDirector);
  window.addEventListener('keydown', onKeydown);
  void loadPolicies();
  void loadAgents();
});
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange);
  window.removeEventListener('open-case', onOpenCase);
  window.removeEventListener('abrir-director', onAbrirDirector);
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(resetTimer);
  clearTimeout(flashTimer);
});
</script>

<template>
  <div class="app">
    <a class="skip-link" href="#contenido">Saltar al contenido</a>

    <header class="topbar">
      <a class="brand" href="#resumen" aria-label="Consola de agentes · Demo">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Consola de agentes</span>
        <span class="brand__sep" aria-hidden="true">/</span>
        <span class="brand__env">Demo</span>
      </a>

      <div class="topbar__actions">
        <StatusDot
          class="connection"
          role="status"
          :status="live.connected ? 'success' : 'danger'"
          :label="live.connected ? 'En vivo' : 'Sin conexión'"
          muted
        />
        <Badge class="ai-mode" :variant="aiMode.variant" :title="aiMode.title">{{ aiMode.text }}</Badge>
        <ThemeSwitcher class="theme" :compact="compactHeader" />
        <Button
          id="director-toggle"
          :size="narrow ? 'sm' : 'md'"
          :aria-pressed="directorOpen"
          aria-controls="director-panel"
          @click="directorOpen = !directorOpen"
        >
          Director de demo
        </Button>
        <Button
          class="reset"
          :size="narrow ? 'sm' : 'md'"
          :variant="resetState === 'confirm' ? 'danger' : 'secondary'"
          :loading="resetState === 'busy'"
          @click="onReset"
        >
          {{ resetLabel }}
        </Button>
      </div>
    </header>

    <div class="shell" :class="{ 'shell--docked': directorDocked }">
      <div class="tabs-bar">
        <div class="container">
          <Tabs class="tabs-bar__tabs" :items="tabItems" :model-value="tab" :href-for="hashFor" aria-label="Secciones" />
        </div>
      </div>

      <main id="contenido" class="main" tabindex="-1">
        <div class="container">
          <Showcase v-if="tab === 'muestrario'" />
          <CasosView v-else-if="tab === 'casos'" :case-id="caseId" @select="selectCase" />
          <component :is="currentTab.component" v-else :key="tab" />
        </div>
      </main>
    </div>

    <DemoDirector
      v-if="directorOpen"
      id="director-panel"
      class="panel"
      :class="directorDocked ? 'panel--docked' : 'panel--overlay'"
      :foco="directorFoco"
      @close="directorOpen = false"
    />

    <div v-if="flash" class="toast" role="status">
      <StatusDot :status="flashFallo ? 'danger' : 'success'" :label="flash" />
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: var(--bg);
}

.skip-link {
  position: absolute;
  z-index: 100;
  top: 12px;
  left: 12px;
  padding: 6px 12px;
  background: var(--primary);
  color: var(--primary-fg);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
  transform: translateY(-200%);
}
.skip-link:focus {
  transform: none;
}

/* ── Cabecera ──────────────────────────────── */
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--header-h);
  padding: 0 24px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-radius: var(--radius-sm);
  color: var(--fg);
  font-size: var(--text-base);
  line-height: 20px;
  text-decoration: none;
  white-space: nowrap;
}
.brand__mark {
  flex: none;
  width: 18px;
  height: 18px;
  background: var(--fg);
  border-radius: var(--radius-sm);
}
.brand__name {
  font-weight: 600;
  letter-spacing: -0.01em;
}
.brand__sep {
  color: var(--border-strong);
  font-size: var(--text-md);
}
.brand__env {
  color: var(--fg-muted);
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.connection {
  margin-right: 8px;
  font-size: var(--text-sm);
  white-space: nowrap;
}
.ai-mode {
  max-width: 240px;
  margin-right: 8px;
}
.theme {
  margin-right: 8px;
}
/* Ancho de «Confirmar reinicio»: al cambiar el texto no se mueve el resto de la cabecera. */
.reset {
  min-width: 144px;
}

/* ── Pestañas y contenido ──────────────────── */
.shell {
  min-width: 0;
}
.shell--docked {
  margin-right: 360px;
}

/* Contenido de 1200px más 32px de margen a cada lado. */
.container {
  width: 100%;
  max-width: 1264px;
  margin: 0 auto;
  padding: 0 32px;
}

.tabs-bar {
  position: sticky;
  top: var(--header-h);
  z-index: 30;
  height: var(--tabs-h);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.tabs-bar .container {
  height: 100%;
}
.tabs-bar__tabs {
  height: 100%;
}

.main {
  padding: 32px 0 80px;
  outline: none;
}

/* ── Director ──────────────────────────────── */
.panel {
  position: fixed;
  z-index: 35;
}
.panel--docked {
  top: var(--header-h);
  right: 0;
  bottom: 0;
  width: 360px;
  border-left: 1px solid var(--border);
}
.panel--overlay {
  z-index: 45;
  top: calc(var(--header-h) + var(--tabs-h) + 8px);
  right: 16px;
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 24px);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
}
@media (prefers-reduced-motion: no-preference) {
  .panel--overlay {
    animation: fade-in 160ms var(--ease) both;
  }
}

/* ── Aviso tras reiniciar ──────────────────── */
.toast {
  position: fixed;
  z-index: 50;
  left: 50%;
  bottom: 24px;
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 10px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  font-size: var(--text-sm);
  transform: translateX(-50%);
}

/* ── Anchos pequeños ───────────────────────── */
@media (max-width: 899px) {
  .ai-mode {
    display: none;
  }
}
/* Por debajo de 768px: tema en un solo botón y conexión solo con el punto (el texto queda para lectores de pantalla). */
@media (max-width: 767px) {
  .connection {
    margin-right: 4px;
  }
  .theme {
    margin-right: 0;
  }
  .connection :deep(.status__dot) {
    margin-top: 0;
  }
  .connection :deep(.status__label) {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
@media (max-width: 639px) {
  .topbar {
    gap: 8px;
    padding: 0 16px;
  }
  .topbar__actions {
    gap: 6px;
  }
  .brand__name,
  .brand__sep,
  .brand__env {
    display: none;
  }
  .connection {
    margin-right: 0;
  }
  .reset {
    min-width: 132px;
  }
  .container {
    padding: 0 16px;
  }
  .main {
    padding: 24px 0 64px;
  }
  .panel--overlay {
    right: 8px;
    width: calc(100vw - 16px);
  }
}
/* En los teléfonos más estrechos no cabe: se aplica el tema guardado o el del sistema. */
@media (max-width: 370px) {
  .theme {
    display: none;
  }
}
</style>
