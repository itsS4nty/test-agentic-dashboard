<script setup lang="ts">
/**
 * Una conexión conocida del agente nuevo: nombre, tipo (API HTTP o webhook de aviso), para qué y
 * sus operaciones (nombre, qué hace, lectura o escritura, si mueve dinero; método y ruta en
 * «Avanzado»). Enseña las variables de entorno que añadirá el PR y el nivel del dial de cada
 * operación. Un webhook solo envía: sus operaciones son de escritura y sin método ni ruta.
 * Edita en su sitio el objeto `connection` del borrador del formulario.
 */
import { computed, reactive, toRaw } from 'vue';
import { LEVEL_HINT } from '../../components/format.ts';
import { Badge, Button, SegmentedControl, decisionBadge, type SegmentedOption } from '../../ui/index.ts';
import type { ConnectionKind, ConnectionSpec, HttpMethod, OperationAccess, OperationSpec } from '../project/types.ts';
import FormField from './FormField.vue';
import { CONNECTION_KIND_LABEL, HTTP_METHODS, LIMITS, adaptToKind, envVarsFor, newOperation, operationLevel } from './spec.ts';

const props = defineProps<{
  connection: ConnectionSpec;
  index: number;
  idPrefix: string;
  errorFor: (key: string) => string | undefined;
}>();

const emit = defineEmits<{ remove: [] }>();

const KIND_OPTIONS: SegmentedOption<ConnectionKind>[] = [
  { value: 'http', label: CONNECTION_KIND_LABEL.http, title: 'El agente consulta o cambia datos en otro sistema.' },
  { value: 'webhook', label: CONNECTION_KIND_LABEL.webhook, title: 'El agente envía un aviso a una dirección.' },
];

const isWebhook = computed(() => props.connection.kind === 'webhook');

const accessOptions = computed<SegmentedOption<OperationAccess>[]>(() => [
  {
    value: 'read',
    label: 'Lectura',
    disabled: isWebhook.value,
    title: isWebhook.value ? 'Un webhook solo envía avisos.' : 'Consulta datos sin cambiar nada.',
  },
  { value: 'write', label: 'Escritura', title: 'Cambia datos o envía algo fuera.' },
]);

function onKind() {
  adaptToKind(props.connection);
}

/** Una lectura que no mueve dinero solo puede usar GET (lo exige el conector). */
function methodAllowed(op: OperationSpec, method: HttpMethod): boolean {
  return op.access === 'write' || !!op.money || method === 'GET';
}

const base = computed(() => `connections.${props.index}`);
const id = (suffix: string) => `${props.idPrefix}-c${props.index}-${suffix}`;
const err = (suffix: string) => props.errorFor(`${base.value}.${suffix}`);

const envVars = computed(() => envVarsFor(props.connection));

// Claves estables para las operaciones (sobreviven a quitar una del medio).
const keys = new WeakMap<object, number>();
let nextKey = 0;
function keyOf(op: OperationSpec): number {
  const raw = toRaw(op);
  let key = keys.get(raw);
  if (key === undefined) keys.set(raw, (key = nextKey++));
  return key;
}

/** Operaciones con «Avanzado» abierto. Con método o ruta ya escritos, se abre solo. */
const advanced = reactive(new Set<OperationSpec>());
function isAdvanced(op: OperationSpec): boolean {
  return advanced.has(op) || !!op.method || !!op.path?.trim();
}
function toggleAdvanced(op: OperationSpec) {
  if (isAdvanced(op)) {
    advanced.delete(op);
    op.method = undefined;
    op.path = '';
  } else {
    advanced.add(op);
  }
}

function addOperation() {
  if (props.connection.operations.length < LIMITS.operations.max) props.connection.operations.push(newOperation());
}

function removeOperation(j: number) {
  props.connection.operations.splice(j, 1);
}

function setMethod(op: OperationSpec, value: string) {
  op.method = (HTTP_METHODS as readonly string[]).includes(value) ? (value as HttpMethod) : undefined;
}

function level(op: OperationSpec) {
  const value = operationLevel(op, props.connection.kind);
  return { ...decisionBadge(value), title: LEVEL_HINT[value] };
}
</script>

<template>
  <fieldset class="conn">
    <legend class="sr-only">Conexión {{ index + 1 }}</legend>

    <div class="conn__head">
      <span class="conn__index" aria-hidden="true">Conexión {{ index + 1 }}</span>
      <Button variant="ghost" size="sm" :title="`Quitar la conexión ${index + 1}`" @click="emit('remove')">Quitar</Button>
    </div>

    <div class="conn__grid">
      <FormField v-slot="{ describedBy, invalid }" label="Nombre" :input-id="id('nombre')" :error="err('name')">
        <input
          :id="id('nombre')"
          v-model="connection.name"
          type="text"
          autocomplete="off"
          placeholder="ERP de obrador"
          :aria-describedby="describedBy"
          :aria-invalid="invalid || undefined"
        />
      </FormField>
      <FormField v-slot="{ labelId }" label="Tipo" :input-id="id('tipo')" group :error="err('kind')">
        <SegmentedControl
          v-model="connection.kind"
          :options="KIND_OPTIONS"
          :aria-labelledby="labelId"
          block
          @change="onKind"
        />
      </FormField>
      <FormField
        v-slot="{ describedBy, invalid }"
        class="conn__wide"
        label="Para qué"
        :input-id="id('para-que')"
        :error="err('description')"
        :count="connection.description.length"
        :max="LIMITS.connectionDescription.max"
        optional
      >
        <input
          :id="id('para-que')"
          v-model="connection.description"
          type="text"
          autocomplete="off"
          placeholder="Producción, ventas por tienda y pedidos de masa."
          :aria-describedby="describedBy"
          :aria-invalid="invalid || undefined"
        />
      </FormField>
    </div>

    <section class="ops" :aria-labelledby="id('operaciones')">
      <h4 :id="id('operaciones')" class="ops__title">
        Operaciones <span class="ops__count">{{ connection.operations.length }}</span>
      </h4>

      <ol class="ops__list" role="list">
        <li v-for="(op, j) in connection.operations" :key="keyOf(op)" class="op">
          <div class="op__grid">
            <FormField
              v-slot="{ describedBy, invalid }"
              label="Operación"
              :input-id="id(`o${j}-nombre`)"
              :error="err(`operations.${j}.name`)"
            >
              <input
                :id="id(`o${j}-nombre`)"
                v-model="op.name"
                class="mono-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="consultar_ventas"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>
            <FormField
              v-slot="{ describedBy, invalid }"
              label="Qué hace"
              :input-id="id(`o${j}-que-hace`)"
              :error="err(`operations.${j}.description`)"
              :count="op.description.length"
              :max="LIMITS.operationDescription.max"
            >
              <input
                :id="id(`o${j}-que-hace`)"
                v-model="op.description"
                type="text"
                autocomplete="off"
                placeholder="Ventas de un día por tienda y producto."
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>
          </div>

          <div class="op__controls">
            <SegmentedControl v-model="op.access" :options="accessOptions" size="sm" :aria-label="`Acceso de la operación ${j + 1}`" />
            <label class="check">
              <input v-model="op.money" type="checkbox" />
              <span>Mueve dinero</span>
            </label>
            <Badge class="op__level" :variant="level(op).variant" :label="level(op).label" :title="level(op).title" />
            <span class="op__spacer" aria-hidden="true"></span>
            <button
              v-if="!isWebhook"
              type="button"
              class="link-button"
              :aria-expanded="isAdvanced(op)"
              :aria-controls="id(`o${j}-avanzado`)"
              @click="toggleAdvanced(op)"
            >
              Avanzado
            </button>
            <Button
              variant="ghost"
              size="sm"
              :disabled="connection.operations.length <= LIMITS.operations.min"
              :title="`Quitar la operación ${j + 1}`"
              @click="removeOperation(j)"
            >
              Quitar
            </Button>
          </div>

          <div v-if="!isWebhook && isAdvanced(op)" :id="id(`o${j}-avanzado`)" class="op__advanced">
            <FormField v-slot="{ describedBy, invalid }" label="Método" :input-id="id(`o${j}-metodo`)" :error="err(`operations.${j}.method`)">
              <select
                :id="id(`o${j}-metodo`)"
                class="mono-input"
                :value="op.method ?? ''"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
                @change="setMethod(op, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="m in HTTP_METHODS" :key="m" :value="m" :disabled="!methodAllowed(op, m)">{{ m }}</option>
              </select>
            </FormField>
            <FormField v-slot="{ describedBy, invalid }" label="Ruta" :input-id="id(`o${j}-ruta`)" :error="err(`operations.${j}.path`)">
              <input
                :id="id(`o${j}-ruta`)"
                v-model="op.path"
                class="mono-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="/pedidos/{id}"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
              />
            </FormField>
          </div>
        </li>
      </ol>

      <p v-if="err('operations')" class="ops__error">{{ err('operations') }}</p>

      <div>
        <Button size="sm" :disabled="connection.operations.length >= LIMITS.operations.max" @click="addOperation">
          Añadir operación
        </Button>
      </div>
    </section>

    <div v-if="envVars.length" class="env">
      <span class="env__label">Variables de entorno</span>
      <ul class="env__list" role="list">
        <li v-for="name in envVars" :key="name"><code class="env__var">{{ name }}</code></li>
      </ul>
    </div>
  </fieldset>
</template>

<style scoped>
.conn {
  container: conn / inline-size;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  margin: 0;
  padding: 12px 16px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
}

.conn__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-right: -8px;
}
.conn__index {
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 20px;
  color: var(--fg);
}

.conn__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px 16px;
}
@container conn (min-width: 560px) {
  .conn__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .conn__wide {
    grid-column: 1 / -1;
  }
}

/* ── Operaciones ─────────────────────────────── */
.ops {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.ops__title {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
}
.ops__count {
  margin-left: 4px;
  font-weight: 400;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.ops__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-subtle);
}
.op {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
}
.op + .op {
  border-top: 1px solid var(--border);
}
.op__grid,
.op__advanced {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px 12px;
}
@container conn (min-width: 560px) {
  .op__grid {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }
  .op__advanced {
    grid-template-columns: 120px minmax(0, 1fr);
  }
}

.op__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}
.op__spacer {
  flex: 1 1 0;
}
.op__level {
  flex: none;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg);
  cursor: pointer;
  user-select: none;
}
.check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}

.link-button {
  appearance: none;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--fg-muted);
  font-size: var(--text-sm);
  line-height: 20px;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 3px;
  cursor: pointer;
  transition:
    color 150ms var(--ease),
    text-decoration-color 150ms var(--ease);
}
.link-button:hover,
.link-button[aria-expanded='true'] {
  color: var(--fg);
  text-decoration-color: var(--fg);
}

.ops__error {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--danger);
}

.mono-input {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* ── Variables de entorno ───────────────────── */
.env {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.env__label {
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-muted);
}
.env__list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.env__var {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
</style>
