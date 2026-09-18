/**
 * Store en memoria con persistencia opcional a un JSON (escritura diferida).
 * Sin `filePath` no toca disco (modo `inMemory`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Store } from './contracts.ts';
import { errorMessage, nowIso } from './util.ts';

interface PersistedState {
  savedAt: string;
  /** Colecciones como listas para conservar el orden de inserción. */
  collections: Record<string, { id: string }[]>;
  values: Record<string, unknown>;
}

export interface StoreOptions {
  /** Ruta de `state.json`. Si falta, el store vive solo en memoria. */
  filePath?: string;
  saveDelayMs?: number;
}

export function createStore({ filePath, saveDelayMs = 300 }: StoreOptions = {}): Store {
  const collections = new Map<string, Map<string, { id: string }>>();
  const values = new Map<string, unknown>();

  let timer: NodeJS.Timeout | undefined;
  let dirty = false;
  let writing: Promise<void> | null = null;

  function collection(name: string): Map<string, { id: string }> {
    let items = collections.get(name);
    if (!items) {
      items = new Map();
      collections.set(name, items);
    }
    return items;
  }

  function load(path: string): void {
    if (!existsSync(path)) return;
    try {
      const state = JSON.parse(readFileSync(path, 'utf8')) as PersistedState;
      for (const [name, items] of Object.entries(state.collections ?? {})) {
        const target = collection(name);
        for (const item of items) target.set(item.id, item);
      }
      for (const [key, value] of Object.entries(state.values ?? {})) values.set(key, value);
    } catch (err) {
      console.warn(`[store] No se ha podido restaurar ${path}; se empieza vacío. ${errorMessage(err)}`);
    }
  }

  function snapshot(): PersistedState {
    const out: PersistedState = { savedAt: nowIso(), collections: {}, values: {} };
    for (const [name, items] of collections) out.collections[name] = [...items.values()];
    for (const [key, value] of values) out.values[key] = value;
    return out;
  }

  function scheduleSave(): void {
    if (!filePath) return;
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void save();
    }, saveDelayMs);
  }

  async function save(): Promise<void> {
    if (!filePath) return;
    while (writing) await writing;
    if (!dirty) return;
    dirty = false;
    const json = JSON.stringify(snapshot());
    const target = filePath;
    const tmp = `${target}.tmp`;
    writing = (async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(tmp, json, 'utf8');
      await rename(tmp, target);
    })()
      .catch((err) => console.error(`[store] Error al guardar el estado: ${errorMessage(err)}`))
      .finally(() => {
        writing = null;
      });
    await writing;
  }

  if (filePath) load(filePath);

  return {
    get<T>(name: string, id: string): T | undefined {
      return collections.get(name)?.get(id) as T | undefined;
    },
    list<T>(name: string): T[] {
      return [...(collections.get(name)?.values() ?? [])] as T[];
    },
    put<T extends { id: string }>(name: string, item: T): T {
      collection(name).set(item.id, item);
      scheduleSave();
      return item;
    },
    remove(name: string, id: string): void {
      if (collections.get(name)?.delete(id)) scheduleSave();
    },
    getValue<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    setValue<T>(key: string, value: T): void {
      values.set(key, value);
      scheduleSave();
    },
    clear(): void {
      collections.clear();
      values.clear();
      scheduleSave();
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await save();
    },
  };
}
