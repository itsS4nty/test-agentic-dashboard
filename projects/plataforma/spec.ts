/**
 * Especificación de un agente nuevo (POST /api/agent-requests) y su validación.
 * La consola replica estos límites en console/src/views/agentes/spec.ts.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface OperationSpec {
  name: string;
  description: string;
  access: 'read' | 'write';
  money?: boolean;
  method?: HttpMethod;
  path?: string;
}

export interface ConnectionSpec {
  name: string;
  kind: 'http' | 'webhook';
  description: string;
  operations: OperationSpec[];
}

export interface AgentSpec {
  name: string;
  id?: string;
  purpose: string;
  trigger: 'manual' | 'event';
  event?: string;
  connections: ConnectionSpec[];
  context: string;
  tier: 'fast' | 'reasoning';
  budgetUsd: number;
  maxTurns: number;
  owner: string;
}

export interface SpecError {
  field: string;
  message: string;
}

export const DOMAIN_EVENTS = [
  'device.status_changed',
  'code.suspected_bug',
  'code.fix_merged',
  'invoice.batch_received',
  'ticket.received',
] as const;

export const ID_PATTERN = /^[a-z][a-z0-9-]{2,29}$/;
const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `agente-${slug}`.slice(0, 30).replace(/-+$/g, '');
}

/** Id de proyecto y prefijo de herramientas: el slug con guiones bajos. */
export const projectIdOf = (id: string) => id.replace(/-/g, '_');

export function validateSpec(input: unknown): { ok: true; spec: AgentSpec } | { ok: false; errors: SpecError[] } {
  const errors: SpecError[] = [];
  const s = (input ?? {}) as Record<string, unknown>;
  const str = (field: string, value: unknown, min: number, max: number, label: string) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      errors.push({ field, message: `${label}: entre ${min} y ${max} caracteres.` });
      return '';
    }
    return value.trim();
  };
  const name = str('name', s.name, 3, 60, 'Nombre');
  const purpose = str('purpose', s.purpose, 20, 4000, 'Qué debe hacer');
  const context = typeof s.context === 'string' ? s.context.trim() : '';
  if (context.length > 8000) errors.push({ field: 'context', message: 'Contexto: como mucho 8000 caracteres.' });
  const owner = str('owner', s.owner, 2, 60, 'Responsable');

  let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : slugify(name || 'agente');
  if (!ID_PATTERN.test(id)) errors.push({ field: 'id', message: 'Identificador: minúsculas, números y guiones; 3–30; empieza por letra.' });

  const trigger = s.trigger === 'event' ? 'event' : s.trigger === 'manual' ? 'manual' : null;
  if (!trigger) errors.push({ field: 'trigger', message: 'Cuándo actúa: manual o ante un evento.' });
  const event = typeof s.event === 'string' ? s.event : undefined;
  if (trigger === 'event' && !(DOMAIN_EVENTS as readonly string[]).includes(event ?? '')) {
    errors.push({ field: 'event', message: 'Elige uno de los eventos de dominio existentes.' });
  }

  const tier = s.tier === 'fast' || s.tier === 'reasoning' ? s.tier : null;
  if (!tier) errors.push({ field: 'tier', message: 'Modelo: rápido o razonamiento.' });
  const budgetUsd = Number(s.budgetUsd);
  if (!(budgetUsd >= 0.05 && budgetUsd <= 5)) errors.push({ field: 'budgetUsd', message: 'Presupuesto: entre 0,05 y 5 US$ por caso.' });
  const maxTurns = Number(s.maxTurns);
  if (!(Number.isInteger(maxTurns) && maxTurns >= 3 && maxTurns <= 25)) errors.push({ field: 'maxTurns', message: 'Turnos: entero entre 3 y 25.' });

  const connections: ConnectionSpec[] = [];
  const rawConnections = Array.isArray(s.connections) ? s.connections : [];
  if (rawConnections.length > 6) errors.push({ field: 'connections', message: 'Como mucho 6 conexiones.' });
  rawConnections.slice(0, 6).forEach((c: any, i: number) => {
    const base = `connections[${i}]`;
    const cname = str(`${base}.name`, c?.name, 2, 40, 'Nombre de la conexión');
    const kind = c?.kind === 'webhook' ? 'webhook' : c?.kind === 'http' ? 'http' : null;
    if (!kind) errors.push({ field: `${base}.kind`, message: 'Tipo: API HTTP o webhook.' });
    const cdesc = typeof c?.description === 'string' ? c.description.trim() : '';
    if (cdesc.length > 300) errors.push({ field: `${base}.description`, message: 'Como mucho 300 caracteres.' });
    const ops = Array.isArray(c?.operations) ? c.operations : [];
    if (ops.length < 1 || ops.length > 8) errors.push({ field: `${base}.operations`, message: 'Entre 1 y 8 operaciones.' });
    const operations: OperationSpec[] = ops.slice(0, 8).map((o: any, j: number) => {
      const ob = `${base}.operations[${j}]`;
      const oname = str(`${ob}.name`, o?.name, 3, 60, 'Nombre de la operación');
      const odesc = typeof o?.description === 'string' ? o.description.trim() : '';
      if (odesc.length > 300) errors.push({ field: `${ob}.description`, message: 'Como mucho 300 caracteres.' });
      const access = o?.access === 'write' ? 'write' : o?.access === 'read' ? 'read' : null;
      if (!access) errors.push({ field: `${ob}.access`, message: 'Lectura o escritura.' });
      if (o?.method !== undefined && !METHODS.includes(o.method)) errors.push({ field: `${ob}.method`, message: 'Método no válido.' });
      if (o?.path !== undefined && (typeof o.path !== 'string' || !/^\/[A-Za-z0-9/_{}\-.]{0,120}$/.test(o.path))) {
        errors.push({ field: `${ob}.path`, message: 'Ruta relativa que empiece por /, sin espacios.' });
      }
      return { name: oname, description: odesc, access: access ?? 'read', money: o?.money === true, method: o?.method, path: o?.path };
    });
    connections.push({ name: cname, kind: kind ?? 'http', description: cdesc, operations });
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    spec: { name, id, purpose, trigger: trigger!, event: trigger === 'event' ? event : undefined, connections, context, tier: tier!, budgetUsd, maxTurns, owner },
  };
}
