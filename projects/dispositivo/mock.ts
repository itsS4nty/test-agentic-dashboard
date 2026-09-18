/**
 * Guion del modo simulado para el agente `dispositivos`.
 *
 * Avanza según las herramientas que ya ha usado (no según el número de turno) y construye
 * sus entradas con IDs y datos reales leídos del simulador. Nunca afirma haber hecho algo
 * que la política no dejó ejecutar.
 */
import type { Case, MockContext, MockScript, MockToolResult, MockTurn } from '../../platform/contracts.ts';
import {
  CAUSE_LABEL,
  HOUR_MS,
  INITIAL_DATAFONO_VERSION,
  STATUS_LABEL,
  TYPE_LABEL,
  WAVE_WINDOW_MS,
  deviceName,
  deviceWhere,
  formatTime,
  simulator,
  unique,
  type Device,
  type LockCause,
} from './simulator.ts';

const resultsOf = (ctx: MockContext, name: string): MockToolResult[] => ctx.allResults.filter((r) => r.name === name);

/** El caso tal y como está ahora (la regla de ola puede haber añadido dispositivos). */
function currentCase(ctx: MockContext): Case {
  return ctx.platform.cases.get(ctx.caseRecord.id) ?? ctx.caseRecord;
}

/** Frase honesta sobre lo que ha pasado con una acción según la política. */
function actionOutcome(result: MockToolResult, done: string, what: string): string {
  if (result.executed && result.ok) return done;
  switch (result.decision) {
    case 'approve':
      return `${what} está pendiente de aprobación humana: todavía no se ha hecho.`;
    case 'shadow':
      return `${what} se ha registrado en modo sombra: no se ha ejecutado.`;
    case 'deny':
      return `${what} lo ha bloqueado la política (${result.content}).`;
    case 'escalate':
      return `${what} lo ha escalado la política a una persona (${result.content}).`;
    default:
      return `${what} no se ha podido completar: ${result.content}`;
  }
}

// ── Caso de ola ────────────────────────────────────────────

function waveDevices(ctx: MockContext, c: Case): Device[] {
  const cause = c.data.cause as LockCause | undefined;
  const fromCase = Array.isArray(c.data.devices) ? (c.data.devices as string[]) : [];
  const ids = fromCase.length ? fromCase : unique(simulator.recentLocks(WAVE_WINDOW_MS, cause).map((e) => e.deviceId));
  return ids.map((id) => simulator.device(id)).filter((d): d is Device => Boolean(d));
}

/** Dos dispositivos representativos: a ser posible de clientes distintos. */
function pickTwo(devices: Device[]): Device[] {
  const [first] = devices;
  if (!first) return [];
  const second = devices.find((d) => d.clientId !== first.clientId) ?? devices[1];
  return second ? [first, second] : [first];
}

function waveTurn(ctx: MockContext): MockTurn {
  const c = currentCase(ctx);
  const { platform } = ctx;

  if (resultsOf(ctx, 'dispositivo_get_fleet_status').length === 0) {
    return {
      text: 'Empiezo por el estado de los dispositivos para medir el alcance de los bloqueos y ver versiones.',
      toolCalls: [{ name: 'dispositivo_get_fleet_status', input: {} }],
    };
  }

  const devices = waveDevices(ctx, c);
  if (devices.length === 0) {
    return {
      text:
        'Diagnóstico: no encuentro entre los dispositivos los datáfonos de la ola, así que no puedo confirmar un patrón.\n\n' +
        'Acciones: ninguna.\n\nPendiente: que Operaciones revise los datos del caso.',
    };
  }

  if (resultsOf(ctx, 'dispositivo_get_device_history').length === 0) {
    const sample = pickTwo(devices);
    return {
      text:
        `El mismo síntoma aparece en ${devices.length} datáfonos de varias tiendas. Reviso el historial de ` +
        `${sample.map((d) => d.id).join(' y ')} para ver qué pasa antes y después de cada bloqueo.`,
      toolCalls: sample.map((d) => ({ name: 'dispositivo_get_device_history', input: { deviceId: d.id } })),
    };
  }

  const cause = (c.data.cause as LockCause | undefined) ?? devices[0].lockCause ?? 'payment_timeout';
  const ids = devices.map((d) => d.id);
  const locks = simulator.recentLocks(HOUR_MS, cause).filter((e) => ids.includes(e.deviceId));
  const versions = unique((locks.length ? locks : devices).map((x) => x.softwareVersion));
  const softwareVersion = versions[0] ?? INITIAL_DATAFONO_VERSION;
  const sites = unique(devices.map((d) => d.siteId));
  const clientNames = unique(devices.map((d) => platform.directory.client(d.clientId)?.name ?? d.clientId));
  const recovered = devices.filter((d) =>
    simulator.historyOf(d.id, 50).some((e) => e.from === 'restarting' && e.to === 'ok'),
  );
  const othersOk = sites.every((siteId) =>
    simulator
      .siteDevices(siteId)
      .filter((d) => d.type !== 'datafono')
      .every((d) => d.status === 'ok'),
  );

  const reports = resultsOf(ctx, 'dispositivo_report_suspected_bug');
  if (reports.length === 0) {
    const firstAt = locks.length ? formatTime(locks[0].at) : undefined;
    const lastAt = locks.length ? formatTime(locks[locks.length - 1].at) : undefined;
    const when = !firstAt ? '' : firstAt === lastAt ? ` a las ${firstAt}` : ` entre las ${firstAt} y las ${lastAt}`;
    const evidence = [
      `${devices.length} datáfonos bloqueados en ${sites.length} tiendas de ${clientNames.join(' y ')}${when}: ${ids.join(', ')}`,
      versions.length === 1
        ? `Todos los afectados ejecutan la misma versión del software del terminal: ${softwareVersion}`
        : `Versiones en los afectados: ${versions.join(', ')}`,
      `Mismo síntoma en el historial de todos: «${CAUSE_LABEL[cause]}»`,
      recovered.length
        ? `El reinicio remoto lo arregla solo temporalmente: ${recovered.map((d) => d.id).join(', ')} vuelven a operativo tras reiniciar`
        : 'Los reinicios remotos de las reglas están en curso en los terminales afectados',
      ...(othersOk
        ? ['Impresoras y routers de las tiendas afectadas funcionan con normalidad: se descarta un problema de red o de la tienda']
        : []),
    ];
    const symptom =
      cause === 'payment_timeout'
        ? 'Los datáfonos se quedan en «Terminal ocupado» después de un timeout de cobro y el siguiente cobro falla hasta reiniciar el terminal'
        : `Datáfonos bloqueados en varias tiendas: ${CAUSE_LABEL[cause]}`;

    return {
      text:
        `Misma versión (${softwareVersion}) y mismo síntoma en ${sites.length} tiendas` +
        (recovered.length ? ', y el reinicio solo lo arregla temporalmente' : '') +
        ': apunta a un fallo de software, no a hardware ni a red. Lo reporto al equipo de código.',
      toolCalls: [
        {
          name: 'dispositivo_report_suspected_bug',
          input: { symptom, evidence, affectedSites: sites, softwareVersion },
        },
      ],
    };
  }

  const report = reports[0];
  const reportLine = actionOutcome(
    report,
    'He reportado la sospecha de bug al equipo de código (componente terminal-pagos) con la evidencia.',
    'El reporte de la sospecha de bug',
  );
  return {
    text: [
      `Diagnóstico: ola de bloqueos de datáfono en ${sites.length} tiendas (${clientNames.join(' y ')}), todas con la ` +
        `versión ${softwareVersion} y el mismo síntoma: «${CAUSE_LABEL[cause]}». ` +
        (recovered.length
          ? `El reinicio lo arregla solo temporalmente${othersOk ? ' y el resto de dispositivos de esas tiendas funciona' : ''}, así que apunta a un fallo de software y no de hardware o red.`
          : `${othersOk ? 'El resto de dispositivos de esas tiendas funciona, así que' : 'Por el patrón,'} apunta a un fallo de software y no de hardware o red; los reinicios de las reglas seguían en curso cuando lo revisé.`),
      `Acciones: ${reportLine} No he pedido visitas de técnico: no arreglarían un fallo de software.`,
      report.executed && report.ok
        ? 'Pendiente: que el equipo de código confirme la causa y despliegue el arreglo. Mientras tanto, la regla seguirá reiniciando los datáfonos que se bloqueen.'
        : 'Pendiente: que una persona revise el reporte para que llegue al equipo de código. Mientras tanto, la regla seguirá reiniciando los datáfonos que se bloqueen.',
    ].join('\n\n'),
  };
}

// ── Caso de un dispositivo que no se recupera ──────────────

function deviceTurn(ctx: MockContext): MockTurn {
  const c = currentCase(ctx);
  const { platform } = ctx;
  const deviceId = String(c.data.deviceId ?? c.scope.deviceId ?? '');
  const device = simulator.device(deviceId);
  if (!device) {
    return {
      text:
        'Diagnóstico: no encuentro el dispositivo del caso en el inventario, así que no puedo diagnosticarlo.\n\n' +
        'Acciones: ninguna.\n\nPendiente: que Operaciones revise los datos del caso.',
    };
  }
  const name = deviceName(platform, device);

  if (resultsOf(ctx, 'dispositivo_get_device').length === 0) {
    return {
      text: `Reviso la ficha del ${name}.`,
      toolCalls: [{ name: 'dispositivo_get_device', input: { deviceId: device.id } }],
    };
  }

  if (resultsOf(ctx, 'dispositivo_get_device_history').length === 0) {
    return {
      text: 'Miro el historial para ver qué ocurre después de cada reinicio.',
      toolCalls: [{ name: 'dispositivo_get_device_history', input: { deviceId: device.id } }],
    };
  }

  const restarts = simulator.restartsLastHour(device);
  const cause = device.lockCause;
  const symptom = cause ? CAUSE_LABEL[cause] : STATUS_LABEL[device.status];
  const siblings = simulator.siteDevices(device.siteId).filter((d) => d.id !== device.id);
  const siblingsOk = siblings.every((d) => d.status === 'ok');
  const otherSites = cause
    ? unique(simulator.recentLocks(HOUR_MS, cause).filter((e) => e.siteId !== device.siteId).map((e) => e.siteId))
    : [];
  const noPattern = otherSites.length === 0;

  const tickets = resultsOf(ctx, 'dispositivo_open_field_ticket');
  if (tickets.length === 0) {
    const summary = [
      `${TYPE_LABEL[device.type]} ${device.label} (${device.model}, versión ${device.softwareVersion}) se bloquea de nuevo ` +
        `tras cada reinicio remoto: ${restarts} reinicios en la última hora sin recuperarse.`,
      `Síntoma: ${symptom}.`,
      siblingsOk ? `${siblings.map((d) => d.label).join(' y ')} de la tienda funcionan: se descarta la red.` : '',
      noPattern ? 'No hay bloqueos con el mismo síntoma en otras tiendas.' : '',
      'Revisar el lector de tarjetas y llevar un terminal de sustitución por si no se recupera.',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      text:
        `Vuelve a bloquearse tras ${restarts} reinicios` +
        (noPattern ? ' y no hay un patrón parecido en otras tiendas' : '') +
        ': apunta a un fallo del propio terminal. Pido una visita de técnico.',
      toolCalls: [
        { name: 'dispositivo_open_field_ticket', input: { siteId: device.siteId, deviceId: device.id, summary } },
      ],
    };
  }

  const ticket = tickets[0];
  const ticketId = (ticket.data as { id?: string } | undefined)?.id;
  const ticketLine = actionOutcome(
    ticket,
    `He pedido una visita de técnico${ticketId ? ` (${ticketId})` : ''} con el diagnóstico.`,
    'La visita de técnico',
  );
  return {
    text: [
      `Diagnóstico: el ${name} vuelve a bloquearse tras cada reinicio remoto (${restarts} en la última hora, síntoma ` +
        `«${symptom}»).${siblingsOk ? ' El resto de dispositivos de la tienda funciona' : ''}` +
        `${noPattern ? ' y no hay el mismo síntoma en otras tiendas' : ''}, así que apunta a un fallo del propio ` +
        'terminal (hardware) y no a software ni a red.',
      `Acciones: ${ticketLine} No he vuelto a reiniciar: la política ya no lo permite y no lo arreglaría.`,
      ticket.executed && ticket.ok
        ? `Pendiente: que el técnico revise el lector o sustituya el terminal en ${deviceWhere(platform, device)}. Mientras tanto, la tienda debe cobrar por otra vía.`
        : 'Pendiente: que una persona apruebe la visita; después, que el técnico revise el lector o sustituya el terminal. Mientras tanto, la tienda debe cobrar por otra vía.',
    ].join('\n\n'),
  };
}

export const dispositivosMock: MockScript = (ctx) =>
  currentCase(ctx).data.kind === 'wave' ? waveTurn(ctx) : deviceTurn(ctx);
