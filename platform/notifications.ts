/** Notificaciones para personas (avisos de ejecución, escalados…). */
import type { Notification, NotificationService, PlatformApi } from './contracts.ts';
import { newId, nowIso } from './util.ts';

const COLLECTION = 'notifications';

export function createNotificationService(platform: PlatformApi): NotificationService {
  return {
    push(input) {
      const notification: Notification = { ...input, id: newId('ntf'), at: nowIso() };
      platform.store.put(COLLECTION, notification);
      platform.events.emit({ type: 'notification', notification });
      return notification;
    },
    /** Más recientes primero. */
    list() {
      return platform.store.list<Notification>(COLLECTION).reverse();
    },
  };
}
