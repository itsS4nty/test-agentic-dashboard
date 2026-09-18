/**
 * Tipos públicos de los componentes base (docs/DESIGN.md § 4).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type BadgeVariant = 'neutral' | 'inverted' | 'outline' | 'success' | 'warning' | 'danger';

/** Estado visual: color del punto de `StatusDot` y del marcador de `TimelineItem`. */
export type Status = 'success' | 'warning' | 'danger' | 'neutral' | 'pending';

export type StatTone = 'default' | 'success' | 'warning' | 'danger';
export type StatSize = 'sm' | 'md';

export interface TabItem {
  id: string;
  label: string;
  /** Número pequeño gris junto a la etiqueta (se omite si es `undefined` o `null`). */
  count?: number | null;
}

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
  /** Texto de ayuda en `title`. */
  title?: string;
}

export interface KeyValueItem {
  label: string;
  value?: string | number | null;
  /** Valor en Geist Mono (IDs, nombres técnicos). */
  mono?: boolean;
  /** Nombre del slot que sustituye al valor. */
  slot?: string;
}
