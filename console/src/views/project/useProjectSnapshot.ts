/**
 * Carga el snapshot de un proyecto y lo mantiene al día.
 *
 * Pide `api.project(id)` al montar y cada vez que cambian `live.projectVersion[id]`
 * (evento `project.changed`) o `live.resetCount` (reinicio de la demo). Si llegan
 * varios cambios mientras hay una petición en vuelo, se agrupan en una sola recarga.
 */
import { onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { api } from '../../api.ts';
import { live } from '../../live.ts';

export function useProjectSnapshot<T>(projectId: string) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const error = ref<string | null>(null);

  let inFlight = false;
  let again = false;

  async function load(): Promise<void> {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    loading.value = true;
    try {
      do {
        again = false;
        try {
          data.value = await api.project<T>(projectId);
          error.value = null;
        } catch (err) {
          error.value = err instanceof Error ? err.message : String(err);
        }
      } while (again);
    } finally {
      inFlight = false;
      loading.value = false;
    }
  }

  onMounted(() => void load());
  watch([() => live.projectVersion[projectId], () => live.resetCount], () => void load());

  return { data, loading, error, reload: load };
}
