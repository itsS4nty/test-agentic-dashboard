<script setup lang="ts">
/**
 * Formulario «Crear agente». Lo principal es «¿Qué debe hacer?» en lenguaje natural: con eso el
 * agente creador (IA) diseña herramientas y permisos. Conexiones y ajustes son opcionales y van
 * plegados. Valida con los límites del contrato (spec.ts) y pinta los errores del servidor junto a
 * su campo. Al crear, emite `created` con la respuesta de `POST /api/agent-requests`.
 */
import { computed, nextTick, onMounted, reactive, ref, toRaw, useId } from 'vue';
import { catalog } from '../../components/catalog.ts';
import { errorMessage, formatInt, formatUsd } from '../../components/format.ts';
import { live } from '../../live.ts';
import { Badge, Button, Card, SegmentedControl, StatusDot, type SegmentedOption } from '../../ui/index.ts';
import type { AgentRequestCreated, AgentSpec, AgentSpecTier, AgentTrigger, ConnectionSpec } from '../project/types.ts';
import ConnectionEditor from './ConnectionEditor.vue';
import Fold from './Fold.vue';
import FormField from './FormField.vue';
import { AgentRequestRejected, createAgentRequest } from './requests.ts';
import {
  DOMAIN_EVENTS,
  ID_PATTERN,
  LIMITS,
  clashMessage,
  emptySpec,
  exampleSpec,
  fieldKey,
  fieldValue,
  findClash,
  isKnownField,
  newConnection,
  resolvedId,
  slugify,
  toPayload,
  validateSpec,
} from './spec.ts';

const props = defineProps<{
  /** Identificadores ya usados: agentes, proyectos y solicitudes en curso. */
  reservedIds: string[];
}>();

const emit = defineEmits<{ cancel: []; created: [result: AgentRequestCreated] }>();

const uid = `agente-nuevo-${useId()}`;
const id = (suffix: string) => `${uid}-${suffix}`;

const draft = reactive<AgentSpec>(emptySpec());

const TRIGGER_OPTIONS: SegmentedOption<AgentTrigger>[] = [
  { value: 'manual', label: 'Manual', title: 'Lo pone en marcha una persona o un escenario.' },
  { value: 'event', label: 'Ante un evento', title: 'Se pone en marcha solo cuando ocurre algo en la plataforma.' },
];

const TIER_LABEL: Record<AgentSpecTier, string> = { fast: 'Rápido', reasoning: 'Razonamiento' };
const TIER_OPTIONS: SegmentedOption<AgentSpecTier>[] = [
  { value: 'fast', label: TIER_LABEL.fast, title: 'Barato y ágil: trabajo de volumen.' },
  { value: 'reasoning', label: TIER_LABEL.reasoning, title: 'Para decisiones con más matices.' },
];

// ── Errores ─────────────────────────────────────────────

/** Ya se intentó enviar: desde ahí, los errores de cliente se ven y se actualizan al escribir. */
const attempted = ref(false);
const submitting = ref(false);
/** Errores del servidor con el valor que tenía el campo: se ocultan en cuanto el campo cambia. */
const serverErrors = ref<{ key: string; message: string; value: string }[]>([]);
/** Motivo general del último envío fallido (red, servidor o rechazo sin campos). */
const submitError = ref('');

const clientErrors = computed(() => validateSpec(draft, props.reservedIds));
const clientByKey = computed(() => {
  const map = new Map<string, string>();
  for (const e of clientErrors.value) if (!map.has(e.field)) map.set(e.field, e.message);
  return map;
});

const derivedId = computed(() => resolvedId(draft));
const idIsExplicit = computed(() => !!draft.id?.trim());
/** Choque de identificador: se avisa al momento, sin esperar a enviar. */
const liveClash = computed(() =>
  ID_PATTERN.test(derivedId.value) ? findClash(derivedId.value, props.reservedIds) : undefined,
);

function errorFor(key: string): string | undefined {
  if (attempted.value) {
    const message = clientByKey.value.get(key);
    if (message) return message;
  } else if (key === 'id' && liveClash.value) {
    return clashMessage(liveClash.value);
  }
  return serverErrors.value.find((e) => e.key === key && fieldValue(draft, key) === e.value)?.message;
}

/** Con el identificador derivado del nombre, su error se lee bajo el nombre. */
const nameError = computed(() => errorFor('name') ?? (idIsExplicit.value ? undefined : errorFor('id')));

const otherErrors = computed(() => serverErrors.value.filter((e) => !isKnownField(e.key)));

/** Línea de estado del pie: los campos marcados mandan; si no hay, el motivo general. */
const summary = computed(() => {
  const clientPending = attempted.value && clientErrors.value.length > 0;
  const serverPending = serverErrors.value.some(
    (e) => isKnownField(e.key) && fieldValue(draft, e.key) === e.value,
  );
  if (clientPending || serverPending) return 'Revisa los campos marcados.';
  return submitError.value;
});

// ── Resúmenes de los plegables ──────────────────────────

const openConnections = ref(false);
const openSettings = ref(false);

const connectionsMeta = computed(() => {
  const n = draft.connections.length;
  if (!n) return 'Opcional';
  const ops = draft.connections.reduce((sum, c) => sum + c.operations.length, 0);
  return `${n} ${n === 1 ? 'conexión' : 'conexiones'} · ${ops} ${ops === 1 ? 'operación' : 'operaciones'}`;
});

const settingsMeta = computed(() => {
  const parts = [
    TIER_LABEL[draft.tier],
    `${formatUsd(Number(draft.budgetUsd) || 0)} por caso`,
    `${formatInt(Number(draft.maxTurns) || 0)} turnos`,
  ];
  if (draft.owner.trim()) parts.push(draft.owner.trim());
  return parts.join(' · ');
});

const modelFor = (tier: AgentSpecTier) => live.status?.models[tier] ?? '';

/** Quién escribe el agente: el modelo del agente creador, o la IA simulada si no hay clave. */
const writer = computed(() => {
  const status = live.status;
  if (!status) return null;
  if (status.provider === 'mock') return { model: 'simulada', title: status.providerLabel };
  const tier = catalog.agents.find((a) => a.id === 'creador')?.tier ?? 'reasoning';
  return { model: status.models[tier], title: `${status.providerLabel} · ${status.models[tier]}` };
});

// ── Acciones ────────────────────────────────────────────

const purposeInput = ref<HTMLTextAreaElement | null>(null);
const formEl = ref<HTMLFormElement | null>(null);

onMounted(() => purposeInput.value?.focus());

const SETTINGS_KEYS = /^(id|tier|budgetUsd|maxTurns|owner)$/;

/** Abre los plegables con errores y lleva el foco al primer campo inválido. */
async function revealErrors(keys: string[]) {
  if (keys.some((k) => k.startsWith('connections'))) openConnections.value = true;
  if (keys.some((k) => SETTINGS_KEYS.test(k))) openSettings.value = true;
  await nextTick();
  formEl.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

function resetErrors() {
  attempted.value = false;
  serverErrors.value = [];
  submitError.value = '';
}

function fillExample() {
  Object.assign(draft, exampleSpec(props.reservedIds));
  resetErrors();
  openConnections.value = true;
  void nextTick(() => purposeInput.value?.focus());
}

// Claves estables para las conexiones (sobreviven a quitar una del medio).
const connectionKeys = new WeakMap<object, number>();
let nextConnectionKey = 0;
function connectionKey(connection: ConnectionSpec): number {
  const raw = toRaw(connection);
  let key = connectionKeys.get(raw);
  if (key === undefined) connectionKeys.set(raw, (key = nextConnectionKey++));
  return key;
}

function addConnection() {
  if (draft.connections.length < LIMITS.connections.max) draft.connections.push(newConnection());
}

function removeConnection(index: number) {
  draft.connections.splice(index, 1);
}

function onTrigger(value: AgentTrigger) {
  if (value === 'manual') draft.event = '';
}

async function submit() {
  if (submitting.value) return;
  attempted.value = true;
  submitError.value = '';
  if (clientErrors.value.length) {
    await revealErrors(clientErrors.value.map((e) => e.field));
    return;
  }
  submitting.value = true;
  serverErrors.value = [];
  try {
    const result = await createAgentRequest(toPayload(draft));
    emit('created', result);
  } catch (err) {
    if (err instanceof AgentRequestRejected) {
      serverErrors.value = err.errors.map((e) => {
        const key = fieldKey(e.field);
        return { key, message: e.message, value: fieldValue(draft, key) };
      });
      // Sin errores por campo, el motivo general; con errores sin campo conocido, la lista del pie.
      submitError.value = serverErrors.value.length ? '' : err.message;
      await revealErrors(serverErrors.value.map((e) => e.key));
    } else {
      submitError.value = errorMessage(err);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form ref="formEl" class="agent-form" novalidate :aria-labelledby="id('titulo')" @submit.prevent="submit">
    <Card :padded="true">
      <template #header>
        <!-- El botón va en la cabecera y no en `actions`: así baja bajo el texto en pantallas estrechas. -->
        <div class="agent-form__head">
          <div class="agent-form__head-text">
            <h2 :id="id('titulo')" class="agent-form__title">Nuevo agente</h2>
            <p class="agent-form__description">
              La IA lo escribe en <code class="agent-form__code">agents/</code> de este repositorio y abre un PR. Nada se activa sin aprobación.
            </p>
          </div>
          <Button size="sm" @click="fillExample">Rellenar con un ejemplo</Button>
        </div>
      </template>

      <div class="agent-form__body">
        <FormField
          v-slot="{ describedBy, invalid }"
          label="¿Qué debe hacer?"
          size="lg"
          :input-id="id('que-debe-hacer')"
          help="Descríbelo como se lo explicarías a una persona. La IA diseña las herramientas y los permisos."
          :error="errorFor('purpose')"
          :count="draft.purpose.length"
          :max="LIMITS.purpose.max"
        >
          <textarea
            :id="id('que-debe-hacer')"
            ref="purposeInput"
            v-model="draft.purpose"
            class="agent-form__purpose"
            rows="7"
            placeholder="Cada mañana revisa las mermas de las tiendas y propone ajustar el pedido de masa del día siguiente…"
            :aria-describedby="describedBy"
            :aria-invalid="invalid || undefined"
          ></textarea>
        </FormField>

        <FormField class="agent-form__narrow" label="Nombre" :input-id="id('nombre')" :error="nameError">
          <template #default="{ describedBy, invalid }">
            <input
              :id="id('nombre')"
              v-model="draft.name"
              type="text"
              autocomplete="off"
              placeholder="Control de mermas"
              :aria-describedby="describedBy"
              :aria-invalid="invalid || undefined"
            />
          </template>
          <template v-if="ID_PATTERN.test(derivedId)" #hint>
            Carpeta <code class="agent-form__code agent-form__code--nowrap">agents/{{ derivedId }}/</code> · rama
            <code class="agent-form__code agent-form__code--nowrap">agente/{{ derivedId }}</code>
          </template>
        </FormField>

        <FormField v-slot="{ labelId }" label="Cuándo actúa" group :input-id="id('cuando')" :error="errorFor('trigger')">
          <div class="agent-form__trigger">
            <SegmentedControl
              v-model="draft.trigger"
              :options="TRIGGER_OPTIONS"
              :aria-labelledby="labelId"
              @change="onTrigger"
            />
          </div>
        </FormField>

        <FormField
          v-if="draft.trigger === 'event'"
          class="agent-form__narrow agent-form__event"
          label="Evento"
          :input-id="id('evento')"
          :error="errorFor('event')"
        >
          <template #default="{ describedBy, invalid }">
            <select
              :id="id('evento')"
              v-model="draft.event"
              :aria-describedby="describedBy"
              :aria-invalid="invalid || undefined"
            >
              <option value="" disabled>Elige un evento…</option>
              <option v-for="e in DOMAIN_EVENTS" :key="e.id" :value="e.id">{{ e.label }}</option>
            </select>
          </template>
          <template v-if="draft.event" #hint>
            <code class="agent-form__code">{{ draft.event }}</code>
          </template>
        </FormField>

        <Fold v-model:open="openConnections" class="agent-form__fold" title="Conexiones conocidas" :meta="connectionsMeta">
          <p class="agent-form__note">Opcional: si no las indicas, la IA propone las que falten a partir de lo que debe hacer.</p>

          <ConnectionEditor
            v-for="(connection, i) in draft.connections"
            :key="connectionKey(connection)"
            :connection="connection"
            :index="i"
            :id-prefix="uid"
            :error-for="errorFor"
            @remove="removeConnection(i)"
          />

          <p v-if="errorFor('connections')" class="agent-form__error">{{ errorFor('connections') }}</p>

          <div class="agent-form__row">
            <Button size="sm" :disabled="draft.connections.length >= LIMITS.connections.max" @click="addConnection">
              Añadir conexión
            </Button>
            <p v-if="draft.connections.length" class="agent-form__dial">
              Lectura → Hace sola · Escritura o dinero → Pide permiso. <span class="agent-form__dial-note">La IA puede ajustarlo en el PR.</span>
            </p>
          </div>
        </Fold>

        <FormField
          v-slot="{ describedBy, invalid }"
          label="Contexto del negocio"
          :input-id="id('contexto')"
          help="Procedimientos, reglas, horarios y tono."
          :error="errorFor('context')"
          :count="draft.context.length"
          :max="LIMITS.context.max"
          optional
        >
          <textarea
            :id="id('contexto')"
            v-model="draft.context"
            rows="4"
            placeholder="El pedido de masa se cierra a las 06:00. No bajes un pedido más de un 30 % de un día para otro…"
            :aria-describedby="describedBy"
            :aria-invalid="invalid || undefined"
          ></textarea>
        </FormField>

        <Fold v-model:open="openSettings" class="agent-form__fold agent-form__fold--last" title="Ajustes" :meta="settingsMeta">
          <div class="agent-form__settings">
            <FormField v-slot="{ labelId }" label="Modelo" group :input-id="id('modelo')" :error="errorFor('tier')">
              <SegmentedControl v-model="draft.tier" :options="TIER_OPTIONS" :aria-labelledby="labelId" block />
              <p v-if="modelFor(draft.tier)" class="agent-form__model">{{ modelFor(draft.tier) }}</p>
            </FormField>

            <FormField
              v-slot="{ describedBy, invalid }"
              label="Responsable"
              :input-id="id('responsable')"
              :error="errorFor('owner')"
            >
              <input
                :id="id('responsable')"
                v-model="draft.owner"
                type="text"
                autocomplete="off"
                placeholder="Producción"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>

            <FormField
              v-slot="{ describedBy, invalid }"
              label="Presupuesto por caso (US$)"
              :input-id="id('presupuesto')"
              :error="errorFor('budgetUsd')"
            >
              <input
                :id="id('presupuesto')"
                v-model.number="draft.budgetUsd"
                class="agent-form__number"
                type="number"
                inputmode="decimal"
                :min="LIMITS.budgetUsd.min"
                :max="LIMITS.budgetUsd.max"
                step="0.05"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>

            <FormField
              v-slot="{ describedBy, invalid }"
              label="Turnos máximos"
              :input-id="id('turnos')"
              :error="errorFor('maxTurns')"
            >
              <input
                :id="id('turnos')"
                v-model.number="draft.maxTurns"
                class="agent-form__number"
                type="number"
                inputmode="numeric"
                :min="LIMITS.maxTurns.min"
                :max="LIMITS.maxTurns.max"
                step="1"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>

            <FormField
              class="agent-form__wide"
              label="Identificador"
              :input-id="id('identificador')"
              :error="errorFor('id')"
              optional
            >
              <template #default="{ describedBy, invalid }">
                <input
                  :id="id('identificador')"
                  v-model="draft.id"
                  class="agent-form__mono"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="slugify(draft.name) || 'control-de-mermas'"
                  :aria-describedby="describedBy"
                  :aria-invalid="invalid || undefined"
                />
              </template>
              <template v-if="!draft.id?.trim()" #hint>Si lo dejas vacío, sale del nombre.</template>
            </FormField>
          </div>
        </Fold>
      </div>

      <template #footer>
        <div class="agent-form__footer">
          <div class="agent-form__status" aria-live="polite">
            <StatusDot v-if="summary" status="danger" :label="summary" />
            <ul v-if="otherErrors.length" class="agent-form__others" role="list">
              <li v-for="e in otherErrors" :key="`${e.key}:${e.message}`">
                <code v-if="e.key" class="agent-form__code">{{ e.key }}</code> {{ e.message }}
              </li>
            </ul>
            <p v-if="!summary && !otherErrors.length && writer" class="agent-form__writer" :title="writer.title">
              Lo escribe <Badge variant="inverted" label="IA" />
              <span class="agent-form__writer-model">{{ writer.model }}</span>
            </p>
          </div>
          <div class="agent-form__actions">
            <Button :disabled="submitting" @click="emit('cancel')">Cancelar</Button>
            <Button type="submit" variant="primary" :loading="submitting">Crear agente</Button>
          </div>
        </div>
      </template>
    </Card>
  </form>
</template>

<style scoped>
.agent-form {
  container: agent-form / inline-size;
  min-width: 0;
  animation: fade-in 150ms var(--ease);
}

.agent-form :deep(.card__heading) {
  flex: 1 1 auto;
}
.agent-form__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
}
.agent-form__head-text {
  display: flex;
  flex: 1 1 320px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.agent-form__title {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
}
.agent-form__description {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}

.agent-form__body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 800px;
  padding: 8px 0 0;
}

.agent-form__purpose {
  min-height: 148px;
  font-size: var(--text-base);
  line-height: 22px;
}
.agent-form__narrow {
  max-width: 480px;
}
.agent-form__event {
  margin-top: -12px;
}
.agent-form__trigger {
  display: flex;
}

/* Plegables: una raya encima; el último, también debajo. Sin hueco extra entre raya y raya. */
.agent-form__fold {
  margin: -8px 0;
}
.agent-form__fold--last {
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
}

.agent-form__note {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.agent-form__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}
.agent-form__dial {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-muted);
}
.agent-form__dial-note {
  color: var(--fg-subtle);
}
.agent-form__error {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--danger);
}

.agent-form__settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px 20px;
}
@container agent-form (min-width: 600px) {
  .agent-form__settings {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .agent-form__wide {
    grid-column: 1 / -1;
    max-width: calc(50% - 10px);
  }
}
.agent-form__model {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-subtle);
  overflow-wrap: anywhere;
}

/* Los inputs numéricos no tienen estilo global: el mismo aspecto que los de texto. */
.agent-form__number {
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;
  transition: border-color 150ms var(--ease);
}
.agent-form__mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.agent-form__code {
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.agent-form__code--nowrap {
  white-space: nowrap;
}

/* ── Pie ─────────────────────────────────────── */
.agent-form__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  width: 100%;
}
.agent-form__status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 20px;
}
.agent-form__others {
  margin: 0;
  padding: 0 0 0 16px;
  list-style: none;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.agent-form__writer {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--fg-muted);
}
.agent-form__writer-model {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-form__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
</style>
