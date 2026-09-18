/** Bus de eventos síncrono. Un suscriptor que falla no afecta a los demás. */
import type { EventBus, PlatformEvent } from './contracts.ts';

export function createEventBus(): EventBus {
  const listeners = new Set<(event: PlatformEvent) => void>();

  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error('[eventos] Error en un suscriptor:', err);
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
