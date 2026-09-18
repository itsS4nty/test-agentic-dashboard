/**
 * Nombres legibles de tiendas ("Panaderías Horno Real · Centro") para vistas cuyo
 * snapshot solo trae ids. Se piden una vez a /api/policies, que incluye el directorio.
 */
import { ref } from 'vue';
import { api } from '../../api.ts';

const siteNames = ref<Record<string, string>>({});
let requested = false;

export function useSiteNames() {
  if (!requested) {
    requested = true;
    api
      .policies()
      .then((info) => {
        siteNames.value = Object.fromEntries(
          info.clients.flatMap((c) => c.sites.map((s) => [s.id, `${c.name} · ${s.name}`] as const)),
        );
      })
      .catch(() => {
        requested = false; // se reintenta en el próximo montaje
      });
  }
  return siteNames;
}
