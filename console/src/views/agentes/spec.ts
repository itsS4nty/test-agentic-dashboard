/**
 * Especificación de un agente nuevo en la consola: límites, validación, identificador derivado,
 * variables de entorno y nivel del dial que tendrá cada operación. Replica los límites de
 * `projects/plataforma/spec.ts` (la fuente de verdad es el servidor: sus errores se muestran igual).
 */
import type { AutonomyLevel } from '../../../../platform/contracts.ts';
import type {
  AgentSpec,
  ConnectionKind,
  ConnectionSpec,
  HttpMethod,
  OperationSpec,
  SpecError,
} from '../project/types.ts';

export const LIMITS = {
  name: { min: 3, max: 60 },
  purpose: { min: 20, max: 4000 },
  context: { max: 8000 },
  connections: { max: 6 },
  connectionName: { min: 2, max: 40 },
  connectionDescription: { max: 300 },
  operations: { min: 1, max: 8 },
  operationName: { max: 60 },
  operationDescription: { max: 300 },
  budgetUsd: { min: 0.05, max: 5 },
  maxTurns: { min: 3, max: 25 },
  owner: { min: 2, max: 60 },
} as const;

export const ID_PATTERN = /^[a-z][a-z0-9-]{2,29}$/;

/** Eventos de dominio que pueden despertar a un agente (docs/CONTRACTS.md § 5). */
export const DOMAIN_EVENTS: readonly { id: string; label: string }[] = [
  { id: 'device.status_changed', label: 'Cambia el estado de un dispositivo' },
  { id: 'code.suspected_bug', label: 'Se sospecha un fallo en el código' },
  { id: 'code.fix_merged', label: 'Se fusiona un arreglo de código' },
  { id: 'invoice.batch_received', label: 'Llega un lote de facturas' },
  { id: 'ticket.received', label: 'Llega un ticket de soporte' },
];

export const CONNECTION_KIND_LABEL: Record<ConnectionKind, string> = {
  http: 'API HTTP',
  webhook: 'Webhook de aviso',
};

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

export function eventLabel(id: string | undefined): string {
  return DOMAIN_EVENTS.find((e) => e.id === id)?.label ?? id ?? '';
}

// ── Identificador ─────────────────────────────────────────

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/** "Control de mermas" → "control-de-mermas" (empieza por letra, 30 caracteres como mucho). */
export function slugify(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 30)
    .replace(/-+$/, '');
}

/** El identificador que tendrá el agente: el escrito o, si no hay, el derivado del nombre. */
export function resolvedId(spec: Pick<AgentSpec, 'id' | 'name'>): string {
  return spec.id?.trim() || slugify(spec.name);
}

/** Dos identificadores chocan si coinciden o si dan el mismo prefijo de herramientas. */
function sameId(a: string, b: string): boolean {
  return a.replace(/-/g, '_') === b.replace(/-/g, '_');
}

/** El identificador ya usado con el que choca `id`, si lo hay. */
export function findClash(id: string, reserved: Iterable<string>): string | undefined {
  for (const taken of reserved) if (sameId(taken, id)) return taken;
  return undefined;
}

export function clashMessage(taken: string): string {
  return `Ya hay un agente, proyecto o solicitud con el identificador «${taken}».`;
}

// ── Conexiones ────────────────────────────────────────────

/** "ERP de obrador" → "ERP_DE_OBRADOR" */
export function envPrefix(connectionName: string): string {
  return stripAccents(connectionName)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Variables de entorno que el PR añadirá a `.env.example` para una conexión. */
export function envVarsFor(connection: Pick<ConnectionSpec, 'name' | 'kind'>): string[] {
  const prefix = envPrefix(connection.name);
  if (!prefix) return [];
  return connection.kind === 'webhook' ? [`${prefix}_WEBHOOK_URL`] : [`${prefix}_API_URL`, `${prefix}_API_TOKEN`];
}

/** Techo en el dial: la lectura la hace sola; escribir, avisar por webhook o mover dinero pide permiso. */
export function operationLevel(
  operation: Pick<OperationSpec, 'access' | 'money'>,
  kind: ConnectionKind = 'http',
): AutonomyLevel {
  return kind === 'webhook' || operation.access === 'write' || operation.money ? 'approve' : 'auto';
}

/**
 * Un webhook solo envía: sus operaciones son de escritura y no llevan método ni ruta (el conector
 * hace POST a la URL configurada). Se aplica al cambiar el tipo de la conexión.
 */
export function adaptToKind(connection: ConnectionSpec): void {
  if (connection.kind !== 'webhook') return;
  for (const op of connection.operations) {
    op.access = 'write';
    op.method = undefined;
    op.path = '';
  }
}

/** Nombre de operación normalizado como parte del nombre de la herramienta (`a-z0-9_`). */
function toolPart(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Ruta relativa a la URL base, como la acepta el conector: empieza por /, sin ?, #, espacios, // ni `..`. */
const PATH_FORBIDDEN = /[?#\s]|\.\.|\/\//;

export function newOperation(): OperationSpec {
  return { name: '', description: '', access: 'read', money: false, path: '' };
}

export function newConnection(): ConnectionSpec {
  return { name: '', kind: 'http', description: '', operations: [newOperation()] };
}

// ── Borradores ────────────────────────────────────────────

export function emptySpec(): AgentSpec {
  return {
    name: '',
    id: '',
    purpose: '',
    trigger: 'manual',
    event: '',
    connections: [],
    context: '',
    tier: 'fast',
    budgetUsd: 0.2,
    maxTurns: 10,
    owner: '',
  };
}

/** Solicitud de ejemplo para panaderías. Si su identificador ya está cogido, usa el siguiente libre. */
export function exampleSpec(reserved: Iterable<string> = []): AgentSpec {
  const taken = [...reserved];
  let id = 'control-de-mermas';
  for (let n = 2; findClash(id, taken); n++) id = `control-de-mermas-${n}`;
  return {
    name: 'Control de mermas',
    id: id === 'control-de-mermas' ? '' : id,
    purpose:
      'Cada mañana revisa las mermas de pan y bollería que registraron las tiendas el día anterior. ' +
      'Compara lo horneado con lo vendido por tienda y producto y detecta las desviaciones de más del 15 % ' +
      'respecto a la media de las últimas cuatro semanas. Para cada desviación propone ajustar el pedido de ' +
      'masa congelada del día siguiente y avisa al encargado de la tienda con el motivo. Si el ajuste supera ' +
      'los 200 € o afecta a más de tres tiendas del mismo cliente, lo deja preparado para que lo apruebe ' +
      'el responsable de producción.',
    trigger: 'manual',
    event: '',
    connections: [
      {
        name: 'ERP de obrador',
        kind: 'http',
        description: 'Producción, ventas por tienda y pedidos de masa congelada.',
        operations: [
          {
            name: 'consultar_ventas',
            description: 'Ventas de un día por tienda y producto.',
            access: 'read',
            money: false,
            method: 'GET',
            path: '/ventas',
          },
          {
            name: 'consultar_mermas',
            description: 'Mermas registradas por tienda y producto.',
            access: 'read',
            money: false,
            method: 'GET',
            path: '/mermas',
          },
          {
            name: 'ajustar_pedido',
            description: 'Cambia la cantidad de un producto en el pedido de masa del día siguiente.',
            access: 'write',
            money: true,
            method: 'PATCH',
            path: '/pedidos/{id}',
          },
        ],
      },
      {
        name: 'Avisos a tienda',
        kind: 'webhook',
        description: 'Mensaje breve al móvil del encargado de la tienda.',
        operations: [
          {
            name: 'avisar_encargado',
            description: 'Envía un aviso con la desviación y el ajuste propuesto.',
            access: 'write',
            money: false,
            path: '',
          },
        ],
      },
    ],
    context:
      'Las tiendas cierran caja a las 21:00 y registran las mermas antes de las 22:00. El pedido de masa ' +
      'congelada se cierra a las 06:00: si no da tiempo, no propongas nada y déjalo anotado en el caso.\n' +
      'No bajes el pedido de un producto más de un 30 % de un día para otro ni lo ajustes en festivos ' +
      'o en campañas (Reyes, Semana Santa).\n' +
      'Tono de los avisos: breve y concreto, en tuteo; los encargados los leen en el móvil entre hornadas.',
    tier: 'reasoning',
    budgetUsd: 0.5,
    maxTurns: 12,
    owner: 'Producción',
  };
}

/** Copia limpia para enviar: sin espacios sobrantes ni campos vacíos. */
export function toPayload(spec: AgentSpec): AgentSpec {
  const id = spec.id?.trim();
  return {
    name: spec.name.trim(),
    ...(id ? { id } : {}),
    purpose: spec.purpose.trim(),
    trigger: spec.trigger,
    ...(spec.trigger === 'event' && spec.event ? { event: spec.event } : {}),
    connections: spec.connections.map((c) => ({
      name: c.name.trim(),
      kind: c.kind,
      description: c.description.trim(),
      operations: c.operations.map((o) => {
        const http = c.kind === 'http';
        const path = http ? o.path?.trim() : undefined;
        return {
          name: o.name.trim(),
          description: o.description.trim(),
          access: http ? o.access : ('write' as const),
          ...(o.money ? { money: true } : {}),
          ...(http && o.method ? { method: o.method } : {}),
          ...(path ? { path } : {}),
        };
      }),
    })),
    context: spec.context.trim(),
    tier: spec.tier,
    budgetUsd: Number(spec.budgetUsd),
    maxTurns: Number(spec.maxTurns),
    owner: spec.owner.trim(),
  };
}

// ── Validación ────────────────────────────────────────────

/** `connections[0].operations[1].name` → `connections.0.operations.1.name` */
export function fieldKey(field: string): string {
  return field.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

const KNOWN_FIELDS = [
  /^(name|id|purpose|trigger|event|context|tier|budgetUsd|maxTurns|owner|connections)$/,
  /^connections\.\d+\.(name|kind|description|operations)$/,
  /^connections\.\d+\.operations\.\d+\.(name|description|access|money|method|path)$/,
];

/** Si el formulario pinta el error junto a su campo; si no, va a la lista general. */
export function isKnownField(key: string): boolean {
  return KNOWN_FIELDS.some((re) => re.test(key));
}

function length(value: string | undefined): number {
  return (value ?? '').trim().length;
}

function between(value: string | undefined, min: number, max: number): boolean {
  const n = length(value);
  return n >= min && n <= max;
}

const usd = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2 });

/**
 * Valida con los límites del contrato. Devuelve los errores con la clave canónica del campo
 * (`connections.0.name`). `reserved`: identificadores de agentes, proyectos y solicitudes en curso.
 */
export function validateSpec(spec: AgentSpec, reserved: Iterable<string> = []): SpecError[] {
  const errors: SpecError[] = [];
  const add = (field: string, message: string) => errors.push({ field, message });

  if (!between(spec.name, LIMITS.name.min, LIMITS.name.max)) {
    add('name', `Escribe un nombre de ${LIMITS.name.min} a ${LIMITS.name.max} caracteres.`);
  }

  const id = resolvedId(spec);
  if (spec.id?.trim()) {
    if (!ID_PATTERN.test(id)) add('id', 'Minúsculas, números y guiones; empieza por letra; de 3 a 30 caracteres.');
  } else if (length(spec.name) >= LIMITS.name.min && !ID_PATTERN.test(id)) {
    add('id', 'No se puede sacar un identificador del nombre: escríbelo en Ajustes.');
  }
  if (ID_PATTERN.test(id)) {
    const clash = findClash(id, reserved);
    if (clash) add('id', clashMessage(clash));
  }

  const purpose = length(spec.purpose);
  if (purpose < LIMITS.purpose.min) {
    add('purpose', `Cuéntalo con algo más de detalle: al menos ${LIMITS.purpose.min} caracteres.`);
  } else if (purpose > LIMITS.purpose.max) {
    add('purpose', `Como mucho ${LIMITS.purpose.max.toLocaleString('es-ES')} caracteres.`);
  }

  if (spec.trigger === 'event' && !DOMAIN_EVENTS.some((e) => e.id === spec.event)) {
    add('event', 'Elige el evento que lo pone en marcha.');
  }

  if (spec.connections.length > LIMITS.connections.max) {
    add('connections', `Como mucho ${LIMITS.connections.max} conexiones.`);
  }
  const prefixes = new Set<string>();
  /** Las operaciones acaban como herramientas `<proyecto>_<operación>`: no pueden repetirse. */
  const operationNames = new Set<string>();
  spec.connections.forEach((c, i) => {
    const base = `connections.${i}`;
    if (!between(c.name, LIMITS.connectionName.min, LIMITS.connectionName.max)) {
      add(`${base}.name`, `De ${LIMITS.connectionName.min} a ${LIMITS.connectionName.max} caracteres.`);
    } else {
      // El nombre da el prefijo de sus variables de entorno (ERP_DE_OBRADOR_API_URL).
      const prefix = envPrefix(c.name);
      if (!prefix) add(`${base}.name`, 'Usa letras o números.');
      else if (!/^[A-Z]/.test(prefix)) add(`${base}.name`, 'Empieza por una letra: da nombre a sus variables de entorno.');
      else if (prefixes.has(prefix)) add(`${base}.name`, 'Ya hay otra conexión con este nombre.');
      else prefixes.add(prefix);
    }
    if (length(c.description) > LIMITS.connectionDescription.max) {
      add(`${base}.description`, `Como mucho ${LIMITS.connectionDescription.max} caracteres.`);
    }
    if (c.operations.length < LIMITS.operations.min) {
      add(`${base}.operations`, 'Añade al menos una operación.');
    } else if (c.operations.length > LIMITS.operations.max) {
      add(`${base}.operations`, `Como mucho ${LIMITS.operations.max} operaciones.`);
    }
    c.operations.forEach((o, j) => {
      const op = `${base}.operations.${j}`;
      const part = toolPart(o.name);
      if (!length(o.name)) add(`${op}.name`, 'Ponle un nombre.');
      else if (length(o.name) > LIMITS.operationName.max) add(`${op}.name`, `Como mucho ${LIMITS.operationName.max} caracteres.`);
      else if (!part) add(`${op}.name`, 'Usa letras o números.');
      else if (operationNames.has(part)) add(`${op}.name`, 'Ya hay otra operación con este nombre.');
      else operationNames.add(part);
      if (length(o.description) > LIMITS.operationDescription.max) {
        add(`${op}.description`, `Como mucho ${LIMITS.operationDescription.max} caracteres.`);
      }
      if (c.kind !== 'http') return; // Un webhook no lleva método ni ruta.
      if (o.method && o.access === 'read' && !o.money && o.method !== 'GET') {
        add(`${op}.method`, 'Lectura: solo GET.');
      }
      const path = o.path?.trim();
      if (path && (!path.startsWith('/') || PATH_FORBIDDEN.test(path))) {
        add(`${op}.path`, 'Empieza por «/», sin ?, #, espacios, «//» ni «..».');
      }
    });
  });

  if (length(spec.context) > LIMITS.context.max) {
    add('context', `Como mucho ${LIMITS.context.max.toLocaleString('es-ES')} caracteres.`);
  }

  const budget = Number(spec.budgetUsd);
  if (typeof spec.budgetUsd !== 'number' || !Number.isFinite(budget) || budget < LIMITS.budgetUsd.min || budget > LIMITS.budgetUsd.max) {
    add('budgetUsd', `Entre ${usd(LIMITS.budgetUsd.min)} y ${usd(LIMITS.budgetUsd.max)} US$.`);
  }
  const turns = Number(spec.maxTurns);
  if (typeof spec.maxTurns !== 'number' || !Number.isInteger(turns) || turns < LIMITS.maxTurns.min || turns > LIMITS.maxTurns.max) {
    add('maxTurns', `Un número entero de ${LIMITS.maxTurns.min} a ${LIMITS.maxTurns.max}.`);
  }
  if (!between(spec.owner, LIMITS.owner.min, LIMITS.owner.max)) {
    add('owner', `Quién responde del agente: de ${LIMITS.owner.min} a ${LIMITS.owner.max} caracteres.`);
  }

  return errors;
}

/**
 * Valor de un campo por su clave canónica, serializado, para saber si ha cambiado desde que el
 * servidor lo rechazó. El identificador se compara ya resuelto (puede salir del nombre).
 */
export function fieldValue(spec: AgentSpec, key: string): string {
  if (key === 'id') return resolvedId(spec);
  let value: unknown = spec;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  return JSON.stringify(value ?? null);
}
