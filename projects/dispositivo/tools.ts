/** Herramientas del proyecto dispositivo (docs/CONTRACTS.md § 6.1). Descripciones escritas para el modelo. */
import type { PlatformApi, Scope, ToolDefinition, ToolResult } from '../../platform/contracts.ts';
import {
  CAUSE_LABEL,
  HOUR_MS,
  PROJECT_ID,
  STATUS_LABEL,
  TYPE_LABEL,
  deviceName,
  deviceWhere,
  formatTime,
  isStoreOpen,
  simulator,
  unique,
  type Device,
} from './simulator.ts';

interface FleetStatusInput {
  clientId?: string;
}
interface DeviceInput {
  deviceId: string;
}
interface RestartInput {
  deviceId: string;
  reason: string;
}
interface NotifyStoreInput {
  siteId: string;
  message: string;
}
interface FieldTicketInput {
  siteId: string;
  deviceId?: string;
  summary: string;
}
interface SuspectedBugInput {
  symptom: string;
  evidence: string[];
  affectedSites: string[];
  softwareVersion: string;
}

/** Payload de `code.suspected_bug` (docs/CONTRACTS.md § 5). */
export interface SuspectedBugPayload {
  component: 'terminal-pagos';
  symptom: string;
  evidence: string[];
  affectedSites: string[];
  softwareVersion: string;
  sourceCaseId: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const textList = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function caseScope(platform: PlatformApi, caseId: string): Scope {
  return platform.cases.get(caseId)?.scope ?? {};
}

function deviceScope(platform: PlatformApi, caseId: string, deviceId: string): Scope {
  const d = simulator.device(deviceId);
  return d ? { clientId: d.clientId, siteId: d.siteId, deviceId: d.id } : caseScope(platform, caseId);
}

function siteScope(platform: PlatformApi, caseId: string, siteId: string): Scope {
  const site = platform.directory.site(siteId);
  return site ? { clientId: site.clientId, siteId: site.id } : caseScope(platform, caseId);
}

function unknownDevice(deviceId: string): ToolResult {
  return {
    ok: false,
    content:
      `No existe el dispositivo «${deviceId || '(vacío)'}». Los identificadores tienen la forma ` +
      '<tienda>:<etiqueta>, por ejemplo hr-centro:DAT-01; dispositivo_get_fleet_status los muestra.',
  };
}

function unknownSite(platform: PlatformApi, siteId: string): ToolResult {
  const ids = platform.directory.clients().flatMap((c) => c.sites.map((s) => s.id));
  return { ok: false, content: `No existe la tienda «${siteId || '(vacía)'}». Tiendas válidas: ${ids.join(', ')}.` };
}

function deviceLine(platform: PlatformApi, d: Device): string {
  const restarts = simulator.restartsLastHour(d);
  return (
    `- ${d.id} · ${TYPE_LABEL[d.type]} · ${deviceWhere(platform, d)} · ${STATUS_LABEL[d.status]}` +
    `${d.transactionInFlight ? ' · cobro en curso' : ''} · versión ${d.softwareVersion} · ` +
    `${plural(restarts, 'reinicio', 'reinicios')} en la última hora`
  );
}

/** Ficha sin la verdad oculta del simulador (`sticky`). */
function publicDevice(d: Device) {
  const { sticky: _hidden, ...visible } = d;
  return visible;
}

const getFleetStatus: ToolDefinition<FleetStatusInput> = {
  name: 'dispositivo_get_fleet_status',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Resumen del estado de los dispositivos en tienda (datáfonos, impresoras y routers): ' +
    'dispositivos que ahora mismo no están operativos, incidencias de la última hora (bloqueos, caídas, ' +
    'falta de papel) con la versión de software y el estado actual de cada dispositivo, y reparto de ' +
    'versiones de los datáfonos. Úsala para medir el alcance de un problema y detectar patrones entre ' +
    'tiendas. Opcionalmente filtra por cliente. No tiene efectos.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: {
        type: 'string',
        description: 'Identificador del cliente, por ejemplo horno-real. Si se omite, todos los dispositivos.',
      },
    },
  },
  scope: (input, { platform, caseId }) =>
    text(input?.clientId) ? { clientId: text(input.clientId) } : caseScope(platform, caseId),
  describe: (input, platform) => {
    const clientId = text(input?.clientId);
    return clientId
      ? `Consultar el estado de los dispositivos de ${platform.directory.client(clientId)?.name ?? clientId}`
      : 'Consultar el estado de todos los dispositivos';
  },
  async handler(input, { platform }) {
    const clientId = text(input?.clientId);
    if (clientId && !platform.directory.client(clientId)) {
      const ids = platform.directory.clients().map((c) => c.id);
      return { ok: false, content: `No existe el cliente «${clientId}». Clientes válidos: ${ids.join(', ')}.` };
    }

    const devices = simulator.devices().filter((d) => !clientId || d.clientId === clientId);
    const siteCount = unique(devices.map((d) => d.siteId)).length;
    const notOk = devices.filter((d) => d.status !== 'ok');
    const incidents = simulator
      .incidents(HOUR_MS)
      .filter((e) => !clientId || e.clientId === clientId)
      .slice(-25);
    const versions: Record<string, number> = {};
    for (const d of devices) {
      if (d.type === 'datafono') versions[d.softwareVersion] = (versions[d.softwareVersion] ?? 0) + 1;
    }

    const lines = [
      `Estado de ${clientId ? platform.directory.describeScope({ clientId }) : 'todos los dispositivos'}: ` +
        `${siteCount} tiendas, ${devices.length} dispositivos.`,
      notOk.length ? `Dispositivos no operativos ahora (${notOk.length}):` : 'Dispositivos no operativos ahora: ninguno.',
      ...notOk.map((d) => deviceLine(platform, d)),
      incidents.length
        ? `Incidencias de la última hora (${incidents.length}, de más antigua a más reciente):`
        : 'Incidencias de la última hora: ninguna.',
      ...incidents.map((e) => {
        const d = simulator.device(e.deviceId);
        const now = d ? `ahora ${STATUS_LABEL[d.status]}` : 'estado actual desconocido';
        const where = platform.directory.describeScope({ clientId: e.clientId, siteId: e.siteId });
        return `- ${formatTime(e.at)} · ${e.deviceId} · ${where} · ${e.detail} · versión ${e.softwareVersion} · ${now}`;
      }),
      `Versiones de software de los datáfonos: ${Object.entries(versions)
        .map(([version, n]) => `${version} (${n})`)
        .join(', ')}.`,
    ];

    return {
      ok: true,
      content: lines.join('\n'),
      data: {
        clientId: clientId || undefined,
        sites: siteCount,
        devices: devices.length,
        notOk: notOk.map((d) => ({
          id: d.id,
          type: d.type,
          siteId: d.siteId,
          clientId: d.clientId,
          status: d.status,
          softwareVersion: d.softwareVersion,
          restartsLastHour: simulator.restartsLastHour(d),
        })),
        incidents,
        datafonoVersions: versions,
      },
    };
  },
};

const getDevice: ToolDefinition<DeviceInput> = {
  name: 'dispositivo_get_device',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Ficha completa de un dispositivo: tipo, modelo, versión de software, tienda y horario (y si está ' +
    'abierta ahora), estado actual, si hay un cobro en curso, reinicios de la última hora, último síntoma ' +
    'de bloqueo y estado del resto de dispositivos de la misma tienda. No tiene efectos.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Identificador del dispositivo, por ejemplo hr-centro:DAT-01.' },
    },
    required: ['deviceId'],
  },
  scope: (input, { platform, caseId }) => deviceScope(platform, caseId, text(input?.deviceId)),
  describe: (input) => `Consultar la ficha de ${text(input?.deviceId) || 'un dispositivo'}`,
  async handler(input, { platform }) {
    const deviceId = text(input?.deviceId);
    const d = simulator.device(deviceId);
    if (!d) return unknownDevice(deviceId);

    const site = platform.directory.site(d.siteId);
    const storeOpen = site ? isStoreOpen(site) : false;
    const restartsLastHour = simulator.restartsLastHour(d);
    const lastRestartAt = d.restarts.at(-1);
    const siblings = simulator.siteDevices(d.siteId).filter((x) => x.id !== d.id);

    const lines = [
      `Ficha de ${d.id}`,
      `- Tipo: ${TYPE_LABEL[d.type]} · modelo ${d.model} · versión de software ${d.softwareVersion}`,
      `- Tienda: ${deviceWhere(platform, d)}${site ? ` (${site.city}) · horario ${site.open}–${site.close}` : ''} · ` +
        `${storeOpen ? 'abierta ahora' : 'cerrada ahora'}`,
      `- Estado: ${STATUS_LABEL[d.status]}${d.type === 'datafono' ? ` · cobro en curso: ${d.transactionInFlight ? 'sí' : 'no'}` : ''}`,
      `- Reinicios en la última hora: ${restartsLastHour}${lastRestartAt ? ` (último a las ${formatTime(lastRestartAt)})` : ''}`,
      ...(d.lockCause ? [`- Último síntoma de bloqueo registrado: ${CAUSE_LABEL[d.lockCause]}`] : []),
      `- Otros dispositivos de la tienda: ${siblings
        .map((x) => `${x.label} (${TYPE_LABEL[x.type]}, versión ${x.softwareVersion}) ${STATUS_LABEL[x.status]}`)
        .join('; ')}`,
    ];

    return {
      ok: true,
      content: lines.join('\n'),
      data: {
        device: publicDevice(d),
        site,
        storeOpen,
        restartsLastHour,
        lastRestartAt,
        lastSymptom: d.lockCause ? CAUSE_LABEL[d.lockCause] : undefined,
        siblings: siblings.map((x) => ({ id: x.id, type: x.type, status: x.status, softwareVersion: x.softwareVersion })),
      },
    };
  },
};

const getDeviceHistory: ToolDefinition<DeviceInput> = {
  name: 'dispositivo_get_device_history',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Historial reciente de un dispositivo en orden cronológico: cambios de estado con su síntoma, reinicios ' +
    'remotos (quién los pidió y por qué), resultado de cada reinicio y actualizaciones de software. Sirve para ' +
    'ver si un reinicio arregla el fallo o si vuelve. No tiene efectos.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Identificador del dispositivo, por ejemplo fb-gracia:DAT-01.' },
    },
    required: ['deviceId'],
  },
  scope: (input, { platform, caseId }) => deviceScope(platform, caseId, text(input?.deviceId)),
  describe: (input) => `Consultar el historial de ${text(input?.deviceId) || 'un dispositivo'}`,
  async handler(input, { platform }) {
    const deviceId = text(input?.deviceId);
    const d = simulator.device(deviceId);
    if (!d) return unknownDevice(deviceId);

    const entries = simulator.historyOf(d.id, 20);
    const restartsLastHour = simulator.restartsLastHour(d);
    const lines = [
      `Historial de ${d.id} (${TYPE_LABEL[d.type]} · ${deviceWhere(platform, d)}):`,
      ...(entries.length
        ? entries.map((e) => `- ${formatTime(e.at)} · ${e.detail} · versión ${e.softwareVersion}`)
        : ['- Sin cambios registrados.']),
      `Reinicios en la última hora: ${restartsLastHour}. Estado actual: ${STATUS_LABEL[d.status]}.`,
    ];

    return {
      ok: true,
      content: lines.join('\n'),
      data: {
        deviceId: d.id,
        status: d.status,
        softwareVersion: d.softwareVersion,
        restartsLastHour,
        entries: entries.map(({ at, kind, from, to, cause, softwareVersion, detail }) => ({
          at,
          kind,
          from,
          to,
          cause,
          softwareVersion,
          detail,
        })),
      },
    };
  },
};

const restartDevice: ToolDefinition<RestartInput> = {
  name: 'dispositivo_restart_device',
  project: PROJECT_ID,
  risk: 'physical',
  description:
    'Reinicia en remoto un dispositivo de tienda (normalmente un datáfono bloqueado). Tarda unos segundos, ' +
    'corta cualquier operación en curso y su resultado aparece después en el historial del dispositivo. ' +
    'No sirve para un dispositivo sin conexión ni repone papel. Pasa por la política: puede bloquearse ' +
    '(cobro en curso), quedar pendiente de aprobación o escalarse si ya se ha reiniciado demasiadas veces.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Identificador del dispositivo, por ejemplo hr-centro:DAT-01.' },
      reason: { type: 'string', description: 'Por qué se reinicia, en una frase.' },
    },
    required: ['deviceId', 'reason'],
  },
  scope: (input, { platform, caseId }) => deviceScope(platform, caseId, text(input?.deviceId)),
  describe: (input) => {
    const d = simulator.device(text(input?.deviceId));
    return d ? `Reiniciar ${TYPE_LABEL[d.type]} ${d.label}` : `Reiniciar el dispositivo ${text(input?.deviceId)}`;
  },
  async handler(input, ctx) {
    const deviceId = text(input?.deviceId);
    if (!simulator.device(deviceId)) return unknownDevice(deviceId);
    return simulator.restart(deviceId, text(input?.reason) || 'Sin motivo indicado', ctx.actor);
  },
};

const notifyStore: ToolDefinition<NotifyStoreInput> = {
  name: 'dispositivo_notify_store',
  project: PROJECT_ID,
  risk: 'write_external',
  description:
    'Envía un aviso breve al personal de una tienda (por ejemplo, reponer papel o cobrar por otra vía ' +
    'mientras llega un técnico). Lo lee la tienda: escribe en español claro, sin tecnicismos, y no ' +
    'prometas nada que todavía esté pendiente de aprobación.',
  inputSchema: {
    type: 'object',
    properties: {
      siteId: { type: 'string', description: 'Identificador de la tienda, por ejemplo hr-centro.' },
      message: { type: 'string', description: 'Texto del aviso, una o dos frases.' },
    },
    required: ['siteId', 'message'],
  },
  scope: (input, { platform, caseId }) => siteScope(platform, caseId, text(input?.siteId)),
  describe: (input) => {
    const message = text(input?.message);
    return `Avisar a la tienda: «${message.length > 80 ? `${message.slice(0, 79)}…` : message}»`;
  },
  async handler(input, { platform }) {
    const siteId = text(input?.siteId);
    const message = text(input?.message);
    if (!platform.directory.site(siteId)) return unknownSite(platform, siteId);
    if (!message) return { ok: false, content: 'El aviso está vacío: indica el mensaje para la tienda.' };

    const notice = simulator.addStoreNotice(siteId, message);
    return {
      ok: true,
      content: `Aviso enviado a ${platform.directory.describeScope({ siteId })}: «${message}»`,
      data: notice,
    };
  },
};

const openFieldTicket: ToolDefinition<FieldTicketInput> = {
  name: 'dispositivo_open_field_ticket',
  project: PROJECT_ID,
  risk: 'write_external',
  description:
    'Pide una visita de técnico a una tienda. Cuesta dinero y tiempo: úsala cuando el fallo no se arregla en ' +
    'remoto y apunta a hardware o a la instalación de esa tienda, no para fallos de software. El resumen es ' +
    'para el técnico: dispositivo, síntoma, reinicios y cuándo, qué se ha descartado y qué conviene revisar o llevar.',
  inputSchema: {
    type: 'object',
    properties: {
      siteId: { type: 'string', description: 'Identificador de la tienda, por ejemplo fb-gracia.' },
      deviceId: { type: 'string', description: 'Dispositivo afectado, si lo hay, por ejemplo fb-gracia:DAT-01.' },
      summary: { type: 'string', description: 'Resumen para el técnico.' },
    },
    required: ['siteId', 'summary'],
  },
  scope: (input, { platform, caseId }) => {
    const deviceId = text(input?.deviceId);
    return deviceId && simulator.device(deviceId)
      ? deviceScope(platform, caseId, deviceId)
      : siteScope(platform, caseId, text(input?.siteId));
  },
  describe: (input) => {
    const d = simulator.device(text(input?.deviceId));
    return d ? `Pedir visita de técnico para el ${TYPE_LABEL[d.type]} ${d.label}` : 'Pedir visita de técnico';
  },
  async handler(input, { platform, caseId }) {
    const siteId = text(input?.siteId);
    const deviceId = text(input?.deviceId);
    const summary = text(input?.summary);
    if (!platform.directory.site(siteId)) return unknownSite(platform, siteId);
    if (!summary) return { ok: false, content: 'Falta el resumen para el técnico.' };
    const d = deviceId ? simulator.device(deviceId) : undefined;
    if (deviceId && !d) return unknownDevice(deviceId);
    if (d && d.siteId !== siteId) {
      return { ok: false, content: `El dispositivo ${d.id} no pertenece a la tienda ${siteId}.` };
    }

    const ticket = simulator.openFieldTicket({ siteId, deviceId: d?.id, summary, caseId });
    return {
      ok: true,
      content:
        `Visita de técnico solicitada (${ticket.id}) para ${d ? deviceName(platform, d) : platform.directory.describeScope({ siteId })}. ` +
        `Resumen enviado: ${summary}`,
      data: ticket,
    };
  },
};

const reportSuspectedBug: ToolDefinition<SuspectedBugInput> = {
  name: 'dispositivo_report_suspected_bug',
  project: PROJECT_ID,
  risk: 'write_internal',
  description:
    'Reporta al equipo de código una sospecha de fallo de software en el terminal de pagos (componente ' +
    'terminal-pagos). Úsala una sola vez por caso, cuando el mismo síntoma se repite en varias tiendas con la ' +
    'misma versión y el reinicio solo lo arregla temporalmente. La evidencia debe ser concreta y verificable ' +
    '(identificadores, horas, versión, síntoma literal, efecto del reinicio). Abre un caso de código si no hay uno en curso.',
  inputSchema: {
    type: 'object',
    properties: {
      symptom: { type: 'string', description: 'Síntoma observado, en una o dos frases.' },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pruebas concretas, una por elemento.',
      },
      affectedSites: {
        type: 'array',
        items: { type: 'string' },
        description: 'Identificadores de las tiendas afectadas, por ejemplo hr-ruzafa.',
      },
      softwareVersion: { type: 'string', description: 'Versión de software de los terminales afectados, por ejemplo 2.14.2.' },
    },
    required: ['symptom', 'evidence', 'affectedSites', 'softwareVersion'],
  },
  describe: (input) => {
    const sites = textList(input?.affectedSites).length;
    const version = text(input?.softwareVersion);
    return `Reportar posible bug de terminal-pagos${version ? ` ${version}` : ''} (${plural(sites, 'tienda', 'tiendas')})`;
  },
  async handler(input, { platform, caseId }) {
    const symptom = text(input?.symptom);
    const evidence = textList(input?.evidence);
    const affectedSites = unique(textList(input?.affectedSites));
    const softwareVersion = text(input?.softwareVersion);
    if (!symptom || evidence.length === 0 || affectedSites.length === 0 || !softwareVersion) {
      return {
        ok: false,
        content: 'Faltan datos: symptom, evidence (al menos una prueba), affectedSites y softwareVersion son obligatorios.',
      };
    }

    const payload: SuspectedBugPayload = {
      component: 'terminal-pagos',
      symptom,
      evidence,
      affectedSites,
      softwareVersion,
      sourceCaseId: caseId,
    };
    await platform.rules.emit('code.suspected_bug', payload);
    return {
      ok: true,
      content:
        `Sospecha de bug enviada al equipo de código: componente terminal-pagos, versión ${softwareVersion}, ` +
        `${plural(affectedSites.length, 'tienda afectada', 'tiendas afectadas')}, ${plural(evidence.length, 'prueba', 'pruebas')}. ` +
        'Si no hay ya un caso de código en curso, se abrirá uno.',
      data: payload,
    };
  },
};

export const dispositivoTools: ToolDefinition[] = [
  getFleetStatus,
  getDevice,
  getDeviceHistory,
  restartDevice,
  notifyStore,
  openFieldTicket,
  reportSuspectedBug,
];
