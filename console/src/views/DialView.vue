<script setup lang="ts">
/**
 * El dial (docs/DESIGN.md § 6).
 *
 * Una tarjeta por proyecto con una tabla de acciones: nombre legible e id, riesgo, nivel
 * (control segmentado), condiciones y excepciones. Debajo, las excepciones por cliente con su
 * alta y baja. Los cambios se aplican en caliente: el nivel de una acción cambia al instante y
 * vuelve atrás con un mensaje si el servidor lo rechaza; lo que se ve es lo que confirma el
 * servidor (y lo que llega por `live.policy` a través de `catalog`).
 *
 * La tabla se pliega según el ancho de la tarjeta: a partir de 1160px, cinco columnas; por
 * debajo, el riesgo pasa junto al nombre y las excepciones bajo las condiciones; por debajo de
 * 760px, cada acción es un bloque.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import type { ActionPolicy, AutonomyLevel, PolicyOverride, RiskClass, Scope } from '../../../platform/contracts.ts';
import { api } from '../api.ts';
import {
  catalog,
  clientName,
  clients,
  describeScope,
  loadPolicies,
  projectName,
  projectOrder,
  setPolicyConfig,
} from '../components/catalog.ts';
import { LEVEL_HINT, LEVEL_LABEL, LEVELS, conditionEffect, errorMessage } from '../components/format.ts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedControl,
  StatusDot,
  decisionBadge,
  riskPresentation,
  type SegmentedOption,
} from '../ui/index.ts';
import LoadState from './project/LoadState.vue';

onMounted(() => void loadPolicies());

// ── Nombres legibles ────────────────────────────────────
// La API solo da el nombre técnico; en la tabla se muestra un nombre corto en español.
const NOMBRE_ACCION: Record<string, string> = {
  dispositivo_get_fleet_status: 'Consultar el estado de los dispositivos',
  dispositivo_get_device: 'Ver la ficha de un dispositivo',
  dispositivo_get_device_history: 'Ver el historial de un dispositivo',
  dispositivo_restart_device: 'Reiniciar un dispositivo',
  dispositivo_notify_store: 'Avisar a la tienda',
  dispositivo_open_field_ticket: 'Pedir visita de técnico',
  dispositivo_report_suspected_bug: 'Reportar un posible bug',
  bugs_list_files: 'Listar los ficheros del repositorio',
  bugs_read_file: 'Leer un fichero',
  bugs_search_code: 'Buscar en el código',
  bugs_run_tests: 'Ejecutar los tests',
  bugs_propose_fix: 'Proponer un arreglo',
  bugs_open_pr: 'Abrir un pull request',
  facturas_get_invoice: 'Leer una factura',
  facturas_get_contract: 'Leer un contrato',
  facturas_record_finding: 'Registrar un hallazgo',
  facturas_propose_correction: 'Proponer una corrección',
  soporte_get_ticket: 'Leer un ticket',
  soporte_lookup_customer: 'Consultar la ficha de la tienda',
  soporte_classify_ticket: 'Clasificar un ticket',
  soporte_draft_reply: 'Redactar un borrador',
  soporte_send_reply: 'Enviar la respuesta',
  soporte_escalate_ticket: 'Escalar a una persona',
  soporte_flag_suspicious: 'Marcar como sospechoso',
  soporte_issue_credit: 'Emitir un abono',
  plataforma_get_request: 'Leer la solicitud de agente',
  plataforma_write_file: 'Escribir un fichero del agente',
  plataforma_validate: 'Validar el agente',
  plataforma_open_pr: 'Abrir el pull request del agente',
};

function nombreLegible(name: string, description: string): string {
  // El proyecto de dispositivos se llamó `flota`: un servidor con los nombres antiguos también vale.
  const conocido = NOMBRE_ACCION[name] ?? NOMBRE_ACCION[name.replace(/^flota_/, 'dispositivo_')];
  if (conocido) return conocido;
  const frase = description.split(/[.(:;]/)[0]?.trim();
  if (frase && frase.length <= 60) return frase;
  const sinProyecto = name.includes('_') ? name.slice(name.indexOf('_') + 1) : name;
  const texto = sinProyecto.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const minuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** «Pan de Pueblo · Pide permiso». Si no cabe, parte antes de «· nivel», nunca dentro. */
const exceptionLabel = (o: PolicyOverride) =>
  `${describeScope(o.scope)} ·\u00a0${LEVEL_LABEL[o.level].replace(/ /g, '\u00a0')}`;

/** Trozos de un nombre técnico cortados tras cada guion bajo, para poder partir la línea ahí. */
const idParts = (name: string) => name.split(/(?<=_)/);

const levelOptions: SegmentedOption<AutonomyLevel>[] = LEVELS.map((level) => ({
  value: level,
  label: LEVEL_LABEL[level],
  title: LEVEL_HINT[level],
}));

// ── Avisos para lectores de pantalla ────────────────────
const announcement = ref('');
function announce(text: string) {
  announcement.value = '';
  void nextTick(() => (announcement.value = text));
}

// ── Filas ───────────────────────────────────────────────
interface ActionRow {
  name: string;
  label: string;
  project: string;
  description: string;
  risk?: RiskClass;
  policy?: ActionPolicy;
  level: AutonomyLevel;
  configured: boolean;
  overrides: PolicyOverride[];
}

const config = computed(() => catalog.policies?.config);

const rows = computed<ActionRow[]>(() => {
  const info = catalog.policies;
  if (!info) return [];
  const registry = new Map(info.actions.map((a) => [a.name, a]));
  const names = [
    ...info.actions.map((a) => a.name),
    ...info.config.actions.map((p) => p.action).filter((name) => !registry.has(name)),
  ];
  return names.map((name) => {
    const tool = registry.get(name);
    const policy = info.config.actions.find((p) => p.action === name);
    const risk = tool?.risk;
    const description = tool?.description ?? '';
    return {
      name,
      label: nombreLegible(name, description),
      project: tool?.project ?? name.split('_')[0],
      description,
      risk,
      policy,
      level: policy?.level ?? (risk === 'read' ? 'auto' : 'approve'),
      configured: !!policy,
      overrides: info.config.overrides.filter((o) => o.action === name),
    };
  });
});

function groupByProject(list: ActionRow[]) {
  const order = projectOrder();
  const rank = (p: string) => (order.indexOf(p) < 0 ? 99 : order.indexOf(p));
  const byProject = new Map<string, ActionRow[]>();
  for (const row of list) {
    const items = byProject.get(row.project) ?? [];
    items.push(row);
    byProject.set(row.project, items);
  }
  return [...byProject.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([project, items]) => ({ project, name: projectName(project), items }));
}

// ── Filtro y grupos ─────────────────────────────────────
const showReads = ref(false);
const readCount = computed(() => rows.value.filter((r) => r.risk === 'read').length);
const groups = computed(() => groupByProject(rows.value.filter((r) => showReads.value || r.risk !== 'read')));
const actionOptions = computed(() => groupByProject(rows.value));
const labelOf = (action: string) => rows.value.find((r) => r.name === action)?.label ?? action;

// ── Confirmación «Aplicado» ─────────────────────────────
const saving = reactive<Record<string, boolean>>({});
const saved = reactive<Record<string, boolean>>({});
const rowErrors = reactive<Record<string, string>>({});
const requestSeq: Record<string, number> = {};
const savedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function flashSaved(key: string) {
  clearTimeout(savedTimers[key]);
  saved[key] = true;
  savedTimers[key] = setTimeout(() => delete saved[key], 2200);
}

// ── Cambiar el nivel de una acción ──────────────────────
async function setLevel(action: string, level: AutonomyLevel) {
  const cfg = config.value;
  if (!cfg) return;
  const existing = cfg.actions.find((p) => p.action === action);
  const previous = existing?.level;
  // Cambio optimista: el control cambia al instante y vuelve atrás si el servidor falla.
  if (existing) existing.level = level;
  else cfg.actions.push({ action, level });

  const seq = (requestSeq[action] ?? 0) + 1;
  requestSeq[action] = seq;
  saving[action] = true;
  delete rowErrors[action];
  delete saved[action];
  try {
    const next = await api.setActionLevel(action, level);
    if (requestSeq[action] !== seq) return;
    setPolicyConfig(next);
    flashSaved(action);
    announce(`${labelOf(action)}: ${LEVEL_LABEL[level]}. Aplicado.`);
  } catch (err) {
    if (requestSeq[action] !== seq) return;
    const current = catalog.policies?.config;
    const entry = current?.actions.find((p) => p.action === action);
    if (entry && previous) entry.level = previous;
    else if (current && !previous) current.actions = current.actions.filter((p) => p.action !== action);
    rowErrors[action] = errorMessage(err);
    announce(`No se aplicó el cambio en ${labelOf(action)}: ${rowErrors[action]}`);
  } finally {
    if (requestSeq[action] === seq) saving[action] = false;
  }
}

// ── Excepciones por cliente o tienda ────────────────────
const overrideKey = (scope: Scope, action: string) => `${scope.clientId ?? ''}|${scope.siteId ?? ''}|${action}`;

const overrideRows = computed(() =>
  (config.value?.overrides ?? [])
    .map((o) => ({
      ...o,
      key: overrideKey(o.scope, o.action),
      kind: o.scope.siteId ? 'Tienda' : 'Cliente',
      defaultLevel: rows.value.find((r) => r.name === o.action)?.level,
    }))
    .sort((a, b) => describeScope(a.scope).localeCompare(describeScope(b.scope)) || a.action.localeCompare(b.action)),
);

const overrideBusy = reactive<Record<string, boolean>>({});
const removing = reactive<Record<string, boolean>>({});
const overrideError = ref('');
/** Dónde enseñar el último fallo: en la fila de esa excepción o en el formulario de alta. */
const overrideErrorAt = ref('');

async function saveOverride(scope: Scope, action: string, level: AutonomyLevel | null) {
  const key = overrideKey(scope, action);
  overrideBusy[key] = true;
  overrideError.value = '';
  overrideErrorAt.value = '';
  try {
    setPolicyConfig(await api.setOverride(scope, action, level));
    flashSaved(key);
    announce(
      level
        ? `Excepción de ${describeScope(scope)}: ${LEVEL_LABEL[level]}. Aplicado.`
        : `Excepción de ${describeScope(scope)} quitada.`,
    );
    return true;
  } catch (err) {
    overrideError.value = errorMessage(err);
    overrideErrorAt.value = key;
    announce(`No se pudo guardar la excepción: ${overrideError.value}`);
    return false;
  } finally {
    overrideBusy[key] = false;
  }
}

/** Nivel de una excepción: mientras se guarda, ignora cambios nuevos sin quitarle el foco. */
function turnOverride(o: { scope: Scope; action: string; key: string }, level: AutonomyLevel) {
  if (overrideBusy[o.key]) return;
  void saveOverride(o.scope, o.action, level);
}

async function removeOverride(o: { scope: Scope; action: string; key: string }) {
  if (overrideBusy[o.key]) return;
  removing[o.key] = true;
  try {
    await saveOverride(o.scope, o.action, null);
  } finally {
    delete removing[o.key];
  }
}

const draft = reactive({ clientId: '', siteId: '', action: '', level: 'approve' as AutonomyLevel });
const draftSites = computed(() => clients().find((c) => c.id === draft.clientId)?.sites ?? []);
const draftDefault = computed(() => rows.value.find((r) => r.name === draft.action)?.level);
const draftScopeName = computed(() => {
  if (!draft.clientId) return 'este ámbito';
  return draft.siteId ? describeScope({ siteId: draft.siteId }) : clientName(draft.clientId);
});
const adding = ref(false);

async function addOverride() {
  if (!draft.clientId || !draft.action || adding.value) return;
  // Una excepción de tienda se identifica por la tienda; la de cliente, por el cliente.
  const scope: Scope = draft.siteId ? { siteId: draft.siteId } : { clientId: draft.clientId };
  adding.value = true;
  const ok = await saveOverride(scope, draft.action, draft.level);
  adding.value = false;
  if (!ok) overrideErrorAt.value = 'alta';
  if (ok) {
    draft.action = '';
    draft.siteId = '';
  }
}

// ── Volver a policies.yaml ──────────────────────────────
const resetting = ref(false);
const resetDone = ref(false);
const resetError = ref('');
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function resetConfig() {
  resetting.value = true;
  resetError.value = '';
  resetDone.value = false;
  try {
    setPolicyConfig(await api.resetPolicies());
    resetDone.value = true;
    announce('Configuración restaurada.');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (resetDone.value = false), 2500);
  } catch (err) {
    resetError.value = errorMessage(err);
    announce(`No se pudo restaurar la configuración: ${resetError.value}`);
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <div class="dial">
    <PageHeader title="El dial" description="El nivel es un techo: las condiciones solo pueden bajarlo o bloquear.">
      <template #actions>
        <StatusDot v-if="resetDone" class="header-note" status="success" muted label="Configuración restaurada" />
        <StatusDot
          v-else-if="resetError"
          class="header-note"
          status="danger"
          :label="`No se pudo restaurar: ${resetError}`"
        />
        <Button
          :loading="resetting"
          :disabled="!catalog.policies"
          title="Restaura config/policies.yaml: niveles y excepciones"
          @click="resetConfig"
        >
          Volver a la configuración
        </Button>
      </template>
    </PageHeader>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>

    <div v-if="!catalog.policies" class="policies-load">
      <LoadState
        :loading="!catalog.policiesError"
        :error="catalog.policiesError || null"
        :has-data="false"
        what="la política"
      />
      <div v-if="catalog.policiesError">
        <Button size="sm" @click="loadPolicies(true)">Reintentar</Button>
      </div>
    </div>

    <template v-else>
      <div class="stack">
        <div class="toolbar">
          <button
            type="button"
            role="switch"
            class="switch"
            :aria-checked="showReads"
            @click="showReads = !showReads"
          >
            <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
            <span class="switch__label">Mostrar acciones de solo lectura</span>
            <span class="switch__count">{{ readCount }}</span>
          </button>
        </div>

        <!-- Una tarjeta por proyecto -->
        <Card v-for="group in groups" :key="group.project" :title="group.name" :padded="false">
          <div class="dial-table">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col" class="col-action">Acción</th>
                  <th scope="col" class="col-risk">Riesgo</th>
                  <th scope="col" class="col-level">Nivel</th>
                  <th scope="col" class="col-cond">
                    <span class="only-wide">Condiciones</span>
                    <span class="only-fold">Condiciones y excepciones</span>
                  </th>
                  <th scope="col" class="col-exc">Excepciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in group.items" :key="row.name">
                  <td class="col-action">
                    <div class="line line--action">
                      <span :id="`accion-${row.name}`" class="name" :title="row.description || undefined">
                        {{ row.label }}
                      </span>
                      <span v-if="row.risk" class="fold-risk only-fold">
                        <Badge
                          v-if="riskPresentation(row.risk).badge"
                          variant="outline"
                          :label="riskPresentation(row.risk).label"
                        />
                        <span v-else class="risk-text">{{ riskPresentation(row.risk).label }}</span>
                      </span>
                    </div>
                    <div class="meta">
                      <code class="tech"><template v-for="(part, i) in idParts(row.name)" :key="i">{{ part }}<wbr /></template></code>
                    </div>
                  </td>

                  <td class="col-risk">
                    <div class="line">
                      <template v-if="row.risk">
                        <Badge
                          v-if="riskPresentation(row.risk).badge"
                          variant="outline"
                          :label="riskPresentation(row.risk).label"
                        />
                        <span v-else class="risk-text">{{ riskPresentation(row.risk).label }}</span>
                      </template>
                      <span v-else class="none">—</span>
                    </div>
                  </td>

                  <td class="col-level">
                    <div class="line">
                      <SegmentedControl
                        size="sm"
                        :options="levelOptions"
                        :model-value="row.level"
                        :aria-label="`Nivel de ${row.label}`"
                        @update:model-value="setLevel(row.name, $event)"
                      />
                    </div>
                    <div class="meta">
                      <StatusDot v-if="saving[row.name]" status="pending" muted label="Guardando…" />
                      <StatusDot
                        v-else-if="rowErrors[row.name]"
                        status="danger"
                        :label="`No se aplicó: ${rowErrors[row.name]}. Vuelve a «${LEVEL_LABEL[row.level]}».`"
                      />
                      <StatusDot
                        v-else-if="saved[row.name]"
                        status="success"
                        muted
                        label="Aplicado"
                        title="Aplicado en caliente: vale para la siguiente acción"
                      />
                      <span
                        v-else-if="!row.configured"
                        title="Sin entrada en config/policies.yaml: se usa el nivel por defecto"
                      >
                        Por defecto
                      </span>
                    </div>
                  </td>

                  <td class="col-cond">
                    <ul v-if="row.policy?.conditions?.length" class="conds">
                      <li
                        v-for="cond in row.policy.conditions"
                        :key="cond.label"
                        class="cond"
                        :title="`${conditionEffect(cond.decision)} · Predicados: ${cond.when.join(' y ')}`"
                      >
                        Si {{ minuscula(cond.label) }}
                        <span class="cond__effect">
                          <span class="cond__arrow" aria-hidden="true">→</span>
                          <Badge
                            class="cond__badge"
                            :variant="decisionBadge(cond.decision).variant"
                            :label="decisionBadge(cond.decision).label"
                          />
                        </span>
                      </li>
                    </ul>
                    <div v-else class="line cond-empty" :class="{ 'only-wide': row.overrides.length }">
                      <span class="none">—</span>
                    </div>
                    <div v-if="row.overrides.length" class="line excs only-fold">
                      <Badge
                        v-for="o in row.overrides"
                        :key="overrideKey(o.scope, o.action)"
                        class="exc-badge"
                        variant="outline"
                        :label="exceptionLabel(o)"
                        :title="`${describeScope(o.scope)}: «${LEVEL_LABEL[o.level]}» en lugar de «${LEVEL_LABEL[row.level]}»`"
                      />
                    </div>
                  </td>

                  <td class="col-exc">
                    <div class="line excs">
                      <template v-if="row.overrides.length">
                        <Badge
                          v-for="o in row.overrides"
                          :key="overrideKey(o.scope, o.action)"
                          class="exc-badge"
                          variant="outline"
                          :label="exceptionLabel(o)"
                          :title="`${describeScope(o.scope)}: «${LEVEL_LABEL[o.level]}» en lugar de «${LEVEL_LABEL[row.level]}»`"
                        />
                      </template>
                      <span v-else class="none">—</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <!-- Excepciones por cliente -->
      <Card
        title="Excepciones por cliente"
        description="Sustituyen el nivel por defecto para un cliente o una tienda."
        :padded="false"
      >
        <div v-if="overrideRows.length" class="dial-table">
          <table class="table">
            <thead>
              <tr>
                <th scope="col" class="col-scope">Ámbito</th>
                <th scope="col" class="col-x-action">Acción</th>
                <th scope="col" class="col-level">Nivel</th>
                <th scope="col" class="col-remove"><span class="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in overrideRows" :key="o.key">
                <td class="col-scope">
                  <div class="line">
                    <span class="name">{{ describeScope(o.scope) }}</span>
                  </div>
                  <div class="meta">{{ o.kind }}</div>
                </td>

                <td class="col-x-action">
                  <div class="line">
                    <span class="action-label">{{ labelOf(o.action) }}</span>
                  </div>
                  <div class="meta">
                    <code class="tech"><template v-for="(part, i) in idParts(o.action)" :key="i">{{ part }}<wbr /></template></code>
                  </div>
                </td>

                <td class="col-level">
                  <div class="line">
                    <SegmentedControl
                      size="sm"
                      :options="levelOptions"
                      :model-value="o.level"
                      :aria-label="`Nivel de ${labelOf(o.action)} para ${describeScope(o.scope)}`"
                      @update:model-value="turnOverride(o, $event)"
                    />
                  </div>
                  <div class="meta">
                    <StatusDot v-if="overrideBusy[o.key]" status="pending" muted label="Guardando…" />
                    <StatusDot
                      v-else-if="overrideError && overrideErrorAt === o.key"
                      status="danger"
                      :label="`No se pudo guardar: ${overrideError}. Sigue en «${LEVEL_LABEL[o.level]}».`"
                    />
                    <StatusDot v-else-if="saved[o.key]" status="success" muted label="Aplicado" />
                    <span v-else-if="o.defaultLevel">Por defecto: {{ LEVEL_LABEL[o.defaultLevel] }}</span>
                  </div>
                </td>

                <td class="col-remove">
                  <div class="line line--end">
                    <Button
                      size="sm"
                      :loading="removing[o.key]"
                      :aria-label="`Quitar la excepción de ${labelOf(o.action)} para ${describeScope(o.scope)}`"
                      @click="removeOverride(o)"
                    >
                      Quitar
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="no-exceptions">
          <EmptyState compact title="Sin excepciones: todos los clientes usan el nivel por defecto." />
        </div>

        <template #footer>
          <div class="add-wrap">
          <form class="add" aria-label="Añadir excepción" @submit.prevent="addOverride">
            <label class="field">
              <span class="field__label">Cliente</span>
              <select v-model="draft.clientId" required @change="draft.siteId = ''">
                <option value="" disabled>Elige cliente</option>
                <option v-for="c in clients()" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Tienda</span>
              <select v-model="draft.siteId" :disabled="!draft.clientId">
                <option value="">Todas sus tiendas</option>
                <option v-for="s in draftSites" :key="s.id" :value="s.id">{{ s.name }} ({{ s.city }})</option>
              </select>
            </label>
            <label class="field field--wide">
              <span class="field__label">Acción</span>
              <select v-model="draft.action" required>
                <option value="" disabled>Elige acción</option>
                <optgroup v-for="g in actionOptions" :key="g.project" :label="g.name">
                  <option v-for="r in g.items" :key="r.name" :value="r.name">{{ r.label }}</option>
                </optgroup>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Nivel</span>
              <select v-model="draft.level">
                <option v-for="level in LEVELS" :key="level" :value="level">{{ LEVEL_LABEL[level] }}</option>
              </select>
            </label>
            <div class="add__submit">
              <Button type="submit" variant="primary" :loading="adding" :disabled="!draft.clientId || !draft.action">
                Añadir excepción
              </Button>
            </div>

            <p v-if="overrideError && overrideErrorAt === 'alta'" class="add__note">
              <StatusDot status="danger" :label="`No se pudo guardar la excepción: ${overrideError}`" />
            </p>
            <p v-else-if="draftDefault" class="add__note">
              Sustituye a «{{ LEVEL_LABEL[draftDefault] }}» en {{ draftScopeName }}.
            </p>
          </form>
          </div>
        </template>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.dial {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.header-note {
  font-size: var(--text-sm);
}

.policies-load {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.policies-load > :first-child {
  align-self: stretch;
}

/* ── Interruptor de solo lectura ───────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  min-height: 32px;
}
.switch {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 0;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg);
  font-size: var(--text-sm);
  line-height: 20px;
  cursor: pointer;
}
.switch__track {
  position: relative;
  flex: none;
  width: 28px;
  height: 16px;
  border: 1px solid var(--fg-subtle);
  border-radius: 8px;
  background: var(--bg-muted);
  transition:
    background-color 150ms var(--ease),
    border-color 150ms var(--ease);
}
.switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--fg-subtle);
  transition:
    transform 150ms var(--ease),
    background-color 150ms var(--ease);
}
.switch[aria-checked='true'] .switch__track {
  border-color: var(--primary);
  background: var(--primary);
}
.switch[aria-checked='true'] .switch__thumb {
  transform: translateX(12px);
  background: var(--primary-fg);
}
.switch:hover .switch__track {
  border-color: var(--fg);
}
.switch[aria-checked='true']:hover .switch__track {
  border-color: var(--primary);
}
.switch__count {
  color: var(--fg-subtle);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* ── Tablas ────────────────────────────────────────────── */
.dial-table {
  container: dial-table / inline-size;
  min-width: 0;
}
.dial-table table.table {
  table-layout: fixed;
}
.dial-table table.table td {
  vertical-align: top;
}

/* Primera línea de cada celda a 28px (la altura del control) y línea de metadatos de 20px debajo. */
.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 28px;
  line-height: 20px;
}
.line--end {
  justify-content: flex-end;
}
/* Nombre de la acción: parte línea él solo; el riesgo plegado se queda a la derecha. */
.line--action {
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 8px;
  padding-top: 4px;
}
.line--action .name {
  flex: 1 1 auto;
  min-width: 0;
}
.fold-risk {
  flex: none;
  font-size: var(--text-xs);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
  min-width: 0;
  min-height: 20px;
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
}

.name {
  font-weight: 500;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.action-label {
  color: var(--fg);
  overflow-wrap: anywhere;
}
.tech {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}
.risk-text {
  color: var(--fg-muted);
}
.none {
  color: var(--fg-subtle);
}

.conds {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cond {
  padding: 4px 0;
  line-height: 20px;
  color: var(--fg-muted);
  text-wrap: pretty;
}
/* La flecha y la decisión van juntas: si no caben, bajan las dos a la línea siguiente. */
.cond__effect {
  white-space: nowrap;
}
.cond__arrow {
  color: var(--fg-subtle);
}
/* El badge mide lo mismo que la línea: alineado arriba no la engorda. */
.cond__badge {
  vertical-align: top;
}
.excs {
  gap: 4px;
}
/* Un ámbito largo (cliente · tienda · nivel) parte línea dentro del badge en vez de recortarse. */
.excs .exc-badge {
  height: auto;
  min-height: 20px;
  padding-block: 2px;
  line-height: 16px;
  white-space: normal;
  text-overflow: clip;
}

.no-exceptions {
  padding: 16px;
}

/* Columnas (tabla de ancho fijo: las mismas posiciones en todas las tarjetas). */
th.col-action {
  width: 220px;
}
th.col-risk {
  width: 124px;
}
/* 24px de padding + el control segmentado pequeño de cuatro niveles (unos 354px). */
th.col-level {
  width: 380px;
}
th.col-exc {
  width: 232px;
}
th.col-scope {
  width: 22%;
}
th.col-remove {
  width: 96px;
}

.only-fold {
  display: none;
}

/* Medio: el riesgo pasa bajo el id y las excepciones bajo las condiciones. */
@container dial-table (max-width: 1159px) {
  th.col-action {
    width: 30%;
  }
  th.col-risk,
  td.col-risk,
  th.col-exc,
  td.col-exc,
  .only-wide {
    display: none;
  }
  .only-fold {
    display: revert;
  }
  .line.only-fold {
    display: flex;
  }
  .dial-table table.table th.col-cond,
  .dial-table table.table td.col-cond {
    padding-right: 16px;
  }
}

/* Estrecho: cada fila es un bloque. */
@container dial-table (max-width: 759px) {
  .dial-table table.table,
  .dial-table table.table tbody {
    display: block;
  }
  .dial-table table.table thead {
    display: none;
  }
  .dial-table table.table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .dial-table table.table tbody tr:last-child {
    border-bottom: 0;
  }
  .dial-table table.table td {
    display: block;
    padding: 0 16px;
    border-bottom: 0;
  }
  .dial-table table.table tbody tr:hover td {
    background: transparent;
  }
  .dial-table table.table td.col-risk,
  .dial-table table.table td.col-exc {
    display: none;
  }
  .line--end {
    justify-content: flex-start;
  }
  /* Sin huecos: en bloque sobran la línea de metadatos vacía y el guion de «sin condiciones». */
  .col-level .meta:empty,
  .cond-empty {
    display: none;
  }
}

/* ── Alta de excepciones ───────────────────────────────── */
.add-wrap {
  container: add / inline-size;
  flex: 1 1 100%;
  min-width: 0;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  min-width: 0;
  padding: 4px 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.field__label {
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 16px;
  color: var(--fg-muted);
}
.field select {
  width: 100%;
  min-width: 0;
}
.field select:disabled {
  background: var(--bg-muted);
  border-color: var(--border);
  color: var(--fg-subtle);
  cursor: not-allowed;
}
.add__submit {
  display: flex;
}
.add__note {
  grid-column: 1 / -1;
  margin-top: -4px;
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-muted);
}

@container add (max-width: 959px) {
  .add {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .field--wide {
    grid-column: 1 / -1;
  }
}
@container add (max-width: 479px) {
  .add {
    grid-template-columns: minmax(0, 1fr);
  }
  .add__submit {
    display: block;
  }
}
</style>
