import type { InjectionKey, Ref } from 'vue';
import type { StatSize } from './types.ts';

/** Tamaño que `StatGrid` comunica a sus `Stat`. */
export const STAT_SIZE_KEY: InjectionKey<Ref<StatSize>> = Symbol('stat-size');
