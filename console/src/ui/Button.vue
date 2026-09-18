<script setup lang="ts">
/**
 * Botón. `variant`: primary · secondary (por defecto) · ghost · danger. `size`: md 32px · sm 28px.
 * `loading` mantiene el foco (aria-disabled + aria-busy) y muestra un indicador; `disabled` usa el
 * atributo nativo. Con `as="a"` se pinta un enlace (`href`). `aria-pressed` activa el estado pulsado.
 */
import type { ButtonSize, ButtonVariant } from './types.ts';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    disabled?: boolean;
    as?: 'button' | 'a';
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    block?: boolean;
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    loading: false,
    disabled: false,
    as: 'button',
    href: undefined,
    type: 'button',
    block: false,
  },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();

function onClick(event: MouseEvent) {
  if (props.disabled || props.loading) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  emit('click', event);
}
</script>

<template>
  <a
    v-if="as === 'a'"
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'is-loading': loading, 'is-disabled': disabled, 'btn--block': block }]"
    :href="disabled ? undefined : href"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true"></span>
    <slot />
  </a>
  <button
    v-else
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'is-loading': loading, 'btn--block': block }]"
    :type="type"
    :disabled="disabled"
    :aria-disabled="loading || undefined"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true"></span>
    <slot />
  </button>
</template>

<style scoped>
.btn {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  margin: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-family: var(--font-sans);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 150ms var(--ease),
    border-color 150ms var(--ease),
    color 150ms var(--ease);
}
.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.btn--md {
  height: 32px;
  padding: 0 12px;
  font-size: var(--text-base);
}
.btn--sm {
  height: 28px;
  padding: 0 10px;
  font-size: var(--text-sm);
}
.btn--block {
  display: flex;
  width: 100%;
}

/* ── Variantes ─────────────────────────────── */
.btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}
.btn--primary:hover {
  background: color-mix(in srgb, var(--primary) 86%, var(--bg));
  border-color: color-mix(in srgb, var(--primary) 86%, var(--bg));
}
.btn--primary:active {
  background: color-mix(in srgb, var(--primary) 76%, var(--bg));
  border-color: color-mix(in srgb, var(--primary) 76%, var(--bg));
}

.btn--secondary {
  background: var(--bg);
  border-color: var(--border-strong);
  color: var(--fg);
}
.btn--secondary:hover {
  background: var(--bg-hover);
}
.btn--secondary:active,
.btn--secondary[aria-pressed='true'] {
  background: var(--bg-muted);
}

.btn--ghost {
  background: transparent;
  color: var(--fg-muted);
}
.btn--ghost:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.btn--ghost:active,
.btn--ghost[aria-pressed='true'] {
  background: var(--bg-muted);
  color: var(--fg);
}

.btn--danger {
  background: var(--bg);
  border-color: var(--danger);
  color: var(--danger);
}
.btn--danger:hover {
  background: var(--danger-bg);
}
.btn--danger:active {
  background: color-mix(in srgb, var(--danger) 14%, var(--bg));
}

/* ── Estados ───────────────────────────────── */
.btn:disabled,
.btn.is-disabled {
  background: var(--bg-muted);
  border-color: var(--border);
  color: var(--fg-subtle);
  cursor: not-allowed;
}
.btn.is-loading {
  cursor: progress;
}
.btn--primary.is-loading {
  background: color-mix(in srgb, var(--primary) 86%, var(--bg));
}

.btn__spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  opacity: 0.8;
}
@media (prefers-reduced-motion: no-preference) {
  .btn__spinner {
    animation: btn-spin 700ms linear infinite;
  }
}
@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
