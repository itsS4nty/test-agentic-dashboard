/**
 * Smoke de punta a punta de la demo, sin red ni servidor:
 *   npm run smoke
 *
 * Plataforma en memoria, modo rápido y proveedor simulado, con TODOS los proyectos registrados.
 * Recorre cada escenario de docs/CONTRACTS.md § 6 y los flujos que cruzan proyectos
 * (ola → sospecha de bug → PR → aprobación → versión 2.14.3 en los dispositivos), el modo sombra del dial,
 * la prueba de fuego de soporte y la coherencia de las métricas. Imprime una tabla PASS/FAIL y
 * sale con código 1 si algo falla.
 *
 * El repositorio git de bugs vive en `<dataDir>/repos` aunque el estado sea en memoria, así que el
 * smoke usa su propio `data/smoke` (lo borra al empezar y al terminar) para no pisar al servidor.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Case, PlatformApi, PlatformEvent, TimelineEntry } from '../platform/contracts.ts';
import { createPlatform } from '../platform/index.ts';
import { allProjects } from '../projects/index.ts';
import type { BugsState } from '../projects/bugs/state.ts';
import type { FacturasSnapshot } from '../projects/facturas/types.ts';
import { simulator, type DispositivoSnapshot } from '../projects/dispositivo/simulator.ts';
import type { Ticket } from '../projects/soporte/state.ts';

// Siempre en modo local: un .env con GITHUB_TOKEN no debe hacer que esta comprobación llame a GitHub.
process.env.DEMO_GITHUB = 'off';

const execGit = promisify(execFile);

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(rootDir, 'data', 'smoke');

// ─────────────────────────────────────────────────────────────
// Arnés
// ─────────────────────────────────────────────────────────────

type Row = { block: string; name: string; ok: boolean; detail: string };
const rows: Row[] = [];
let currentBlock = '';

function check(name: string, ok: unknown, detail: unknown = ''): boolean {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  rows.push({ block: currentBlock, name, ok: Boolean(ok), detail: text ?? '' });
  return Boolean(ok);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(probe: () => T | undefined | null | false, timeoutMs = 5000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await sleep(10);
  }
}

/** Deja correr los temporizadores del simulador y todas las ejecuciones de agentes. */
async function settle(platform: PlatformApi, rounds = 2): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await sleep(40);
    await platform.runtime.idle();
  }
}

const entries = (c: Case | undefined, pred: (e: TimelineEntry) => boolean) => (c ? c.timeline.filter(pred) : []);
const short = (text: string | undefined, max = 90) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// ─────────────────────────────────────────────────────────────
// Bloques
// ─────────────────────────────────────────────────────────────

type Block = { name: string; reset?: boolean; run: (platform: PlatformApi, events: PlatformEvent[]) => Promise<void> };

const EXPECTED_SCENARIOS = [
  'dispositivo-bloqueo-simple',
  'dispositivo-bloqueo-aprobacion',
  'dispositivo-bloqueo-persistente',
  'dispositivo-ola-bloqueos',
  'dispositivo-impresora-papel',
  'dispositivo-ambiente',
  'bugs-analizar',
  'facturas-lote',
  'soporte-bandeja',
  'soporte-inyeccion',
  'soporte-prueba-fuego',
  'plataforma-crear-agente',
];

const WAVE_DEVICES = ['hr-ruzafa', 'hr-campanar', 'hr-benimaclet', 'fb-sants', 'fb-poblenou'].map((s) => `${s}:DAT-01`);

const dispositivoSnap = (p: PlatformApi) => p.projects.get('dispositivo')!.snapshot!(p) as DispositivoSnapshot;
const bugsSnap = (p: PlatformApi) => p.projects.get('bugs')!.snapshot!(p) as BugsState & { repoPath: string };
const facturasSnap = (p: PlatformApi) => p.projects.get('facturas')!.snapshot!(p) as FacturasSnapshot;
const soporteSnap = (p: PlatformApi) => p.projects.get('soporte')!.snapshot!(p) as { tickets: Ticket[] };
const ticket = (p: PlatformApi, id: string) => soporteSnap(p).tickets.find((t) => t.id === id);

const blocks: Block[] = [
  {
    name: 'Catálogo',
    async run(platform) {
      const ids = platform.projects.list().map((p) => p.id);
      check('5 proyectos registrados en orden', ids.join(',') === 'dispositivo,bugs,facturas,soporte,plataforma', ids);

      const scenarios = [...platform.projects.scenarios()].sort((a, b) => a.order - b.order).map((s) => s.id);
      check('12 escenarios ordenados por order', scenarios.join(',') === EXPECTED_SCENARIOS.join(','), scenarios);

      const manifests = platform.manifests.list();
      const agentIds = manifests.map((m) => m.id).sort();
      check('5 agentes cargados desde YAML', agentIds.join(',') === 'bugs,creador,dispositivos,facturacion,soporte', agentIds);
      const missingTools = manifests.flatMap((m) => m.tools.filter((t) => !platform.tools.get(t)).map((t) => `${m.id}:${t}`));
      check('todas las herramientas de los manifiestos están registradas', missingTools.length === 0, missingTools);
      const orphanProjects = manifests.filter((m) => !platform.projects.get(m.project)).map((m) => m.id);
      check('cada agente pertenece a un proyecto registrado', orphanProjects.length === 0, orphanProjects);

      const unknownPolicy = platform.policy.getConfig().actions.filter((a) => !platform.tools.get(a.action)).map((a) => a.action);
      check('cada acción de policies.yaml es una herramienta registrada', unknownPolicy.length === 0, unknownPolicy);
      const unconfigured = platform.tools.list().filter((t) => !platform.policy.getConfig().actions.some((a) => a.action === t.name));
      check('cada herramienta tiene nivel en policies.yaml', unconfigured.length === 0, unconfigured.map((t) => t.name));

      check('proveedor simulado', platform.llm.provider === 'mock', platform.llm.label);
      check('reglas registradas de los 4 proyectos', new Set(platform.rules.list().map((r) => r.project)).size === 4, platform.rules.list().length);
    },
  },
  {
    name: 'dispositivo-bloqueo-simple',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-simple');
      const caseId = res.caseIds?.[0] ?? '';
      const record = await waitFor(() => {
        const c = platform.cases.get(caseId);
        return c?.status === 'resolved' ? c : undefined;
      });
      await settle(platform);
      check('caso resuelto por regla', record?.resolvedBy === 'rule', `${platform.cases.get(caseId)?.status} · ${short(res.message)}`);
      check('coste 0 y sin llamadas a IA', record?.costUsd === 0 && entries(record, (e) => e.kind === 'llm').length === 0, record?.costUsd);
      check('reinicio ejecutado por la regla', entries(record, (e) => e.kind === 'tool' && e.tool === 'dispositivo_restart_device' && e.actor === 'rule').length === 1);
      check('datáfono operativo', simulator.device('hr-centro:DAT-01')?.status === 'ok', simulator.device('hr-centro:DAT-01')?.status);
    },
  },
  {
    name: 'dispositivo-bloqueo-aprobacion',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-aprobacion');
      const caseId = res.caseIds?.[0] ?? '';
      const pending = platform.approvals.list({ caseId, status: 'pending' });
      check('caso en waiting_approval', platform.cases.get(caseId)?.status === 'waiting_approval', platform.cases.get(caseId)?.status);
      check('aprobación pendiente de dispositivo_restart_device', pending.length === 1 && pending[0].tool === 'dispositivo_restart_device', pending.map((a) => a.tool));
      check('summary con el ámbito', pending[0]?.summary === 'Reiniciar datáfono DAT-01 · Pan de Pueblo · Alcalá', pending[0]?.summary);
      check('el datáfono sigue bloqueado sin aprobar', simulator.device('pp-alcala:DAT-01')?.status === 'locked');
    },
  },
  {
    name: 'dispositivo-bloqueo-persistente',
    async run(platform, events) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-persistente');
      const caseId = res.caseIds?.[0] ?? '';
      const approval = await waitFor(
        () => platform.approvals.list({ caseId, status: 'pending' }).find((a) => a.tool === 'dispositivo_open_field_ticket'),
        8000,
      );
      await settle(platform);
      const record = platform.cases.get(caseId);
      const device = simulator.device('fb-gracia:DAT-01')!;
      check('3 reinicios en la última hora', simulator.restartsLastHour(device) === 3, simulator.restartsLastHour(device));
      check('la política escala una vez', entries(record, (e) => e.kind === 'policy' && e.decision === 'escalate').length === 1);
      const runs = events.filter((e) => e.type === 'run.started' && e.run.caseId === caseId && e.run.agentId === 'dispositivos');
      check('el agente dispositivos toma el caso una vez', runs.length === 1, runs.length);
      check('aprobación pendiente de dispositivo_open_field_ticket', Boolean(approval), platform.approvals.list({ caseId }).map((a) => `${a.tool}:${a.status}`));
      check('caso en waiting_approval', record?.status === 'waiting_approval', record?.status);
    },
  },
  {
    name: 'dispositivo-impresora-papel',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-impresora-papel');
      const record = platform.cases.get(res.caseIds?.[0] ?? '');
      check('resuelto por regla', record?.status === 'resolved' && record.resolvedBy === 'rule', `${record?.status} · ${record?.resolvedBy}`);
      check('aviso a la tienda en el snapshot', dispositivoSnap(platform).storeNotices.some((n) => n.siteId === 'hr-centro'), dispositivoSnap(platform).storeNotices.length);
      check('aviso ejecutado con nivel notify', entries(record, (e) => e.kind === 'policy' && e.tool === 'dispositivo_notify_store' && e.decision === 'notify' && e.executed === true).length === 1);
      check('la tienda repone el papel', Boolean(await waitFor(() => simulator.device('hr-centro:IMP-01')?.status === 'ok')));
    },
  },
  {
    name: 'dispositivo-ambiente',
    async run(platform) {
      // Sin reset: los bloques anteriores dejan aprobaciones pendientes; se mide lo que añade el ambiente.
      const casesBefore = platform.cases.list({ project: 'dispositivo' }).length;
      const approvalsBefore = platform.approvals.list().length;
      const on = await platform.projects.runScenario('dispositivo-ambiente');
      check('se activa', /activada/.test(on.message) && dispositivoSnap(platform).ambient, short(on.message));
      await sleep(200);
      const off = await platform.projects.runScenario('dispositivo-ambiente');
      check('se desactiva', /desactivada/.test(off.message) && !dispositivoSnap(platform).ambient, short(off.message));
      await settle(platform);
      const cases = platform.cases.list({ project: 'dispositivo' });
      check('genera incidentes menores', cases.length > casesBefore, `${cases.length - casesBefore} casos nuevos`);
      check('no provoca olas', !cases.some((c) => c.data.kind === 'wave'), cases.filter((c) => c.data.kind === 'wave').length);
      const newApprovals = platform.approvals.list().slice(approvalsBefore);
      check('no crea aprobaciones', newApprovals.length === 0, newApprovals.map((a) => `${a.tool}:${a.summary}`));
    },
  },
  {
    name: 'Dial: modo sombra',
    reset: true,
    async run(platform) {
      platform.policy.setActionLevel('dispositivo_restart_device', 'shadow');
      check('dispositivo_restart_device en shadow', platform.policy.getConfig().actions.find((a) => a.action === 'dispositivo_restart_device')?.level === 'shadow');

      const res = await platform.projects.runScenario('dispositivo-bloqueo-simple');
      const caseId = res.caseIds?.[0] ?? '';
      await settle(platform);
      await sleep(50);
      const record = platform.cases.get(caseId);
      const device = simulator.device('hr-centro:DAT-01')!;
      check('NO reinicia: el datáfono sigue bloqueado', device.status === 'locked' && simulator.restartsLastHour(device) === 0, `${device.status} · ${simulator.restartsLastHour(device)} reinicios`);
      check('policy shadow sin ejecutar', entries(record, (e) => e.kind === 'policy' && e.decision === 'shadow' && e.executed === false).length === 1);
      check('sin entrada tool de reinicio', entries(record, (e) => e.kind === 'tool' && e.tool === 'dispositivo_restart_device').length === 0);
      check('nota "Modo sombra: no se ha reiniciado"', entries(record, (e) => e.kind === 'note' && e.title === 'Modo sombra: no se ha reiniciado').length === 1);
      check('el caso queda abierto', record?.status === 'open', record?.status);

      platform.policy.setActionLevel('dispositivo_restart_device', 'auto');
      const evaluation = await platform.policy.evaluate('dispositivo_restart_device', { deviceId: 'hr-ruzafa:DAT-01' }, { clientId: 'horno-real', siteId: 'hr-ruzafa', deviceId: 'hr-ruzafa:DAT-01' }, caseId);
      check('vuelta a auto: la política decide auto', evaluation.decision === 'auto', evaluation.reason);
    },
  },
  {
    name: 'Ola → bugs → fix 2.14.3',
    reset: true,
    async run(platform, events) {
      const res = await platform.projects.runScenario('dispositivo-ola-bloqueos');
      check('escenario de ola lanzado', /ola/.test(res.message), short(res.message));
      await settle(platform, 3);
      await waitFor(() => WAVE_DEVICES.every((id) => simulator.device(id)?.status === 'ok'));
      await settle(platform);

      const waves = platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'wave');
      const wave = waves[0];
      check('un único caso de ola resuelto por el agente', waves.length === 1 && wave.status === 'resolved' && wave.resolvedBy === 'agent', waves.map((c) => `${c.status}:${c.resolvedBy}`));
      const deviceCases = platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'device');
      check('5 reinicios resueltos por regla con coste 0', deviceCases.length === 5 && deviceCases.every((c) => c.resolvedBy === 'rule' && c.costUsd === 0), deviceCases.map((c) => c.status));

      const suspected = events.filter((e) => e.type === 'domain' && e.event.name === 'code.suspected_bug');
      check('code.suspected_bug emitido una vez', suspected.length === 1, suspected.length);

      const codeCases = platform.cases.list({ project: 'bugs' });
      const codeCase = codeCases[0];
      check('caso de código enlazado al caso de ola', codeCases.length === 1 && codeCase.data.sourceCaseId === wave?.id, codeCases.map((c) => c.data.sourceCaseId));
      check('el agente bugs deja el caso en waiting_approval', codeCase?.status === 'waiting_approval', codeCase?.status);

      const pr = bugsSnap(platform).prs[0];
      check('PR abierto', pr?.status === 'open', pr?.status);
      check('tests antes: fallan en main', (pr?.testsBefore.failed ?? 0) > 0, pr?.testsBefore && { passed: pr.testsBefore.passed, failed: pr.testsBefore.failed });
      check('tests después: en verde en la rama', pr?.testsAfter.failed === 0 && pr.testsAfter.passed > 0, pr?.testsAfter && { passed: pr.testsAfter.passed, failed: pr.testsAfter.failed });

      const merge = platform.approvals.list({ caseId: codeCase?.id, status: 'pending' });
      check('aprobación pendiente de bugs_merge_pr', merge.length === 1 && merge[0].tool === 'bugs_merge_pr', merge.map((a) => a.tool));
      check('los datáfonos siguen en 2.14.2 antes de aprobar', simulator.devices().filter((d) => d.type === 'datafono').every((d) => d.softwareVersion === '2.14.2'));
      if (!merge[0]) return;

      const decided = await platform.approvals.decide(merge[0].id, 'approved', 'Smoke');
      await settle(platform);
      check('fusión ejecutada', decided.status === 'executed', short(decided.result?.content));
      check('PR fusionado y versión 2.14.3 en código', bugsSnap(platform).prs[0]?.status === 'merged' && bugsSnap(platform).version === '2.14.3', bugsSnap(platform).version);
      check('code.fix_merged emitido', events.some((e) => e.type === 'domain' && e.event.name === 'code.fix_merged'));
      const datafonos = dispositivoSnap(platform).sites.flatMap((s) => s.devices).filter((d) => d.type === 'datafono');
      check('los 12 datáfonos en 2.14.3', datafonos.length === 12 && datafonos.every((d) => d.softwareVersion === '2.14.3'), [...new Set(datafonos.map((d) => d.softwareVersion))]);
      check('caso de código resuelto por una persona', platform.cases.get(codeCase.id)?.resolvedBy === 'human', platform.cases.get(codeCase.id)?.status);
    },
  },
  {
    name: 'bugs-analizar',
    reset: true,
    async run(platform) {
      const res = await platform.projects.runScenario('bugs-analizar');
      const caseId = res.caseIds?.[0] ?? '';
      await settle(platform);
      const pr = bugsSnap(platform).prs[0];
      check('PR abierto con tests en verde', pr?.status === 'open' && pr.testsAfter.failed === 0 && pr.testsAfter.passed > 0, pr?.testsAfter && { passed: pr.testsAfter.passed, failed: pr.testsAfter.failed });
      const pending = platform.approvals.list({ caseId, status: 'pending' });
      check('aprobación pendiente de bugs_merge_pr', pending.length === 1 && pending[0].tool === 'bugs_merge_pr', pending.map((a) => a.tool));
      const record = platform.cases.get(caseId);
      check('trazas llm con coste simulado', entries(record, (e) => e.kind === 'llm').length > 0 && (record?.costUsd ?? 0) > 0, record?.costUsd);
    },
  },
  {
    name: 'facturas-lote',
    reset: true,
    async run(platform) {
      const res = await platform.projects.runScenario('facturas-lote');
      await settle(platform);
      const snap = facturasSnap(platform);
      check('≥ 5 hallazgos por regla', snap.stats.ruleFindings >= 5, `${snap.stats.ruleFindings} · ${short(res.message, 60)}`);
      check('≥ 2 hallazgos por IA', snap.stats.llmFindings >= 2, snap.stats.llmFindings);
      check('reglas a coste 0, IA con coste', snap.stats.ruleCostUsd === 0 && snap.stats.llmCostUsd > 0, snap.stats.llmCostUsd);
      const cases = platform.cases.list({ project: 'facturas' });
      const batch = cases.find((c) => c.title.startsWith('Revisión automática del lote'));
      check('caso del lote resuelto por regla', batch?.status === 'resolved' && batch.resolvedBy === 'rule' && batch.costUsd === 0, batch?.status);
      const pending = platform.approvals.list({ status: 'pending' }).filter((a) => a.project === 'facturas');
      check('una aprobación pendiente de facturas_propose_correction', pending.length === 1 && pending[0].tool === 'facturas_propose_correction', pending.map((a) => a.tool));
      const escalated = cases.filter((c) => c.status === 'escalated');
      const issued = snap.invoices.find((i) => i.id === escalated[0]?.data.invoiceId);
      check('un caso escalado por factura emitida', escalated.length === 1 && issued?.status === 'issued', escalated.map((c) => c.title));
    },
  },
  {
    name: 'soporte-bandeja',
    reset: true,
    async run(platform, events) {
      let active = 0;
      let maxActive = 0;
      const off = platform.events.on((e) => {
        if (e.type === 'run.started') maxActive = Math.max(maxActive, ++active);
        if (e.type === 'run.finished') active--;
      });
      const res = await platform.projects.runScenario('soporte-bandeja');
      await settle(platform);
      off();

      const tickets = soporteSnap(platform).tickets;
      check('entran 5 tickets, sin T-106', tickets.length === 5 && !tickets.some((t) => t.id === 'T-106'), tickets.map((t) => t.id));
      const faq = ticket(platform, 'T-105');
      const faqCase = platform.cases.get(faq?.caseId ?? '');
      check('FAQ T-105 respondida por regla con coste 0', faq?.status === 'auto_answered' && faqCase?.resolvedBy === 'rule' && faqCase.costUsd === 0, `${faq?.status} · ${faqCase?.resolvedBy}`);
      const runs = events.filter((e) => e.type === 'run.started').length;
      check('tope de concurrencia 3 respetado', runs >= 4 && maxActive <= 3, `${runs} ejecuciones · máximo ${maxActive} a la vez`);
      const replies = platform.approvals.list({ status: 'pending' }).filter((a) => a.tool === 'soporte_send_reply');
      check('respuestas pendientes de aprobación', replies.length >= 1, replies.length);
      check('cliente enfadado T-104 escalado', ticket(platform, 'T-104')?.status === 'escalated', ticket(platform, 'T-104')?.status);
      check('mensaje del escenario', /bandeja/.test(res.message), short(res.message));

      if (replies[0]) {
        const decided = await platform.approvals.decide(replies[0].id, 'approved', 'Smoke');
        const ticketId = (replies[0].input as { ticketId: string }).ticketId;
        check('aprobar una respuesta la envía', decided.status === 'executed' && ticket(platform, ticketId)?.status === 'answered', `${decided.status} · ${ticket(platform, ticketId)?.status}`);
      }
    },
  },
  {
    name: 'soporte-inyeccion',
    async run(platform) {
      await platform.projects.runScenario('soporte-inyeccion');
      await settle(platform);
      const t = ticket(platform, 'T-106');
      const record = platform.cases.get(t?.caseId ?? '');
      check('T-106 marcado con injectionDetected', t?.injectionDetected === true);
      check('caso y ticket escalados', record?.status === 'escalated' && t?.status === 'escalated', `${record?.status} · ${t?.status}`);
      check('el agente lo marca como sospechoso', entries(record, (e) => e.kind === 'tool' && e.tool === 'soporte_flag_suspicious').length === 1);
      check('nunca intenta el abono ni responde', entries(record, (e) => e.tool === 'soporte_issue_credit' || e.tool === 'soporte_send_reply').length === 0);
    },
  },
  {
    name: 'soporte-prueba-fuego',
    async run(platform) {
      const blockedBefore = platform.metrics().blockedByPolicy;
      const res = await platform.projects.runScenario('soporte-prueba-fuego');
      const record = platform.cases.get(res.caseIds?.[0] ?? '');
      const policy = entries(record, (e) => e.kind === 'policy' && e.tool === 'soporte_issue_credit');
      check('decisión deny, no ejecutado, actor agent', policy.length === 1 && policy[0].decision === 'deny' && policy[0].executed === false && policy[0].actor === 'agent', policy.map((e) => `${e.decision}:${e.executed}`));
      check('sin entrada tool ni aprobación del abono', entries(record, (e) => e.kind === 'tool' && e.tool === 'soporte_issue_credit').length === 0 && !platform.approvals.list().some((a) => a.tool === 'soporte_issue_credit'));
      check('cuenta en blockedByPolicy', platform.metrics().blockedByPolicy === blockedBefore + 1, platform.metrics().blockedByPolicy);
      check('mensaje explica el bloqueo', /bloqueado/.test(res.message), short(res.message));
    },
  },
  {
    name: 'Métricas',
    async run(platform) {
      // Sobre el estado de soporte se añade un bloqueo resuelto por regla y el lote de facturas.
      await platform.projects.runScenario('dispositivo-bloqueo-simple');
      await platform.projects.runScenario('facturas-lote');
      await settle(platform);
      await waitFor(() => platform.cases.list({ project: 'dispositivo' }).some((c) => c.status === 'resolved'));

      const m = platform.metrics();
      const cases = platform.cases.list();
      check('resueltos por regla > 0', m.resolvedByRule > 0, m.resolvedByRule);
      check('coste > 0', m.costUsd > 0, m.costUsd);
      check('blockedByPolicy > 0', m.blockedByPolicy > 0, m.blockedByPolicy);
      check('llamadas a IA y tokens > 0', m.llmCalls > 0 && m.tokens.input > 0 && m.tokens.output > 0, { llmCalls: m.llmCalls, tokens: m.tokens });
      check('casesTotal = casos del store', m.casesTotal === cases.length, `${m.casesTotal} / ${cases.length}`);
      const failed = cases.filter((c) => c.status === 'failed').length;
      check('abiertos + resueltos + fallidos = total', m.casesOpen + m.casesResolved + failed === m.casesTotal, { open: m.casesOpen, resolved: m.casesResolved, failed });
      check('resueltos = regla + agente + persona', m.casesResolved === m.resolvedByRule + m.resolvedByAgent + m.resolvedByHuman);
      const rate = m.casesResolved ? (m.resolvedByRule + m.resolvedByAgent) / m.casesResolved : 0;
      check('autoResolutionRate coherente', Math.abs(m.autoResolutionRate - rate) < 1e-9 && rate >= 0 && rate <= 1, m.autoResolutionRate);
      check('pendingApprovals = aprobaciones pendientes', m.pendingApprovals === platform.approvals.list({ status: 'pending' }).length, m.pendingApprovals);
      const byProject = Object.values(m.byProject);
      check('byProject suma el total de casos', byProject.reduce((n, p) => n + p.cases, 0) === m.casesTotal);
      check('byProject suma el coste', Math.abs(byProject.reduce((n, p) => n + p.costUsd, 0) - m.costUsd) < 1e-5, m.byProject);
      check('feedback cuenta la aprobación de soporte', m.feedback.approved >= 1, m.feedback);
      const errors = cases.filter((c) => c.status === 'failed' || c.timeline.some((e) => e.kind === 'error'));
      check('ningún caso fallido ni con errores', errors.length === 0, errors.map((c) => `${c.title}: ${short(c.timeline.find((e) => e.kind === 'error')?.title, 60)}`));
    },
  },
  {
    name: 'Creador de agentes',
    reset: true,
    run: async (platform) => {
      const snap = () => platform.projects.get('plataforma')!.snapshot!(platform) as any;
      const bad = await platform.projects.runScenario('plataforma-crear-agente').catch((e) => ({ message: String(e) }));
      check('el escenario envía la solicitud', /SOL-001/.test(bad.message), bad.message);
      await settle(platform, 4);
      const pr = await waitFor(() => snap().prs[0], 20000);
      check('el creador abre un PR con la validación correcta', pr?.validation?.ok, pr?.validation?.steps);
      check('el PR trae manifiesto, prompt, herramientas y fontanería', pr?.files?.length === 7, pr?.files?.map((f: any) => f.path));
      check('las variables nuevas van a .env.example', pr?.envVars?.includes('PEDIDOS_OBRADOR_ERP_OBRADOR_URL'), pr?.envVars);
      const approval = platform.approvals.list({ status: 'pending' }).find((a) => a.tool === 'plataforma_merge_pr');
      check('la fusión espera aprobación', approval, platform.approvals.list({}).map((a) => a.tool));
      if (approval) {
        await platform.approvals.decide(approval.id, 'approved', 'smoke');
        await settle(platform, 2);
      }
      check('tras aprobar, el PR queda fusionado', snap().prs[0]?.status === 'merged', snap().prs[0]?.activation);
      const invalid = await import('../projects/plataforma/index.ts').then((m) => m.submitAgentRequest(platform, { name: 'x' }));
      check('una especificación incompleta se rechaza campo a campo', !invalid.ok && invalid.errors.length >= 3, invalid);
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Ejecución
// ─────────────────────────────────────────────────────────────

function printTable(): number {
  const failed = rows.filter((r) => !r.ok);
  const blockWidth = Math.max(...rows.map((r) => r.block.length), 6);
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 12);
  console.log('');
  console.log(`${'Bloque'.padEnd(blockWidth)}  ${'Comprobación'.padEnd(nameWidth)}  Resultado  Detalle`);
  console.log(`${'─'.repeat(blockWidth)}  ${'─'.repeat(nameWidth)}  ─────────  ${'─'.repeat(30)}`);
  let last = '';
  for (const r of rows) {
    const block = r.block === last ? '' : r.block;
    last = r.block;
    console.log(`${block.padEnd(blockWidth)}  ${r.name.padEnd(nameWidth)}  ${(r.ok ? 'PASS' : 'FAIL').padEnd(9)}  ${short(r.detail, 110)}`);
  }
  console.log('');
  console.log(failed.length ? `FAIL · ${failed.length} de ${rows.length} comprobaciones fallan` : `PASS · ${rows.length} comprobaciones`);
  return failed.length;
}

async function main(): Promise<number> {
  await rm(dataDir, { recursive: true, force: true });
  // El creador trabaja sobre una copia del repo, nunca sobre el de verdad.
  const creadorRepo = join(dataDir, 'creador-repo');
  if (existsSync(join(rootDir, '.git'))) {
    await execGit('git', ['clone', '--quiet', '--local', '--no-hardlinks', rootDir, creadorRepo]);
    await execGit('git', ['-C', creadorRepo, 'remote', 'remove', 'origin']);
    process.env.CREADOR_REPO_DIR = creadorRepo;
  }
  const platform = await createPlatform({ rootDir, dataDir, inMemory: true, fast: true, provider: 'mock' });
  const events: PlatformEvent[] = [];
  platform.events.on((e) => events.push(e));

  try {
    for (const project of allProjects) await platform.projects.register(project);
    for (const block of blocks) {
      currentBlock = block.name;
      if (block.reset) {
        await settle(platform);
        await platform.reset();
      }
      events.length = 0;
      const started = Date.now();
      process.stdout.write(`· ${block.name}…`);
      try {
        await block.run(platform, events);
      } catch (err) {
        check('el bloque termina sin excepciones', false, err instanceof Error ? (err.stack ?? err.message) : String(err));
      }
      const mine = rows.filter((r) => r.block === block.name);
      process.stdout.write(` ${mine.every((r) => r.ok) ? 'ok' : 'FALLA'} (${Date.now() - started} ms)\n`);
    }
  } finally {
    await settle(platform).catch(() => {});
    await platform.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  }
  return printTable();
}

const failures = await main().catch((err) => {
  console.error('\nEl smoke no ha podido ejecutarse:', err);
  return 1;
});
process.exit(failures ? 1 : 0);
