/**
 * Simulador de los dispositivos en tienda.
 *
 * Por cada tienda del directorio: un datáfono (DAT-01), una impresora (IMP-01) y un router
 * (RTR-01). Cada cambio de estado emite `device.status_changed` (lo consumen las reglas) y avisa
 * a la consola con `projects.changed('dispositivo')`. El estado se guarda con `store.setValue('dispositivo')`.
 */
import type { Actor, PlatformApi, Site, ToolResult } from '../../platform/contracts.ts';

export type DeviceType = 'datafono' | 'impresora' | 'router';
export type DeviceStatus = 'ok' | 'locked' | 'offline' | 'paper_out' | 'restarting';
/** Síntoma con el que se bloquea un datáfono. La regla de ola agrupa bloqueos por síntoma. */
export type LockCause = 'payment_timeout' | 'card_reader_fault' | 'screen_frozen';

export interface Device {
  id: string;
  siteId: string;
  clientId: string;
  type: DeviceType;
  label: string;
  model: string;
  softwareVersion: string;
  status: DeviceStatus;
  transactionInFlight: boolean;
  /** Instantes (ISO) de cada reinicio remoto. */
  restarts: string[];
  /** Verdad oculta del simulador: el fallo vuelve tras reiniciar. Nunca se enseña al modelo. */
  sticky: boolean;
  /** Último síntoma de bloqueo registrado. */
  lockCause?: LockCause;
}

export interface HistoryEntry {
  at: string;
  deviceId: string;
  siteId: string;
  clientId: string;
  deviceType: DeviceType;
  kind: 'status' | 'restart' | 'update';
  from?: DeviceStatus;
  to?: DeviceStatus;
  cause?: LockCause;
  softwareVersion: string;
  /** Frase legible: "operativo → bloqueado: Pantalla congelada". */
  detail: string;
}

export interface StoreNotice {
  at: string;
  siteId: string;
  message: string;
}

export interface FieldTicket {
  id: string;
  at: string;
  siteId: string;
  deviceId?: string;
  summary: string;
  caseId?: string;
}

interface DispositivoState {
  devices: Device[];
  history: HistoryEntry[];
  storeNotices: StoreNotice[];
  fieldTickets: FieldTicket[];
  ambient: boolean;
  nextTicketNumber: number;
}

/** Payload de `device.status_changed` (docs/CONTRACTS.md § 5). */
export interface DeviceStatusChanged {
  deviceId: string;
  siteId: string;
  clientId: string;
  deviceType: DeviceType;
  from: DeviceStatus;
  to: DeviceStatus;
  softwareVersion: string;
}

/** Lo que pinta la vista Dispositivo de la consola (`GET /api/projects/dispositivo`). */
export interface DispositivoSnapshot {
  ambient: boolean;
  clients: { id: string; name: string }[];
  sites: {
    id: string;
    name: string;
    city: string;
    clientId: string;
    clientName: string;
    open: string;
    close: string;
    devices: {
      id: string;
      type: DeviceType;
      label: string;
      model: string;
      softwareVersion: string;
      status: DeviceStatus;
      transactionInFlight: boolean;
      restartsLastHour: number;
      lastRestartAt?: string;
    }[];
  }[];
  storeNotices: StoreNotice[];
  fieldTickets: { id: string; at: string; siteId: string; deviceId?: string; summary: string }[];
}

export const PROJECT_ID = 'dispositivo';
export const INITIAL_DATAFONO_VERSION = '2.14.2';
export const HOUR_MS = 60 * 60 * 1000;
/** Ventana en la que varios bloqueos de datáfono cuentan como una ola. */
export const WAVE_WINDOW_MS = 2 * 60 * 1000;
/** Con este número de reinicios en la última hora, la política deja de permitir más. */
export const MAX_RESTARTS_PER_HOUR = 3;

const HISTORY_LIMIT = 400;
const LIST_LIMIT = 50;

export const TYPE_LABEL: Record<DeviceType, string> = {
  datafono: 'datáfono',
  impresora: 'impresora',
  router: 'router',
};

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  ok: 'operativo',
  locked: 'bloqueado',
  offline: 'sin conexión',
  paper_out: 'sin papel',
  restarting: 'reiniciando',
};

export const CAUSE_LABEL: Record<LockCause, string> = {
  payment_timeout: 'Terminal ocupado tras un timeout de cobro',
  card_reader_fault: 'El lector de tarjetas no responde al arrancar',
  screen_frozen: 'Pantalla congelada',
};

const ACTOR_LABEL: Record<Actor, string> = { rule: 'una regla', agent: 'el agente', human: 'una persona' };

const BLUEPRINTS: { type: DeviceType; label: string; model: string; softwareVersion: string }[] = [
  { type: 'datafono', label: 'DAT-01', model: 'TPV-Pay M5', softwareVersion: INITIAL_DATAFONO_VERSION },
  { type: 'impresora', label: 'IMP-01', model: 'TermoPrint 80', softwareVersion: '1.8.0' },
  { type: 'router', label: 'RTR-01', model: 'NetBox 4G', softwareVersion: '5.2.1' },
];

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** "10:02:13" en hora de España. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour12: false });
}

/** ¿Está abierta la tienda ahora? Horario "HH:MM" en hora de España. */
export function isStoreOpen(site: Pick<Site, 'open' | 'close'>, now = new Date()): boolean {
  const hm = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return hm >= site.open && hm < site.close;
}

/** "Panaderías Horno Real · Centro" */
export function deviceWhere(platform: PlatformApi, d: Device): string {
  return platform.directory.describeScope({ clientId: d.clientId, siteId: d.siteId });
}

/** "datáfono DAT-01 · Panaderías Horno Real · Centro" */
export function deviceName(platform: PlatformApi, d: Device): string {
  return `${TYPE_LABEL[d.type]} ${d.label} · ${deviceWhere(platform, d)}`;
}

function buildInitialState(platform: PlatformApi): DispositivoState {
  const devices: Device[] = [];
  for (const client of platform.directory.clients()) {
    for (const site of client.sites) {
      for (const bp of BLUEPRINTS) {
        devices.push({
          id: `${site.id}:${bp.label}`,
          siteId: site.id,
          clientId: client.id,
          type: bp.type,
          label: bp.label,
          model: bp.model,
          softwareVersion: bp.softwareVersion,
          status: 'ok',
          transactionInFlight: false,
          restarts: [],
          sticky: false,
        });
      }
    }
  }
  return { devices, history: [], storeNotices: [], fieldTickets: [], ambient: false, nextTicketNumber: 1001 };
}

/** Reutiliza el estado guardado solo si corresponde al directorio actual. */
function restoreState(saved: DispositivoState | undefined, fresh: DispositivoState): DispositivoState | undefined {
  if (!saved || !Array.isArray(saved.devices)) return undefined;
  const ids = new Set(saved.devices.map((d) => d?.id));
  if (ids.size !== fresh.devices.length || !fresh.devices.every((d) => ids.has(d.id))) return undefined;
  return {
    devices: saved.devices.map((d) => ({ ...d, restarts: Array.isArray(d.restarts) ? d.restarts : [] })),
    history: Array.isArray(saved.history) ? saved.history : [],
    storeNotices: Array.isArray(saved.storeNotices) ? saved.storeNotices : [],
    fieldTickets: Array.isArray(saved.fieldTickets) ? saved.fieldTickets : [],
    ambient: Boolean(saved.ambient),
    nextTicketNumber: Number(saved.nextTicketNumber) || 1001,
  };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

export class FleetSimulator {
  private platform: PlatformApi | undefined;
  private state: DispositivoState = { devices: [], history: [], storeNotices: [], fieldTickets: [], ambient: false, nextTicketNumber: 1001 };
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private ambientTimer: ReturnType<typeof setTimeout> | undefined;
  /** Cambia en cada stop/reset: invalida temporizadores y callbacks de un estado anterior. */
  private generation = 0;

  attach(platform: PlatformApi): void {
    this.platform = platform;
  }

  private get api(): PlatformApi {
    if (!this.platform) throw new Error('El simulador de dispositivos no está conectado a la plataforma');
    return this.platform;
  }

  // ── Ciclo de vida ────────────────────────────────────────

  /** Restaura el estado guardado (o crea los dispositivos) y reanuda lo que estuviera en marcha. */
  load(): void {
    const fresh = buildInitialState(this.api);
    this.state = restoreState(this.api.store.getValue<DispositivoState>(PROJECT_ID), fresh) ?? fresh;
    this.save();
    for (const d of this.state.devices) {
      if (d.status === 'restarting') this.scheduleRestartEnd(d.id);
    }
    if (this.state.ambient) this.startAmbient();
  }

  /** Dispositivo recién instalada: todo operativo, sin historial ni actividad de fondo. */
  resetState(): void {
    this.stop();
    this.state = buildInitialState(this.api);
    this.save();
  }

  /** Para todos los temporizadores (reinicios en curso, reposición de papel, ambiente). */
  stop(): void {
    this.generation++;
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    this.ambientTimer = undefined;
  }

  // ── Consultas ────────────────────────────────────────────

  devices(): Device[] {
    return this.state.devices;
  }

  device(id: string): Device | undefined {
    return this.state.devices.find((d) => d.id === id);
  }

  siteDevices(siteId: string): Device[] {
    return this.state.devices.filter((d) => d.siteId === siteId);
  }

  restartsLastHour(d: Device, now = Date.now()): number {
    return d.restarts.filter((at) => now - Date.parse(at) < HOUR_MS).length;
  }

  /** Últimos eventos del dispositivo, en orden cronológico. */
  historyOf(deviceId: string, limit = 20): HistoryEntry[] {
    return this.state.history.filter((e) => e.deviceId === deviceId).slice(-limit);
  }

  /** Bloqueos, caídas y faltas de papel dentro de la ventana, en orden cronológico. */
  incidents(windowMs: number): HistoryEntry[] {
    const since = Date.now() - windowMs;
    return this.state.history.filter(
      (e) =>
        e.kind === 'status' &&
        (e.to === 'locked' || e.to === 'offline' || e.to === 'paper_out') &&
        Date.parse(e.at) >= since,
    );
  }

  /** Bloqueos de datáfono dentro de la ventana (opcionalmente de un síntoma), en orden cronológico. */
  recentLocks(windowMs: number, cause?: LockCause): HistoryEntry[] {
    const since = Date.now() - windowMs;
    return this.state.history.filter(
      (e) =>
        e.kind === 'status' &&
        e.deviceType === 'datafono' &&
        e.to === 'locked' &&
        Date.parse(e.at) >= since &&
        (!cause || e.cause === cause),
    );
  }

  isAmbient(): boolean {
    return this.state.ambient;
  }

  snapshot(): DispositivoSnapshot {
    const clients = this.api.directory.clients();
    return {
      ambient: this.state.ambient,
      clients: clients.map((c) => ({ id: c.id, name: c.name })),
      sites: clients.flatMap((client) =>
        client.sites.map((site) => ({
          id: site.id,
          name: site.name,
          city: site.city,
          clientId: client.id,
          clientName: client.name,
          open: site.open,
          close: site.close,
          devices: this.siteDevices(site.id).map((d) => ({
            id: d.id,
            type: d.type,
            label: d.label,
            model: d.model,
            softwareVersion: d.softwareVersion,
            status: d.status,
            transactionInFlight: d.transactionInFlight,
            restartsLastHour: this.restartsLastHour(d),
            lastRestartAt: d.restarts.at(-1),
          })),
        })),
      ),
      storeNotices: [...this.state.storeNotices].reverse().slice(0, 20),
      fieldTickets: [...this.state.fieldTickets]
        .reverse()
        .slice(0, 20)
        .map(({ id, at, siteId, deviceId, summary }) => ({ id, at, siteId, deviceId, summary })),
    };
  }

  // ── Mutaciones ───────────────────────────────────────────

  /** Prepara un dispositivo para un escenario (no emite eventos). */
  configure(deviceId: string, patch: { sticky?: boolean; transactionInFlight?: boolean }): void {
    const d = this.device(deviceId);
    if (!d) return;
    Object.assign(d, patch);
    this.save();
  }

  /** El datáfono se bloquea con un síntoma concreto. */
  async lock(deviceId: string, cause: LockCause): Promise<void> {
    const d = this.device(deviceId);
    if (!d || d.status === 'locked') return;
    await this.changeStatus(d, 'locked', {
      cause,
      detail: `${STATUS_LABEL[d.status]} → bloqueado: ${CAUSE_LABEL[cause]}`,
    });
  }

  /** La impresora se queda sin papel. */
  async paperOut(deviceId: string): Promise<void> {
    const d = this.device(deviceId);
    if (!d || d.type !== 'impresora' || d.status === 'paper_out') return;
    await this.changeStatus(d, 'paper_out', { detail: `${STATUS_LABEL[d.status]} → sin papel` });
  }

  /**
   * Inicia un reinicio remoto: `restarting` y, pasado un momento, `ok`
   * (o `locked` otra vez si el fallo es persistente).
   */
  async restart(deviceId: string, reason: string, by: Actor): Promise<ToolResult> {
    const d = this.device(deviceId);
    if (!d) {
      return { ok: false, content: `No existe el dispositivo «${deviceId}».` };
    }
    const name = deviceName(this.api, d);
    if (d.status === 'restarting') {
      return { ok: false, content: `El ${name} ya se está reiniciando. Espera a que termine antes de volver a intentarlo.` };
    }
    if (d.status === 'offline') {
      return { ok: false, content: `El ${name} está sin conexión: no se puede reiniciar en remoto.` };
    }
    if (d.status === 'paper_out') {
      return { ok: false, content: `La ${name} está sin papel: reiniciarla no lo arregla. Hay que avisar a la tienda.` };
    }

    const at = new Date().toISOString();
    const from = d.status;
    d.restarts = [...d.restarts, at].slice(-20);
    await this.changeStatus(d, 'restarting', {
      kind: 'restart',
      detail: `Reinicio remoto solicitado por ${ACTOR_LABEL[by]} (${STATUS_LABEL[from]} → reiniciando). Motivo: ${reason}`,
    });
    this.scheduleRestartEnd(d.id);

    const restartsLastHour = this.restartsLastHour(d);
    return {
      ok: true,
      content:
        `Reinicio iniciado en el ${name}. Tarda unos segundos; el resultado quedará en el historial del dispositivo. ` +
        `Reinicios en la última hora: ${restartsLastHour}.`,
      data: { deviceId: d.id, status: d.status, restartsLastHour, restartedAt: at },
    };
  }

  /** Aviso a la tienda (simulado). La tienda reacciona: si tiene una impresora sin papel, lo repone. */
  addStoreNotice(siteId: string, message: string): StoreNotice {
    const notice: StoreNotice = { at: new Date().toISOString(), siteId, message };
    this.state.storeNotices = [...this.state.storeNotices, notice].slice(-LIST_LIMIT);
    this.save();

    for (const printer of this.siteDevices(siteId).filter((d) => d.status === 'paper_out')) {
      this.schedule(this.api.fast ? 5 : 5000, async () => {
        const current = this.device(printer.id);
        if (current?.status !== 'paper_out') return;
        await this.changeStatus(current, 'ok', { detail: 'sin papel → operativo: la tienda ha repuesto el papel tras el aviso' });
      });
    }
    return notice;
  }

  /** Visita de técnico (simulada). */
  openFieldTicket(input: { siteId: string; deviceId?: string; summary: string; caseId?: string }): FieldTicket {
    const ticket: FieldTicket = {
      id: `FT-${this.state.nextTicketNumber++}`,
      at: new Date().toISOString(),
      siteId: input.siteId,
      deviceId: input.deviceId,
      summary: input.summary,
      caseId: input.caseId,
    };
    this.state.fieldTickets = [...this.state.fieldTickets, ticket].slice(-LIST_LIMIT);
    this.save();
    return ticket;
  }

  /** Despliega una versión en todos los datáfonos; el fallo persistente desaparece. Devuelve cuántos cambian. */
  deployVersion(newVersion: string): number {
    const at = new Date().toISOString();
    let changed = 0;
    for (const d of this.state.devices) {
      if (d.type !== 'datafono') continue;
      d.sticky = false;
      if (d.softwareVersion === newVersion) continue;
      this.pushHistory({
        at,
        deviceId: d.id,
        siteId: d.siteId,
        clientId: d.clientId,
        deviceType: d.type,
        kind: 'update',
        softwareVersion: newVersion,
        detail: `Actualización de software ${d.softwareVersion} → ${newVersion}`,
      });
      d.softwareVersion = newVersion;
      changed++;
    }
    this.save();
    return changed;
  }

  /** Activa o desactiva la actividad de fondo (un incidente menor cada ~20 s). */
  setAmbient(on: boolean): void {
    this.state.ambient = on;
    if (on) this.startAmbient();
    else if (this.ambientTimer) {
      clearTimeout(this.ambientTimer);
      this.ambientTimer = undefined;
    }
    this.save();
  }

  // ── Interno ──────────────────────────────────────────────

  private save(): void {
    this.api.store.setValue(PROJECT_ID, this.state);
    this.api.projects.changed(PROJECT_ID);
  }

  private pushHistory(entry: HistoryEntry): void {
    this.state.history.push(entry);
    if (this.state.history.length > HISTORY_LIMIT) {
      this.state.history.splice(0, this.state.history.length - HISTORY_LIMIT);
    }
  }

  private async changeStatus(
    d: Device,
    to: DeviceStatus,
    entry: { kind?: 'status' | 'restart'; cause?: LockCause; detail: string },
  ): Promise<void> {
    const from = d.status;
    if (from === to) return;
    d.status = to;
    if (to === 'locked' && entry.cause) d.lockCause = entry.cause;
    this.pushHistory({
      at: new Date().toISOString(),
      deviceId: d.id,
      siteId: d.siteId,
      clientId: d.clientId,
      deviceType: d.type,
      kind: entry.kind ?? 'status',
      from,
      to,
      cause: entry.cause,
      softwareVersion: d.softwareVersion,
      detail: entry.detail,
    });
    this.save();

    const payload: DeviceStatusChanged = {
      deviceId: d.id,
      siteId: d.siteId,
      clientId: d.clientId,
      deviceType: d.type,
      from,
      to,
      softwareVersion: d.softwareVersion,
    };
    await this.api.rules.emit('device.status_changed', payload);
  }

  private schedule(ms: number, fn: () => Promise<void>): void {
    const generation = this.generation;
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (generation !== this.generation) return;
      fn().catch((err) => console.error('[dispositivo] Error en un temporizador del simulador:', err));
    }, ms);
    this.timers.add(handle);
  }

  private scheduleRestartEnd(deviceId: string): void {
    this.schedule(this.api.fast ? 5 : 1500, async () => {
      const d = this.device(deviceId);
      if (d?.status !== 'restarting') return;
      if (d.sticky) {
        const cause = d.lockCause ?? 'screen_frozen';
        await this.changeStatus(d, 'locked', {
          cause,
          detail: `reiniciando → bloqueado: el fallo vuelve tras el reinicio (${CAUSE_LABEL[cause]})`,
        });
      } else {
        await this.changeStatus(d, 'ok', { detail: 'reiniciando → operativo: reinicio completado' });
      }
    });
  }

  private startAmbient(): void {
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    const generation = this.generation;
    const delay = this.api.fast ? 20 : 15_000 + Math.random() * 10_000;
    this.ambientTimer = setTimeout(async () => {
      this.ambientTimer = undefined;
      if (generation !== this.generation || !this.state.ambient) return;
      try {
        await this.ambientTick();
      } catch (err) {
        console.error('[dispositivo] Error en la actividad de fondo:', err);
      }
      if (generation === this.generation && this.state.ambient) this.startAmbient();
    }, delay);
  }

  /**
   * Un incidente menor que las reglas resuelven solas: papel o un bloqueo simple.
   * Nunca provoca una ola (como mucho un bloqueo por ventana) ni deja aprobaciones en cola.
   */
  private async ambientTick(): Promise<void> {
    const platform = this.api;
    const free = this.state.devices.filter(
      (d) => d.status === 'ok' && !platform.cases.findOpen((c) => c.project === PROJECT_ID && c.data.deviceId === d.id),
    );

    if (this.recentLocks(WAVE_WINDOW_MS).length === 0 && Math.random() < 0.4) {
      for (const d of shuffle(free.filter((x) => x.type === 'datafono'))) {
        const evaluation = await platform.policy.evaluate(
          'dispositivo_restart_device',
          { deviceId: d.id, reason: 'Actividad de fondo' },
          { clientId: d.clientId, siteId: d.siteId, deviceId: d.id },
          '',
        );
        if (evaluation.decision === 'auto' || evaluation.decision === 'notify') {
          await this.lock(d.id, 'screen_frozen');
          return;
        }
      }
    }

    const printers = free.filter((d) => d.type === 'impresora');
    if (printers.length > 0) await this.paperOut(pick(printers).id);
  }
}

/** Un simulador por proceso: la demo registra el proyecto una sola vez. */
export const simulator = new FleetSimulator();
