<script setup lang="ts">
/**
 * Campo del formulario: etiqueta, ayuda de una línea, el control (slot) y el error. El slot recibe
 * `describedBy` e `invalid` para enlazar ayuda y error con el control (`aria-describedby`,
 * `aria-invalid`). `group` pinta la etiqueta como rótulo (`labelId`, para `aria-labelledby`) en vez
 * de `<label>`: para controles que no son un solo campo, como un control segmentado.
 * `count` y `max` muestran el contador cuando el texto se acerca al límite.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    inputId: string;
    help?: string;
    error?: string;
    optional?: boolean;
    group?: boolean;
    size?: 'md' | 'lg';
    count?: number;
    max?: number;
  }>(),
  { help: undefined, error: undefined, optional: false, group: false, size: 'md', count: undefined, max: undefined },
);

const helpId = computed(() => `${props.inputId}-ayuda`);
const errorId = computed(() => `${props.inputId}-error`);
const labelId = computed(() => `${props.inputId}-rotulo`);

const describedBy = computed(
  () => [props.help ? helpId.value : '', props.error ? errorId.value : ''].filter(Boolean).join(' ') || undefined,
);

const showCount = computed(
  () => props.max !== undefined && props.count !== undefined && props.count >= props.max * 0.8,
);
const over = computed(() => props.max !== undefined && props.count !== undefined && props.count > props.max);
</script>

<template>
  <div class="field" :class="{ 'field--lg': size === 'lg', 'field--invalid': !!error }">
    <div class="field__head">
      <span v-if="group" :id="labelId" class="field__label">{{ label }}</span>
      <label v-else :id="labelId" :for="inputId" class="field__label">{{ label }}</label>
      <span v-if="optional" class="field__optional">Opcional</span>
    </div>
    <p v-if="help" :id="helpId" class="field__help">{{ help }}</p>
    <slot :describedBy="describedBy" :invalid="!!error" :labelId="labelId" />
    <div v-if="error || showCount || $slots.hint" class="field__foot">
      <p v-if="error" :id="errorId" class="field__error">{{ error }}</p>
      <p v-else-if="$slots.hint" class="field__hint"><slot name="hint" /></p>
      <span v-if="showCount" class="field__count" :class="{ 'field__count--over': over }">
        {{ count?.toLocaleString('es-ES') }} / {{ max?.toLocaleString('es-ES') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.field__label {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
}
.field--lg .field__label {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
}
.field__optional {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-subtle);
}
.field__help {
  margin-top: -4px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  text-wrap: pretty;
}

.field__foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 16px;
}
.field__error,
.field__hint {
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 16px;
  overflow-wrap: anywhere;
}
.field__error {
  color: var(--danger);
}
.field__hint {
  color: var(--fg-subtle);
}
.field__count {
  flex: none;
  margin-left: auto;
  font-size: var(--text-xs);
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}
.field__count--over {
  color: var(--danger);
}

/* Controles del campo: ancho completo y borde rojo con error. */
.field :deep(input[type='text']),
.field :deep(input[type='number']),
.field :deep(select),
.field :deep(textarea) {
  width: 100%;
  min-width: 0;
}
.field--invalid :deep(input[aria-invalid='true']),
.field--invalid :deep(select[aria-invalid='true']),
.field--invalid :deep(textarea[aria-invalid='true']) {
  border-color: var(--danger);
}
</style>
