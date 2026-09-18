/** Escenarios del panel de demo para el proyecto dispositivo (orden 10–50). */
import type { Case, PlatformApi, Scenario } from '../../platform/contracts.ts';
import { findOpenDeviceCase, findOpenWaveCase, latestDispositivoCase } from './rules.ts';
import {
  INITIAL_DATAFONO_VERSION,
  PROJECT_ID,
  STATUS_LABEL,
  TYPE_LABEL,
  deviceWhere,
  simulator,
  unique,
} from './simulator.ts';

type ScenarioResult = { message: string; caseIds?: string[] };

const SIMPLE_DEVICE = 'hr-centro:DAT-01';
const APPROVAL_DEVICE = 'pp-alcala:DAT-01';
const STICKY_DEVICE = 'fb-gracia:DAT-01';
const PAPER_DEVICE = 'hr-centro:IMP-01';
/** Cinco tiendas de Horno Real y Forn del Barri que no usan los demás escenarios. */
const WAVE_DEVICES = [
  'hr-ruzafa:DAT-01',
  'hr-campanar:DAT-01',
  'hr-benimaclet:DAT-01',
  'fb-sants:DAT-01',
  'fb-poblenou:DAT-01',
];

const RESOLVED_BY = { rule: 'una regla', agent: 'el agente', human: 'una persona' } as const;

function latestDeviceCase(platform: PlatformApi, deviceId: string): Case | undefined {
  return findOpenDeviceCase(platform, deviceId) ?? latestDispositivoCase(platform, (c) => c.data.deviceId === deviceId);
}

/** El dispositivo existe, está operativo y no tiene un caso en curso. */
function notReady(platform: PlatformApi, deviceId: string): ScenarioResult | undefined {
  const d = simulator.device(deviceId);
  if (!d) return { message: `El dispositivo ${deviceId} no existe en el directorio de la demo.` };
  const label = `${TYPE_LABEL[d.type]} ${d.label} de ${deviceWhere(platform, d)}`;
  const open = findOpenDeviceCase(platform, deviceId);
  if (open) {
    return {
      message: `Ya hay un caso en curso para el ${label} (${open.id}). Termínalo o reinicia la demo para repetir el escenario.`,
      caseIds: [open.id],
    };
  }
  if (d.status !== 'ok') {
    return { message: `El ${label} no está operativo ahora (${STATUS_LABEL[d.status]}). Espera unos segundos o reinicia la demo.` };
  }
  return undefined;
}

/** Qué ha pasado con el caso del dispositivo justo después de provocar la incidencia. */
function outcomeOf(platform: PlatformApi, deviceId: string): { text: string; caseIds: string[]; restarting: boolean } {
  const d = simulator.device(deviceId);
  const record = latestDeviceCase(platform, deviceId);
  const restarting = d?.status === 'restarting';
  if (!d || !record) return { text: 'No se ha abierto ningún caso: revisa las reglas del proyecto.', caseIds: [], restarting };

  let text: string;
  switch (record.status) {
    case 'resolved':
      text =
        record.resolvedBy === 'rule'
          ? 'La regla lo ha resuelto sola, sin IA y con coste 0.'
          : `Caso resuelto por ${RESOLVED_BY[record.resolvedBy ?? 'rule']}.`;
      break;
    case 'waiting_approval': {
      const pending = platform.approvals.list({ caseId: record.id, status: 'pending' });
      text = `Queda pendiente de aprobación humana: ${pending.map((a) => a.summary).join('; ') || 'revisa Aprobaciones'}.`;
      break;
    }
    case 'escalated':
      text = 'La política ha escalado el caso.';
      break;
    case 'running':
      text = 'El agente de dispositivos está trabajando en el caso.';
      break;
    case 'failed':
      text = 'El caso ha fallado: revisa la traza.';
      break;
    default:
      text = restarting
        ? 'Una regla lo está reiniciando en remoto, sin IA y con coste 0; el caso se cerrará solo cuando vuelva a funcionar.'
        : 'El caso queda abierto sin reiniciar: revisa la traza (modo sombra o bloqueo por política).';
  }
  return { text, caseIds: [record.id], restarting };
}

const bloqueoSimple: Scenario = {
  id: 'dispositivo-bloqueo-simple',
  project: PROJECT_ID,
  order: 10,
  title: 'Datáfono bloqueado',
  description:
    'Se bloquea el datáfono de Panaderías Horno Real · Centro. Una regla lo reinicia en segundos y cierra el caso ' +
    'cuando vuelve a funcionar: sin IA y con coste 0.',
  async run(platform) {
    const blocked = notReady(platform, SIMPLE_DEVICE);
    if (blocked) return blocked;
    simulator.configure(SIMPLE_DEVICE, { sticky: false, transactionInFlight: false });
    await simulator.lock(SIMPLE_DEVICE, 'payment_timeout');
    const outcome = outcomeOf(platform, SIMPLE_DEVICE);
    return {
      message: `Datáfono DAT-01 de Panaderías Horno Real · Centro bloqueado. ${outcome.text}`,
      caseIds: outcome.caseIds,
    };
  },
};

const bloqueoAprobacion: Scenario = {
  id: 'dispositivo-bloqueo-aprobacion',
  project: PROJECT_ID,
  order: 20,
  title: 'Bloqueo en un cliente que exige aprobación',
  description:
    'Se bloquea el datáfono de Pan de Pueblo · Alcalá. Este cliente tiene un override en el dial que exige aprobar ' +
    'cualquier reinicio: la regla lo propone y queda esperando en Aprobaciones.',
  async run(platform) {
    const blocked = notReady(platform, APPROVAL_DEVICE);
    if (blocked) return blocked;
    simulator.configure(APPROVAL_DEVICE, { sticky: false, transactionInFlight: false });
    await simulator.lock(APPROVAL_DEVICE, 'payment_timeout');
    const outcome = outcomeOf(platform, APPROVAL_DEVICE);
    return {
      message: `Datáfono DAT-01 de Pan de Pueblo · Alcalá bloqueado. ${outcome.text}`,
      caseIds: outcome.caseIds,
    };
  },
};

const bloqueoPersistente: Scenario = {
  id: 'dispositivo-bloqueo-persistente',
  project: PROJECT_ID,
  order: 30,
  title: 'Bloqueo que vuelve tras reiniciar',
  description:
    'El datáfono de Forn del Barri · Gràcia tiene un fallo que vuelve tras cada reinicio. La regla lo reinicia hasta ' +
    'que la política escala (3 reinicios en una hora); entonces entra el agente de dispositivos, que pide una visita ' +
    'de técnico sujeta a aprobación.',
  async run(platform) {
    const blocked = notReady(platform, STICKY_DEVICE);
    if (blocked) return blocked;
    simulator.configure(STICKY_DEVICE, { sticky: true, transactionInFlight: false });
    await simulator.lock(STICKY_DEVICE, 'card_reader_fault');
    const outcome = outcomeOf(platform, STICKY_DEVICE);
    const text = outcome.restarting
      ? 'Una regla lo reinicia en remoto, sin IA, pero el fallo vuelve tras cada reinicio: al tercero en una hora la política escala y el caso pasa al agente de dispositivos.'
      : outcome.text;
    return {
      message: `Datáfono DAT-01 de Forn del Barri · Gràcia bloqueado con un fallo que vuelve tras reiniciar. ${text}`,
      caseIds: outcome.caseIds,
    };
  },
};

const olaBloqueos: Scenario = {
  id: 'dispositivo-ola-bloqueos',
  project: PROJECT_ID,
  order: 40,
  title: 'Ola de bloqueos tras la versión 2.14.2',
  description:
    'Cinco datáfonos de Panaderías Horno Real y Forn del Barri, todos en la versión 2.14.2, se bloquean con el mismo ' +
    'síntoma. Las reglas los reinician y detectan la ola; el agente de dispositivos investiga y, si ve un patrón de ' +
    'software, avisa al equipo de código.',
  async run(platform) {
    const wave = findOpenWaveCase(platform);
    if (wave) {
      return { message: `Ya hay una ola de bloqueos en curso (${wave.id}). Espera a que termine o reinicia la demo.`, caseIds: [wave.id] };
    }
    const updated = WAVE_DEVICES.map((id) => simulator.device(id)).find(
      (d) => d && d.softwareVersion !== INITIAL_DATAFONO_VERSION,
    );
    if (updated) {
      return {
        message: `Los dispositivos ya tienen desplegada la versión ${updated.softwareVersion} con el arreglo. Reinicia la demo para repetir la ola.`,
      };
    }
    for (const id of WAVE_DEVICES) {
      const blocked = notReady(platform, id);
      if (blocked) return blocked;
    }

    for (const id of WAVE_DEVICES) {
      simulator.configure(id, { sticky: false, transactionInFlight: false });
      await simulator.lock(id, 'payment_timeout');
    }

    const waveCase = findOpenWaveCase(platform) ?? latestDispositivoCase(platform, (c) => c.data.kind === 'wave');
    const deviceCaseIds = WAVE_DEVICES.map((id) => latestDeviceCase(platform, id)?.id).filter(
      (id): id is string => Boolean(id),
    );
    const sites = unique(WAVE_DEVICES.map((id) => id.split(':')[0]));
    const intro = `${WAVE_DEVICES.length} datáfonos bloqueados en ${sites.length} tiendas de Panaderías Horno Real y Forn del Barri, todos con la versión ${INITIAL_DATAFONO_VERSION}.`;
    return {
      message: waveCase
        ? `${intro} Las reglas los reinician sin IA y han detectado la ola: el agente de dispositivos investiga la causa común.`
        : `${intro} Las reglas los reinician, pero no se ha abierto el caso de ola: revisa la traza.`,
      caseIds: [...(waveCase ? [waveCase.id] : []), ...deviceCaseIds],
    };
  },
};

const impresoraPapel: Scenario = {
  id: 'dispositivo-impresora-papel',
  project: PROJECT_ID,
  order: 45,
  title: 'Impresora sin papel',
  description:
    'La impresora de Panaderías Horno Real · Centro se queda sin papel. Una regla avisa a la tienda (nivel «hace y ' +
    'avisa») y cierra el caso; la tienda repone el papel.',
  async run(platform) {
    const blocked = notReady(platform, PAPER_DEVICE);
    if (blocked) return blocked;
    await simulator.paperOut(PAPER_DEVICE);
    const record = latestDeviceCase(platform, PAPER_DEVICE);
    if (!record) return { message: 'La impresora se ha quedado sin papel, pero no se ha abierto caso: revisa las reglas.' };

    let text: string;
    if (record.status === 'resolved') text = 'La regla ha avisado a la tienda y ha cerrado el caso, sin IA.';
    else if (record.status === 'waiting_approval') text = 'El aviso a la tienda queda pendiente de aprobación humana.';
    else text = 'El caso queda abierto sin avisar a la tienda: revisa la traza.';
    return { message: `Impresora IMP-01 de Panaderías Horno Real · Centro sin papel. ${text}`, caseIds: [record.id] };
  },
};

const ambiente: Scenario = {
  id: 'dispositivo-ambiente',
  project: PROJECT_ID,
  order: 50,
  title: 'Activar / desactivar actividad de fondo',
  description:
    'Enciende o apaga la actividad de fondo: cada ~20 segundos ocurre un incidente menor (papel o un bloqueo simple) ' +
    'que resuelven las reglas solas.',
  async run() {
    const on = !simulator.isAmbient();
    simulator.setAmbient(on);
    return {
      message: on
        ? 'Actividad de fondo activada: cada ~20 segundos ocurrirá un incidente menor que resuelven las reglas.'
        : 'Actividad de fondo desactivada.',
    };
  },
};

export const dispositivoScenarios: Scenario[] = [
  bloqueoSimple,
  bloqueoAprobacion,
  bloqueoPersistente,
  olaBloqueos,
  impresoraPapel,
  ambiente,
];
