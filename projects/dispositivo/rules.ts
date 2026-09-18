/** Reglas deterministas y predicados de política del proyecto dispositivo (docs/CONTRACTS.md § 6.1). */
import type {
  Case,
  CaseStatus,
  PlatformApi,
  PolicyPredicate,
  PredicateArgs,
  Rule,
} from '../../platform/contracts.ts';
import {
  CAUSE_LABEL,
  MAX_RESTARTS_PER_HOUR,
  PROJECT_ID,
  WAVE_WINDOW_MS,
  deviceName,
  deviceWhere,
  isStoreOpen,
  simulator,
  unique,
  type Device,
  type DeviceStatusChanged,
  type LockCause,
} from './simulator.ts';

export const DEVICE_AGENT = 'dispositivos';

/** Payload de `code.fix_merged` (docs/CONTRACTS.md § 5). */
export interface FixMergedPayload {
  component: 'terminal-pagos';
  prId: string;
  branch: string;
  newVersion: string;
}

const CASE_STATUS_TEXT: Record<CaseStatus, string> = {
  open: 'abierto',
  running: 'en manos del agente',
  waiting_approval: 'pendiente de aprobación',
  resolved: 'resuelto',
  escalated: 'escalado',
  failed: 'fallido',
};

// ── Casos del proyecto ─────────────────────────────────────

/** Caso no cerrado de un dispositivo concreto. */
export function findOpenDeviceCase(platform: PlatformApi, deviceId: string): Case | undefined {
  return platform.cases.findOpen(
    (c) => c.project === PROJECT_ID && c.data.kind === 'device' && c.data.deviceId === deviceId,
  );
}

/** Caso de ola no cerrado. */
export function findOpenWaveCase(platform: PlatformApi): Case | undefined {
  return platform.cases.findOpen((c) => c.project === PROJECT_ID && c.data.kind === 'wave');
}

/** Caso más reciente (en cualquier estado) que cumpla el filtro. */
export function latestDispositivoCase(platform: PlatformApi, predicate: (c: Case) => boolean): Case | undefined {
  return platform.cases.list({ project: PROJECT_ID }).filter(predicate).at(-1);
}

function mergeCaseData(platform: PlatformApi, caseId: string, patch: Record<string, unknown>): void {
  const current = platform.cases.get(caseId);
  if (current) platform.cases.update(caseId, { data: { ...current.data, ...patch } });
}

function symptomOf(d: Device): string {
  return d.lockCause ? CAUSE_LABEL[d.lockCause] : 'Bloqueo sin síntoma registrado';
}

// ── dispositivo.datafono_bloqueado ───────────────────────────────

async function onDatafonoLocked(p: DeviceStatusChanged, platform: PlatformApi): Promise<void> {
  const device = simulator.device(p.deviceId);
  if (!device) return;
  const symptom = symptomOf(device);
  const restartsBefore = simulator.restartsLastHour(device);

  let record = findOpenDeviceCase(platform, device.id);
  if (!record) {
    record = platform.cases.create({
      project: PROJECT_ID,
      title: `Datáfono bloqueado · ${deviceWhere(platform, device)}`,
      source: 'device',
      scope: { clientId: device.clientId, siteId: device.siteId, deviceId: device.id },
      severity: 'medium',
      data: {
        kind: 'device',
        deviceId: device.id,
        deviceType: device.type,
        softwareVersion: device.softwareVersion,
        symptom,
      },
    });
    platform.cases.addTimeline(record.id, {
      kind: 'rule',
      actor: 'rule',
      title: 'Regla dispositivo.datafono_bloqueado: datáfono bloqueado, se intenta un reinicio remoto',
      detail: symptom,
      data: { ruleId: 'dispositivo.datafono_bloqueado', deviceId: device.id },
    });
  } else if (record.status !== 'open') {
    // Ya lo lleva el agente, una persona o una aprobación: la regla no se mete.
    platform.cases.addTimeline(record.id, {
      kind: 'note',
      actor: 'rule',
      title: `Nuevo bloqueo registrado; el caso sigue ${CASE_STATUS_TEXT[record.status]}`,
      detail: symptom,
    });
    return;
  } else {
    platform.cases.addTimeline(record.id, {
      kind: 'rule',
      actor: 'rule',
      title: `Regla dispositivo.datafono_bloqueado: vuelve a bloquearse tras el reinicio (${restartsBefore} en la última hora)`,
      detail: symptom,
      data: { ruleId: 'dispositivo.datafono_bloqueado', deviceId: device.id, restartsLastHour: restartsBefore },
    });
  }

  const caseId = record.id;
  const outcome = await platform.tools.invoke(
    'dispositivo_restart_device',
    { deviceId: device.id, reason: `Bloqueo detectado: ${symptom}` },
    { caseId, actor: 'rule', reason: 'Regla dispositivo.datafono_bloqueado: un datáfono bloqueado se reinicia en remoto' },
  );

  switch (outcome.decision) {
    case 'auto':
    case 'notify':
      // Si arrancó, el simulador emitirá el siguiente cambio de estado y lo recoge onRestartFinished.
      if (!outcome.result.ok) {
        platform.cases.addTimeline(caseId, {
          kind: 'note',
          actor: 'rule',
          title: 'No se ha podido iniciar el reinicio; el caso queda abierto',
          detail: outcome.result.content,
        });
      }
      break;

    case 'approve':
      // La plataforma ya ha creado la aprobación y el caso espera a una persona.
      break;

    case 'shadow':
      platform.cases.addTimeline(caseId, {
        kind: 'note',
        actor: 'rule',
        title: 'Modo sombra: no se ha reiniciado',
        detail: 'La regla habría reiniciado el datáfono. El caso queda abierto.',
      });
      break;

    case 'deny':
      platform.cases.addTimeline(caseId, {
        kind: 'note',
        actor: 'rule',
        title: 'No se ha reiniciado: la política lo bloquea',
        detail: `${outcome.evaluation?.reason ?? outcome.result.content}. El caso queda abierto.`,
      });
      break;

    case 'escalate': {
      if (platform.cases.get(caseId)?.data.agentRequested) break;
      mergeCaseData(platform, caseId, { agentRequested: true });
      platform.cases.addTimeline(caseId, {
        kind: 'rule',
        actor: 'rule',
        title: 'Regla: el reinicio no lo arregla → caso asignado al agente de dispositivos',
        detail: outcome.evaluation?.reason,
      });
      const restarts = simulator.restartsLastHour(device);
      platform.runtime.enqueue({
        agentId: DEVICE_AGENT,
        caseId,
        task:
          `El ${deviceName(platform, device)} (${device.id}) ha vuelto a bloquearse después de ${restarts} ` +
          'reinicios remotos en la última hora. La política ya no permite más reinicios automáticos: el reinicio ' +
          'no lo arregla. Revisa la ficha y el historial del dispositivo, decide si hace falta una visita de ' +
          'técnico o si hay indicios de un fallo de software que afecte a otras tiendas, y actúa en consecuencia. ' +
          'Termina con un resumen para Operaciones.',
      });
      break;
    }
  }
}

/** Fin de un reinicio que lanzó la regla: si vuelve a funcionar, la regla cierra el caso. */
function onRestartFinished(p: DeviceStatusChanged, platform: PlatformApi): void {
  const device = simulator.device(p.deviceId);
  const record = findOpenDeviceCase(platform, p.deviceId);
  // Solo casos que sigue llevando la regla: los del agente o de una aprobación se cierran por su vía.
  if (!device || !record || record.status !== 'open') return;

  platform.cases.addTimeline(record.id, {
    kind: 'rule',
    actor: 'rule',
    title: 'El datáfono vuelve a estar operativo tras el reinicio',
    data: { ruleId: 'dispositivo.datafono_bloqueado', deviceId: device.id },
  });
  platform.cases.resolve(
    record.id,
    'rule',
    `Datáfono ${device.label} bloqueado (${symptomOf(device)}). La regla lo reinició en remoto y volvió a funcionar, ` +
      'sin IA ni intervención humana.',
  );
}

const datafonoBloqueado: Rule<DeviceStatusChanged> = {
  id: 'dispositivo.datafono_bloqueado',
  project: PROJECT_ID,
  description:
    'Cuando un datáfono se bloquea, abre (o reutiliza) el caso del dispositivo e intenta un reinicio remoto según ' +
    'la política. Si vuelve a funcionar, cierra el caso sin IA; si la política escala porque ya se ha reiniciado ' +
    'demasiadas veces, se lo pasa al agente de dispositivos.',
  on: 'device.status_changed',
  async handle(event, platform) {
    const p = event.payload;
    if (p.deviceType !== 'datafono') return;
    if (p.to === 'locked') await onDatafonoLocked(p, platform);
    else if (p.from === 'restarting' && p.to === 'ok') onRestartFinished(p, platform);
  },
};

// ── dispositivo.ola_de_bloqueos ──────────────────────────────────

const olaDeBloqueos: Rule<DeviceStatusChanged> = {
  id: 'dispositivo.ola_de_bloqueos',
  project: PROJECT_ID,
  description:
    'Si en 2 minutos se bloquean datáfonos con el mismo síntoma en 3 o más tiendas distintas y no hay ya una ola ' +
    'abierta, abre un único caso de ola (severidad alta) y lo asigna al agente de dispositivos.',
  on: 'device.status_changed',
  async handle(event, platform) {
    const p = event.payload;
    if (p.deviceType !== 'datafono' || p.to !== 'locked') return;
    const device = simulator.device(p.deviceId);
    const cause: LockCause | undefined = device?.lockCause;
    if (!device || !cause) return;

    const locks = simulator.recentLocks(WAVE_WINDOW_MS, cause);
    // Una racha es un único caso: aunque el agente ya haya cerrado la ola, los bloqueos que
    // siguen llegando dentro de la ventana se suman a ella en vez de abrir otra.
    const existing =
      findOpenWaveCase(platform) ??
      latestDispositivoCase(
        platform,
        (c) => c.data.kind === 'wave' && c.data.cause === cause && Date.now() - Date.parse(c.createdAt) < WAVE_WINDOW_MS,
      );
    if (existing) {
      const known = Array.isArray(existing.data.devices) ? (existing.data.devices as string[]) : [];
      if (existing.data.cause === cause && !known.includes(device.id)) {
        const sites = Array.isArray(existing.data.sites) ? (existing.data.sites as string[]) : [];
        mergeCaseData(platform, existing.id, {
          devices: [...known, device.id],
          sites: unique([...sites, device.siteId]),
        });
        platform.cases.addTimeline(existing.id, {
          kind: 'rule',
          actor: 'rule',
          title: `Se suma a la ola: ${deviceName(platform, device)}`,
          detail: `Versión ${device.softwareVersion} · ${CAUSE_LABEL[cause]}`,
        });
      }
      return;
    }

    const sites = unique(locks.map((e) => e.siteId));
    if (sites.length < 3) return;

    const devices = unique(locks.map((e) => e.deviceId));
    const versionCount = new Map<string, number>();
    for (const e of locks) versionCount.set(e.softwareVersion, (versionCount.get(e.softwareVersion) ?? 0) + 1);
    const softwareVersion = [...versionCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const clientIds = unique(locks.map((e) => e.clientId));
    const clientNames = clientIds.map((id) => platform.directory.client(id)?.name ?? id);

    const record = platform.cases.create({
      project: PROJECT_ID,
      title: 'Ola de bloqueos de datáfono',
      source: 'device',
      scope: {},
      severity: 'high',
      data: {
        kind: 'wave',
        devices,
        sites,
        clients: clientIds,
        softwareVersion,
        cause,
        symptom: CAUSE_LABEL[cause],
        detectedAt: event.at,
      },
    });
    platform.cases.addTimeline(record.id, {
      kind: 'rule',
      actor: 'rule',
      title: `Regla dispositivo.ola_de_bloqueos: ${devices.length} datáfonos bloqueados en ${sites.length} tiendas en menos de 2 minutos`,
      detail: `Síntoma común: ${CAUSE_LABEL[cause]} · clientes: ${clientNames.join(', ')} · versión ${softwareVersion}`,
      data: { ruleId: 'dispositivo.ola_de_bloqueos', devices, sites },
    });
    platform.runtime.enqueue({
      agentId: DEVICE_AGENT,
      caseId: record.id,
      task:
        `Ola de bloqueos de datáfono: ${devices.length} datáfonos en ${sites.length} tiendas distintas ` +
        `(${clientNames.join(' y ')}) en menos de 2 minutos, todos con el mismo síntoma («${CAUSE_LABEL[cause]}»). ` +
        `Versiones afectadas: ${[...versionCount.keys()].join(', ')}. Las reglas ya reinician cada terminal. ` +
        'Averigua si hay una causa común: revisa el estado de los dispositivos y el historial de algunos datáfonos ' +
        'afectados. Si la evidencia apunta a un fallo de software, repórtalo al equipo de código; si no, explica ' +
        'qué has encontrado. Termina con un resumen para Operaciones.',
    });
  },
};

// ── dispositivo.impresora_sin_papel ──────────────────────────────

const impresoraSinPapel: Rule<DeviceStatusChanged> = {
  id: 'dispositivo.impresora_sin_papel',
  project: PROJECT_ID,
  description:
    'Cuando una impresora se queda sin papel, abre un caso, avisa a la tienda para que lo reponga y cierra el caso por regla.',
  on: 'device.status_changed',
  async handle(event, platform) {
    const p = event.payload;
    if (p.deviceType !== 'impresora' || p.to !== 'paper_out') return;
    const device = simulator.device(p.deviceId);
    if (!device || findOpenDeviceCase(platform, device.id)) return;

    const record = platform.cases.create({
      project: PROJECT_ID,
      title: `Impresora sin papel · ${deviceWhere(platform, device)}`,
      source: 'device',
      scope: { clientId: device.clientId, siteId: device.siteId, deviceId: device.id },
      severity: 'low',
      data: { kind: 'device', deviceId: device.id, deviceType: device.type },
    });
    platform.cases.addTimeline(record.id, {
      kind: 'rule',
      actor: 'rule',
      title: 'Regla dispositivo.impresora_sin_papel: se avisa a la tienda para reponer papel',
      data: { ruleId: 'dispositivo.impresora_sin_papel', deviceId: device.id },
    });

    const outcome = await platform.tools.invoke(
      'dispositivo_notify_store',
      {
        siteId: device.siteId,
        message: `La impresora ${device.label} se ha quedado sin papel. Por favor, repón el rollo de papel térmico.`,
      },
      { caseId: record.id, actor: 'rule', reason: 'Regla dispositivo.impresora_sin_papel: la impresora no tiene papel' },
    );

    if (outcome.executed && outcome.result.ok) {
      platform.cases.resolve(record.id, 'rule', `Impresora ${device.label} sin papel: la regla avisó a la tienda para reponerlo.`);
    } else if (outcome.decision === 'shadow') {
      platform.cases.addTimeline(record.id, {
        kind: 'note',
        actor: 'rule',
        title: 'Modo sombra: no se ha avisado a la tienda',
        detail: 'El caso queda abierto.',
      });
    } else if (outcome.decision !== 'approve' && outcome.decision !== 'escalate') {
      platform.cases.addTimeline(record.id, {
        kind: 'note',
        actor: 'rule',
        title: 'No se ha podido avisar a la tienda; el caso queda abierto',
        detail: outcome.result.content,
      });
    }
  },
};

// ── dispositivo.fix_desplegado ───────────────────────────────────

const fixDesplegado: Rule<FixMergedPayload> = {
  id: 'dispositivo.fix_desplegado',
  project: PROJECT_ID,
  description:
    'Cuando se fusiona un arreglo del terminal de pagos, despliega la nueva versión en todos los datáfonos y avisa.',
  on: 'code.fix_merged',
  async handle(event, platform) {
    const { component, newVersion, prId, branch } = event.payload;
    if (!newVersion || (component && component !== 'terminal-pagos')) return;

    const changed = simulator.deployVersion(newVersion);
    const total = simulator.devices().filter((d) => d.type === 'datafono').length;
    platform.notifications.push({
      level: 'info',
      project: PROJECT_ID,
      title: `Versión ${newVersion} desplegada en ${total} datáfonos`,
      detail: `Arreglo fusionado en ${prId} (rama ${branch}). ${changed} terminales actualizados.`,
    });

    const wave = latestDispositivoCase(platform, (c) => c.data.kind === 'wave');
    if (wave) {
      platform.cases.addTimeline(wave.id, {
        kind: 'note',
        actor: 'rule',
        title: `Arreglo desplegado: los datáfonos pasan a la versión ${newVersion}`,
        detail: `${prId} (rama ${branch}) fusionado por el equipo de código.`,
      });
    }
  },
};

export const dispositivoRules: Rule[] = [datafonoBloqueado, olaDeBloqueos, impresoraSinPapel, fixDesplegado];

// ── Predicados de política ─────────────────────────────────

function deviceFor(args: PredicateArgs): Device | undefined {
  const id = typeof args.input?.deviceId === 'string' ? args.input.deviceId : args.scope.deviceId;
  return id ? simulator.device(id) : undefined;
}

export const dispositivoPredicates: Record<string, PolicyPredicate> = {
  /** Hay un cobro en curso en el dispositivo de la acción. */
  transaction_in_flight: (args) => deviceFor(args)?.transactionInFlight === true,

  /** El dispositivo ya se ha reiniciado 3 o más veces en la última hora. */
  restart_attempts_exceeded: (args) => {
    const d = deviceFor(args);
    return d ? simulator.restartsLastHour(d) >= MAX_RESTARTS_PER_HOUR : false;
  },

  /** La tienda de la acción está dentro de su horario. */
  store_open: (args) => {
    const siteId =
      (typeof args.input?.siteId === 'string' ? args.input.siteId : undefined) ?? args.scope.siteId ?? deviceFor(args)?.siteId;
    const site = siteId ? args.platform.directory.site(siteId) : undefined;
    return site ? isStoreOpen(site) : false;
  },

  /** El dispositivo de la acción está caído (bloqueado o sin conexión). */
  device_failed: (args) => {
    const status = deviceFor(args)?.status;
    return status === 'locked' || status === 'offline';
  },
};
