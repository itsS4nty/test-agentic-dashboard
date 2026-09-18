<script setup lang="ts" generic="V extends string">
/**
 * Control segmentado: una sola opción elegida. `options: { value, label, disabled?, title? }[]`,
 * `modelValue`, `size` (md 32px · sm 28px), `disabled`, `ariaLabel`, `block` (ocupa el ancho).
 * Accesible como `radiogroup`: Tab entra en la opción elegida; flechas, Inicio y Fin eligen.
 * Emite `update:modelValue` y `change` con el valor nuevo.
 */
import { computed, nextTick, ref } from 'vue';
import type { SegmentedOption } from './types.ts';

const props = withDefaults(
  defineProps<{
    options: SegmentedOption<V>[];
    modelValue: V | null | undefined;
    size?: 'sm' | 'md';
    disabled?: boolean;
    ariaLabel?: string;
    block?: boolean;
  }>(),
  {
    size: 'md',
    disabled: false,
    ariaLabel: undefined,
    block: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: V]; change: [value: V] }>();

const root = ref<HTMLElement | null>(null);

const enabledIndexes = computed(() =>
  props.options.flatMap((option, index) => (option.disabled || props.disabled ? [] : [index])),
);

/** Opción que recibe el foco con Tab: la elegida o, si no hay, la primera disponible. */
const tabStop = computed(() => {
  const selected = props.options.findIndex((o) => o.value === props.modelValue);
  if (selected >= 0 && !props.options[selected].disabled) return selected;
  return enabledIndexes.value[0] ?? -1;
});

function choose(option: SegmentedOption<V>) {
  if (props.disabled || option.disabled || option.value === props.modelValue) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
}

function onKeydown(event: KeyboardEvent, index: number) {
  const enabled = enabledIndexes.value;
  if (!enabled.length) return;
  const position = enabled.indexOf(index);
  let target = -1;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      target = enabled[(position + 1) % enabled.length];
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      target = enabled[(position - 1 + enabled.length) % enabled.length];
      break;
    case 'Home':
      target = enabled[0];
      break;
    case 'End':
      target = enabled[enabled.length - 1];
      break;
    case ' ':
    case 'Enter':
      event.preventDefault();
      choose(props.options[index]);
      return;
    default:
      return;
  }
  event.preventDefault();
  choose(props.options[target]);
  void nextTick(() => {
    root.value?.querySelectorAll<HTMLElement>('[role="radio"]')[target]?.focus();
  });
}
</script>

<template>
  <div
    ref="root"
    class="segmented"
    :class="[`segmented--${size}`, { 'is-disabled': disabled, 'segmented--block': block }]"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segmented__option"
      :class="{ 'is-checked': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :tabindex="index === tabStop ? 0 : -1"
      :disabled="disabled || option.disabled"
      :title="option.title"
      @click="choose(option)"
      @keydown="onKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  max-width: 100%;
  /* Si no cabe, se desplaza en horizontal dentro de su pista en lugar de desbordar la página. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 2px;
  background: var(--bg-muted);
  border-radius: var(--radius);
  vertical-align: middle;
}
.segmented::-webkit-scrollbar {
  display: none;
}
.segmented--md {
  height: 32px;
}
.segmented--sm {
  height: 28px;
}
.segmented--block {
  display: flex;
  width: 100%;
}
.segmented--block .segmented__option {
  flex: 1 1 0;
}

.segmented__option {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color 150ms var(--ease),
    border-color 150ms var(--ease),
    color 150ms var(--ease);
}
.segmented--md .segmented__option {
  padding: 0 12px;
  font-size: var(--text-sm);
}
.segmented--sm .segmented__option {
  padding: 0 8px;
  font-size: var(--text-xs);
}

.segmented__option:hover:not(:disabled) {
  color: var(--fg);
}
.segmented__option.is-checked {
  background: var(--bg);
  border-color: var(--border);
  color: var(--fg);
}
.segmented__option:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--focus);
  outline-offset: 0;
}
.segmented__option:disabled {
  color: var(--fg-subtle);
  cursor: not-allowed;
}
.segmented.is-disabled .segmented__option.is-checked {
  background: var(--bg-subtle);
}
</style>
