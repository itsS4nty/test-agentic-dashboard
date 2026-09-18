/** Utilidades pequeñas compartidas por los servicios de la plataforma. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** `case_ab12cd34`, `apr_…`, `tl_…` */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lee y parsea un YAML. Lanza con un mensaje claro si no existe o no es válido. */
export function readYamlFile(path: string): any {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`No se puede leer ${path}`);
  }
  try {
    return parse(text);
  } catch (err) {
    throw new Error(`YAML no válido en ${path}: ${errorMessage(err)}`);
  }
}
