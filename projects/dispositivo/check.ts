/**
 * Comprobación de punta a punta del proyecto dispositivo, sin red ni disco:
 *   npx tsx projects/dispositivo/check.ts
 *
 * Plataforma en memoria, modo rápido y proveedor simulado; solo se registra dispositivo.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { DomainEvent, PlatformApi, PlatformEvent } from '../../platform/contracts.ts';
import { createPlatform } from '../../platform/index.ts';
import { dispositivo } from './index.ts';
import { simulator, type DispositivoSnapshot } from './simulator.ts';
import type { SuspectedBugPayload } from './tools.ts';

// Siempre en modo local: un .env con GITHUB_TOKEN no debe hacer que esta comprobación llame a GitHub.
process.env.DEMO_GITHUB = 'off';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(label: string, probe: () => T | undefined | false | null, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Tiempo agotado esperando: ${label}`);
    await sleep(10);
  }
}

/** Deja correr temporizadores del simulador y ejecuciones de agentes. */
async function settle(platform: PlatformApi): Promise<void> {
  await sleep(40);
  await platform.runtime.idle();
}

function domainEvents(events: PlatformEvent[], name: string): DomainEvent[] {
  return events.flatMap((e) => (e.type === 'domain' && e.event.name === name ? [e.event] : []));
}

type Check = { name: string; run: (platform: PlatformApi, events: PlatformEvent[]) => Promise<void> };

const checks: Check[] = [
  {
    name: 'Snapshot inicial: 12 tiendas × 3 dispositivos, datáfonos en 2.14.2',
    async run(platform) {
      const snap = dispositivo.snapshot!(platform) as DispositivoSnapshot;
      assert.equal(snap.sites.length, 12);
      assert.ok(snap.sites.every((s) => s.devices.length === 3));
      const datafonos = snap.sites.flatMap((s) => s.devices).filter((d) => d.type === 'datafono');
      assert.ok(datafonos.every((d) => d.softwareVersion === '2.14.2' && d.status === 'ok' && d.restartsLastHour === 0));
      assert.equal(snap.clients.length, 3);
      assert.ok(platform.manifests.get('dispositivos'), 'falta el manifiesto del agente dispositivos');
      assert.deepEqual(platform.tools.toApiTools(platform.manifests.get('dispositivos')!.tools).length, 7);
    },
  },
  {
    name: 'dispositivo-bloqueo-simple → resuelto por regla, coste 0',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-simple');
      assert.equal(res.caseIds?.length, 1, res.message);
      const caseId = res.caseIds![0];
      const record = await waitFor('caso resuelto', () => {
        const c = platform.cases.get(caseId);
        return c?.status === 'resolved' ? c : undefined;
      });
      await settle(platform);
      assert.equal(record.resolvedBy, 'rule');
      assert.equal(record.costUsd, 0);
      assert.equal(record.timeline.filter((e) => e.kind === 'llm').length, 0);
      assert.ok(record.timeline.some((e) => e.kind === 'tool' && e.tool === 'dispositivo_restart_device' && e.actor === 'rule'));
      assert.equal(simulator.device('hr-centro:DAT-01')?.status, 'ok');
      assert.equal(platform.approvals.list({ status: 'pending' }).length, 0);
    },
  },
  {
    name: 'dispositivo-bloqueo-aprobacion → aprobación pendiente; al aprobar se reinicia',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-aprobacion');
      const caseId = res.caseIds![0];
      assert.equal(platform.cases.get(caseId)?.status, 'waiting_approval', res.message);
      const pending = platform.approvals.list({ caseId, status: 'pending' });
      assert.equal(pending.length, 1);
      assert.equal(pending[0].tool, 'dispositivo_restart_device');
      assert.equal(pending[0].summary, 'Reiniciar datáfono DAT-01 · Pan de Pueblo · Alcalá');
      assert.equal(simulator.device('pp-alcala:DAT-01')?.status, 'locked');

      const decided = await platform.approvals.decide(pending[0].id, 'approved', 'check');
      assert.equal(decided.status, 'executed');
      await waitFor('datáfono operativo tras aprobar', () => simulator.device('pp-alcala:DAT-01')?.status === 'ok');
      await settle(platform);
      const record = platform.cases.get(caseId)!;
      assert.equal(record.status, 'resolved');
      assert.equal(record.resolvedBy, 'human');
    },
  },
  {
    name: 'dispositivo-bloqueo-persistente → 3 reinicios, escalado al agente una vez, visita pendiente de aprobación',
    async run(platform, events) {
      const res = await platform.projects.runScenario('dispositivo-bloqueo-persistente');
      const caseId = res.caseIds![0];
      const approval = await waitFor('aprobación de visita de técnico', () =>
        platform.approvals.list({ caseId, status: 'pending' }).find((a) => a.tool === 'dispositivo_open_field_ticket'),
      );
      await settle(platform);
      await sleep(50);
      await platform.runtime.idle();

      const device = simulator.device('fb-gracia:DAT-01')!;
      const record = platform.cases.get(caseId)!;
      assert.equal(simulator.restartsLastHour(device), 3);
      assert.equal(device.status, 'locked');
      assert.equal(record.agentId, 'dispositivos');
      assert.equal(record.status, 'waiting_approval');
      assert.equal(record.timeline.filter((e) => e.kind === 'tool' && e.tool === 'dispositivo_restart_device').length, 3);
      assert.equal(record.timeline.filter((e) => e.kind === 'policy' && e.decision === 'escalate').length, 1);
      assert.ok(record.timeline.some((e) => e.kind === 'llm'));
      const runs = events.filter((e) => e.type === 'run.started' && e.run.caseId === caseId);
      assert.equal(runs.length, 1, 'el agente debe encolarse una sola vez');
      assert.equal((approval.input as { deviceId?: string }).deviceId, device.id);
      assert.equal(platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'device').length, 1);
      assert.ok(record.summary?.includes('pendiente de aprobación'), record.summary);

      await platform.approvals.decide(approval.id, 'approved', 'check');
      const snap = dispositivo.snapshot!(platform) as DispositivoSnapshot;
      assert.equal(snap.fieldTickets.length, 1);
      assert.equal(snap.fieldTickets[0].deviceId, device.id);
    },
  },
  {
    name: 'dispositivo-ola-bloqueos → un caso de ola, code.suspected_bug con sourceCaseId, fix desplegado',
    async run(platform, events) {
      const res = await platform.projects.runScenario('dispositivo-ola-bloqueos');
      await waitFor('sospecha de bug emitida', () => domainEvents(events, 'code.suspected_bug').length > 0);
      await settle(platform);
      await waitFor('datáfonos operativos', () =>
        ['hr-ruzafa', 'hr-campanar', 'hr-benimaclet', 'fb-sants', 'fb-poblenou'].every(
          (s) => simulator.device(`${s}:DAT-01`)?.status === 'ok',
        ),
      );
      await settle(platform);

      const waves = platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'wave');
      assert.equal(waves.length, 1, res.message);
      const wave = waves[0];
      assert.equal(wave.severity, 'high');
      assert.equal((wave.data.devices as string[]).length, 5);
      assert.equal((wave.data.sites as string[]).length, 5);
      assert.equal(wave.data.softwareVersion, '2.14.2');
      assert.equal(wave.status, 'resolved');
      assert.equal(wave.resolvedBy, 'agent');

      const bugs = domainEvents(events, 'code.suspected_bug');
      assert.equal(bugs.length, 1);
      const bug = bugs[0].payload as SuspectedBugPayload;
      assert.equal(bug.component, 'terminal-pagos');
      assert.equal(bug.sourceCaseId, wave.id);
      assert.equal(bug.softwareVersion, '2.14.2');
      assert.ok(bug.affectedSites.length >= 3);
      assert.ok(bug.evidence.some((e) => /[a-z]+-[a-z]+:DAT-01/.test(e)), 'la evidencia debe usar IDs reales');

      const deviceCases = platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'device');
      assert.equal(deviceCases.length, 5);
      assert.ok(deviceCases.every((c) => c.status === 'resolved' && c.resolvedBy === 'rule' && c.costUsd === 0));

      await platform.rules.emit('code.fix_merged', {
        component: 'terminal-pagos',
        prId: 'PR-1',
        branch: 'fix/timeout-cobro',
        newVersion: '2.14.3',
      });
      const datafonos = simulator.devices().filter((d) => d.type === 'datafono');
      assert.ok(datafonos.every((d) => d.softwareVersion === '2.14.3' && !d.sticky));
      assert.ok(platform.notifications.list().some((n) => n.title.includes('2.14.3')));
      const again = await platform.projects.runScenario('dispositivo-ola-bloqueos');
      assert.match(again.message, /ya tienen desplegada/);
    },
  },
  {
    name: 'dispositivo-impresora-papel → aviso a tienda y resuelto por regla; la tienda repone',
    async run(platform) {
      const res = await platform.projects.runScenario('dispositivo-impresora-papel');
      const record = platform.cases.get(res.caseIds![0])!;
      assert.equal(record.status, 'resolved', res.message);
      assert.equal(record.resolvedBy, 'rule');
      const snap = dispositivo.snapshot!(platform) as DispositivoSnapshot;
      assert.equal(snap.storeNotices.length, 1);
      await waitFor('papel repuesto', () => simulator.device('hr-centro:IMP-01')?.status === 'ok');
    },
  },
  {
    name: 'dispositivo-ambiente → incidentes menores sin olas ni aprobaciones',
    async run(platform) {
      const on = await platform.projects.runScenario('dispositivo-ambiente');
      assert.match(on.message, /activada/);
      await sleep(150);
      const off = await platform.projects.runScenario('dispositivo-ambiente');
      assert.match(off.message, /desactivada/);
      await settle(platform);
      await sleep(30);
      assert.ok(platform.cases.list({ project: 'dispositivo' }).length > 0, 'la actividad de fondo debería generar casos');
      assert.equal(platform.cases.list({ project: 'dispositivo' }).filter((c) => c.data.kind === 'wave').length, 0);
      assert.equal(platform.approvals.list({ status: 'pending' }).length, 0);
    },
  },
];

async function main(): Promise<void> {
  const platform = await createPlatform({ rootDir, provider: 'mock', fast: true, inMemory: true });
  await platform.projects.register(dispositivo);
  const events: PlatformEvent[] = [];
  platform.events.on((e) => events.push(e));

  let failed = 0;
  for (const check of checks) {
    events.length = 0;
    try {
      await check.run(platform, events);
      console.log(`OK     ${check.name}`);
    } catch (err) {
      failed++;
      console.error(`FALLO  ${check.name}\n       ${err instanceof Error ? err.message : String(err)}`);
    }
    await settle(platform);
    await platform.reset();
  }

  await platform.shutdown();
  console.log(failed ? `\n${failed} comprobaciones fallidas` : `\nTodas las comprobaciones de dispositivos pasan (${checks.length}).`);
  process.exitCode = failed ? 1 : 0;
}

await main();
