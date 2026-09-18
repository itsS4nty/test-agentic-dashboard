<script setup lang="ts">
/**
 * Director de demo: escenarios numerados y agrupados por proyecto, cada uno con «Lanzar». El
 * resultado aparece debajo del escenario con su estado y los enlaces «Ver caso».
 *
 * Emite `close` (Plegar). Prop opcional `foco`: escenario (por título o id) al que llevar el foco
 * cuando otro punto de la consola abre el director.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, type ScenarioInfo } from '../api.ts';
import { live } from '../live.ts';
import Button from '../ui/Button.vue';
import RelativeTime from '../ui/RelativeTime.vue';
import StatusDot from '../ui/StatusDot.vue';
import { projectName, projectOrder } from './catalog.ts';
import { errorMessage, openCase } from './format.ts';

interface ScenarioResult {
  ok: boolean;
  message: string;
  caseIds: string[];
  at: string;
}

const props = defineProps<{ foco?: { titulo: string; vez: number } | null }>();
const emit = defineEmits<{ close: [] }>();

const scenarios = ref<ScenarioInfo[]>([]);
const loadError = ref('');
const loading = ref(false);
const running = reactive<Record<string, boolean>>({});
const results = reactive<Record<string, ScenarioResult>>({});
const lastRunId = ref('');

async function load() {
  loading.value = true;
  try {
    scenarios.value = await api.scenarios();
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => live.connected,
  (connected) => {
    if (connected && !scenarios.value.length) void load();
  },
);
watch(
  () => live.resetCount,
  () => {
    for (const id of Object.keys(results)) delete results[id];
    lastRunId.value = '';
  },
);

const numbered = computed(() => {
  const sorted = [...scenarios.value].sort((a, b) => a.order - b.order);
  return new Map(sorted.map((s, i) => [s.id, String(i + 1).padStart(2, '0')]));
});

const groups = computed(() => {
  const byProject = new Map<string, ScenarioInfo[]>();
  for (const s of [...scenarios.value].sort((a, b) => a.order - b.order)) {
    const list = byProject.get(s.project) ?? [];
    list.push(s);
    byProject.set(s.project, list);
  }
  const order = projectOrder();
  return [...byProject.entries()]
    .sort(([a, la], [b, lb]) => {
      const byOrder = la[0].order - lb[0].order;
      return byOrder !== 0 ? byOrder : order.indexOf(a) - order.indexOf(b);
    })
    .map(([project, items]) => ({ project, name: projectName(project), items }));
});

const lastResult = computed(() => (lastRunId.value ? results[lastRunId.value] : undefined));
const lastScenario = computed(() => scenarios.value.find((s) => s.id === lastRunId.value));
const announcement = computed(() =>
  lastResult.value && lastScenario.value ? `${lastScenario.value.title}: ${lastResult.value.message}` : '',
);

async function run(scenario: ScenarioInfo) {
  if (running[scenario.id]) return;
  running[scenario.id] = true;
  lastRunId.value = scenario.id;
  try {
    const res = await api.runScenario(scenario.id);
    results[scenario.id] = { ok: true, message: res.message, caseIds: res.caseIds ?? [], at: new Date().toISOString() };
  } catch (err) {
    results[scenario.id] = { ok: false, message: errorMessage(err), caseIds: [], at: new Date().toISOString() };
  } finally {
    running[scenario.id] = false;
  }
}

// ── Foco pedido desde fuera (estados vacíos) ────────────
const highlighted = ref('');
let pendingFocus = false;
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

function simplify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function focusRequested() {
  const foco = props.foco;
  if (!foco) return;
  if (!scenarios.value.length) {
    pendingFocus = true;
    return;
  }
  pendingFocus = false;
  const wanted = simplify(foco.titulo);
  const scenario =
    scenarios.value.find((s) => s.id === foco.titulo || simplify(s.title) === wanted) ??
    scenarios.value.find((s) => simplify(s.title).includes(wanted));
  if (!scenario) return;
  highlighted.value = scenario.id;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => (highlighted.value = ''), 4000);
  void nextTick(() => {
    const button = document.getElementById(`escenario-${scenario.id}`);
    button?.closest('li')?.scrollIntoView({ block: 'center' });
    button?.focus({ preventScroll: true });
  });
}

watch(() => props.foco?.vez, focusRequested, { immediate: true });
watch(scenarios, () => {
  if (pendingFocus) focusRequested();
});
onBeforeUnmount(() => clearTimeout(highlightTimer));
</script>

<template>
  <aside class="director" aria-labelledby="director-title">
    <header class="director__header">
      <h2 id="director-title" class="director__title">Director de demo</h2>
      <Button variant="ghost" size="sm" @click="emit('close')">Plegar</Button>
    </header>

    <div class="director__body">
      <p v-if="loading && !scenarios.length" class="director__note">
        <StatusDot status="pending" muted label="Cargando escenarios…" />
      </p>
      <div v-else-if="loadError && !scenarios.length" class="director__note director__note--error">
        <StatusDot status="danger" :label="`No se pudieron cargar los escenarios: ${loadError}`" />
        <Button size="sm" @click="load">Reintentar</Button>
      </div>
      <p v-else-if="!scenarios.length" class="director__note">
        <StatusDot muted label="El servidor no ha registrado escenarios." />
      </p>

      <section
        v-for="group in groups"
        :key="group.project"
        class="group"
        :aria-labelledby="`escenarios-${group.project}`"
      >
        <h3 :id="`escenarios-${group.project}`" class="group__title">{{ group.name }}</h3>
        <ol class="scenarios">
          <li
            v-for="scenario in group.items"
            :key="scenario.id"
            class="scenario"
            :class="{ 'is-highlighted': highlighted === scenario.id }"
          >
            <span class="scenario__number" aria-hidden="true">{{ numbered.get(scenario.id) }}</span>
            <div class="scenario__text">
              <p class="scenario__title">{{ scenario.title }}</p>
              <p class="scenario__description" :title="scenario.description">{{ scenario.description }}</p>
            </div>
            <Button
              :id="`escenario-${scenario.id}`"
              class="scenario__run"
              size="sm"
              :loading="running[scenario.id]"
              :aria-label="`Lanzar ${numbered.get(scenario.id) ?? ''} ${scenario.title}`.replace(/\s+/g, ' ')"
              @click="run(scenario)"
            >
              Lanzar
            </Button>

            <div v-if="results[scenario.id]" :key="results[scenario.id].at" class="result">
              <StatusDot
                class="result__status"
                :status="results[scenario.id].ok ? 'success' : 'danger'"
                :label="results[scenario.id].message"
              />
              <p class="result__meta">
                <RelativeTime :at="results[scenario.id].at" />
                <button
                  v-for="(caseId, i) in results[scenario.id].caseIds"
                  :key="caseId"
                  type="button"
                  class="result__link"
                  :title="`Abrir el caso ${caseId}`"
                  @click="openCase(caseId)"
                >
                  Ver caso{{ results[scenario.id].caseIds.length > 1 ? ` ${i + 1}` : '' }}
                </button>
              </p>
            </div>
          </li>
        </ol>
      </section>

      <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    </div>
  </aside>
</template>

<style scoped>
.director {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.director__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  height: 48px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--border);
}
.director__title {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0;
}

.director__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 0 24px;
  scrollbar-width: thin;
}

.director__note {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 16px;
  font-size: var(--text-sm);
}

/* ── Grupos ────────────────────────────────── */
.group + .group {
  margin-top: 8px;
}
.group__title {
  padding: 12px 16px 4px;
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
  color: var(--fg-muted);
}

.scenarios {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ── Escenario ─────────────────────────────── */
.scenario {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  column-gap: 8px;
  padding: 8px 16px;
  transition: background-color 200ms var(--ease);
}
.scenario.is-highlighted {
  background: var(--bg-hover);
}
.scenario__number {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.scenario__text {
  min-width: 0;
}
.scenario__title {
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
}
.scenario__description {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--text-sm);
  line-height: 18px;
  color: var(--fg-muted);
}
.scenario__run {
  align-self: start;
  margin-top: -4px;
}

/* ── Resultado ─────────────────────────────── */
.result {
  grid-column: 2 / -1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}
.result__status {
  font-size: var(--text-sm);
}
.result__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding-left: 16px;
  font-size: var(--text-xs);
  line-height: 20px;
}
.result__link {
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 3px;
  cursor: pointer;
  transition: text-decoration-color 150ms var(--ease);
}
.result__link:hover {
  text-decoration-color: var(--fg);
}
.result__link:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: no-preference) {
  .result {
    animation: fade-in 180ms var(--ease) both;
  }
}
</style>
