/**
 * Autocomprobación de la plataforma, sin red ni proyectos reales:
 *   npx tsx platform/selftest.ts
 *
 * Monta una raíz temporal con la configuración de modelos y clientes del proyecto, una política
 * y dos manifiestos de prueba, y registra un proyecto de prueba en memoria.
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  LlmRequest,
  LlmResponse,
  MockScript,
  PlatformApi,
  PlatformEvent,
  ProjectModule,
  ToolDefinition,
} from './contracts.ts';
import { createPlatform } from './index.ts';
import { createStore } from './store.ts';
import { sleep } from './util.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// ─────────────────────────────────────────────────────────────
// Raíz temporal: configuración y agentes de prueba
// ─────────────────────────────────────────────────────────────

const POLICIES_YAML = `
actions:
  - action: prueba_get_status
    level: auto
  - action: prueba_restart_device
    level: auto
    conditions:
      - when: [prueba_busy]
        decision: deny
        label: El dispositivo tiene una operación en curso
      - when: [prueba_attempts_exceeded]
        decision: escalate
        label: Demasiados reinicios seguidos
      - when: [prueba_trusted]
        decision: auto
        label: Dispositivo de confianza
      - when: [prueba_low_battery]
        decision: notify
        label: Batería baja
      - when: [predicado_que_no_existe]
        decision: deny
        label: Nunca debería cumplirse
overrides:
  - scope: { clientId: pan-de-pueblo }
    action: prueba_restart_device
    level: approve
`;

const agentYaml = (id: string, usdPerCase: number) => `
id: ${id}
name: Agente ${id}
description: Agente de prueba de la plataforma.
version: 1
project: prueba
tier: fast
max_turns: 6
budget:
  tokens_per_case: 80000
  usd_per_case: ${usdPerCase}
tools:
  - prueba_get_status
  - prueba_restart_device
owner: Plataforma
`;

function prepareRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'plataforma-selftest-'));
  mkdirSync(join(root, 'config'));
  cpSync(join(projectRoot, 'config', 'models.yaml'), join(root, 'config', 'models.yaml'));
  cpSync(join(projectRoot, 'config', 'clients.yaml'), join(root, 'config', 'clients.yaml'));
  writeFileSync(join(root, 'config', 'policies.yaml'), POLICIES_YAML);
  for (const [id, usd] of [['prueba', 0.6], ['prueba_tacano', 0.0000001]] as const) {
    mkdirSync(join(root, 'agents', id), { recursive: true });
    writeFileSync(join(root, 'agents', id, 'agent.yaml'), agentYaml(id, usd));
    writeFileSync(join(root, 'agents', id, 'prompt.md'), 'Revisa el dispositivo y actúa con prudencia.');
  }
  return root;
}

// ─────────────────────────────────────────────────────────────
// Proyecto de prueba
// ─────────────────────────────────────────────────────────────

const calls = { status: 0, restart: 0, init: 0, reset: 0 };

const getStatus: ToolDefinition<Record<string, never>> = {
  name: 'prueba_get_status',
  project: 'prueba',
  description: 'Devuelve el estado del dispositivo de prueba.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  describe: () => 'Consultar estado',
  async handler() {
    calls.status++;
    return { ok: true, content: 'Todo en orden.', data: { status: 'ok' } };
  },
};

interface RestartInput {
  deviceId: string;
  busy?: boolean;
  attempts?: number;
  trusted?: boolean;
  lowBattery?: boolean;
  fail?: boolean;
}

const restartDevice: ToolDefinition<RestartInput> = {
  name: 'prueba_restart_device',
  project: 'prueba',
  description: 'Reinicia el dispositivo de prueba.',
  inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] },
  risk: 'physical',
  describe: (input) => `Reiniciar ${input.deviceId}`,
  async handler(input) {
    if (input.fail) throw new Error('fallo simulado');
    calls.restart++;
    return { ok: true, content: `Reinicio de ${input.deviceId} iniciado.`, data: { deviceId: input.deviceId } };
  },
};

const agentScript: MockScript = async (ctx) => {
  if (ctx.caseRecord.data.mode === 'queue') {
    await sleep(15); // solapa ejecuciones para medir el tope de concurrencia
    return ctx.turn === 0 ? { toolCalls: [{ name: 'prueba_get_status', input: {} }] } : { text: 'Cola: hecho.' };
  }
  if (ctx.turn === 0) {
    return {
      text: 'Primero consulto el estado y reinicio el terminal.',
      toolCalls: [
        { name: 'prueba_get_status', input: {} },
        { name: 'prueba_restart_device', input: { deviceId: 'DAT-01' } },
      ],
    };
  }
  const executed = ctx.lastResults.filter((r) => r.executed).length;
  return { text: `Resumen: ${ctx.lastResults.length} acciones, ${executed} ejecutadas, ${ctx.allResults.length} en total.` };
};

const testProject: ProjectModule = {
  id: 'prueba',
  name: 'Proyecto de prueba',
  description: 'Solo para la autocomprobación.',
  tools: [getStatus, restartDevice],
  rules: [
    {
      id: 'prueba.evento',
      project: 'prueba',
      description: 'Crea un caso, consulta el estado y lo resuelve por regla.',
      on: 'prueba.evento',
      async handle(event, platform) {
        const c = platform.cases.create({ project: 'prueba', title: 'Caso de regla', source: 'device', scope: { siteId: event.payload.siteId } });
        await platform.tools.invoke('prueba_get_status', {}, { caseId: c.id, actor: 'rule' });
        platform.cases.resolve(c.id, 'rule', 'Resuelto por la regla de prueba.');
      },
    },
    {
      id: 'prueba.rota',
      project: 'prueba',
      description: 'Falla siempre: no debe romper a las demás.',
      on: 'prueba.evento',
      async handle() {
        throw new Error('regla rota a propósito');
      },
    },
  ],
  predicates: {
    prueba_busy: ({ input }) => input?.busy === true,
    prueba_attempts_exceeded: ({ input }) => (input?.attempts ?? 0) >= 3,
    prueba_trusted: ({ input }) => input?.trusted === true,
    prueba_low_battery: ({ input }) => input?.lowBattery === true,
  },
  mocks: { prueba: agentScript, prueba_tacano: agentScript },
  scenarios: [
    {
      id: 'prueba-escenario',
      project: 'prueba',
      title: 'Escenario de prueba',
      description: 'Devuelve un mensaje.',
      order: 1,
      run: async () => ({ message: 'Escenario ejecutado' }),
    },
  ],
  async init() {
    calls.init++;
  },
  async reset() {
    calls.reset++;
  },
};

// ─────────────────────────────────────────────────────────────
// Mini arnés
// ─────────────────────────────────────────────────────────────

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  OK     ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FALLO  ${name}\n         ${err instanceof Error ? err.message : String(err)}`);
  }
}

function newCase(platform: PlatformApi, siteId: string, data: Record<string, unknown> = {}) {
  return platform.cases.create({ project: 'prueba', title: `Caso de prueba en ${siteId}`, source: 'device', scope: { siteId }, data });
}

const invokeAs = (platform: PlatformApi, caseId: string, name: string, input: unknown) =>
  platform.tools.invoke(name, input, { caseId, actor: 'agent', agentId: 'prueba', reason: 'Prueba' });

// ─────────────────────────────────────────────────────────────
// Pruebas
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = prepareRoot();
  const platform = await createPlatform({ rootDir: root, inMemory: true, fast: true, provider: 'mock' });
  const events: PlatformEvent[] = [];
  platform.events.on((e) => events.push(e));
  await platform.projects.register(testProject);

  console.log('Autocomprobación de la plataforma (inMemory · fast · mock)\n');

  await check('arranque: proveedor simulado, manifiestos desde YAML e init del proyecto', () => {
    assert.equal(platform.llm.provider, 'mock');
    assert.equal(platform.llm.label, 'Simulado · sin IA real');
    const manifest = platform.manifests.get('prueba');
    assert.ok(manifest, 'manifiesto prueba');
    assert.equal(manifest.maxTurns, 6);
    assert.equal(manifest.budget.usdPerCase, 0.6);
    assert.deepEqual(manifest.tools, ['prueba_get_status', 'prueba_restart_device']);
    assert.equal(manifest.manifestPath, 'agents/prueba/agent.yaml');
    assert.equal(calls.init, 1);
    assert.equal(platform.directory.describeScope({ siteId: 'hr-centro' }), 'Panaderías Horno Real · Centro');
    assert.equal(platform.directory.describeScope({}), 'Global');
    assert.deepEqual(
      platform.tools.toApiTools(['prueba_restart_device', 'prueba_get_status']).map((t) => t.name),
      ['prueba_restart_device', 'prueba_get_status'],
    );
  });

  await check('lectura con techo auto: se ejecuta y deja UNA sola entrada tool', async () => {
    const c = newCase(platform, 'hr-centro');
    assert.equal(c.scope.clientId, 'horno-real', 'el caso completa el cliente desde la tienda');
    const out = await invokeAs(platform, c.id, 'prueba_get_status', {});
    assert.equal(out.executed, true);
    assert.equal(out.decision, 'auto');
    assert.equal(out.result.content, 'Todo en orden.');
    assert.equal(calls.status, 1);
    const trace = platform.cases.get(c.id)!.timeline.filter((e) => e.kind === 'tool' || e.kind === 'policy');
    assert.equal(trace.length, 1);
    assert.equal(trace[0].kind, 'tool');
  });

  await check('acción physical sin condiciones activas: policy + tool, predicado no registrado = falso', async () => {
    const c = newCase(platform, 'hr-centro');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01' });
    assert.equal(out.executed, true);
    assert.equal(out.decision, 'auto');
    assert.equal(out.evaluation?.reason, 'Techo auto (por defecto) · sin condiciones activas');
    assert.equal(calls.restart, 1);
    assert.deepEqual(platform.cases.get(c.id)!.timeline.slice(1).map((e) => e.kind), ['policy', 'tool']);
  });

  await check('condición deny por predicado: bloquea, no ejecuta y cuenta en blockedByPolicy', async () => {
    const before = platform.metrics().blockedByPolicy;
    const restarts = calls.restart;
    const c = newCase(platform, 'hr-centro');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01', busy: true });
    assert.equal(out.executed, false);
    assert.equal(out.decision, 'deny');
    assert.equal(out.result.ok, false);
    assert.equal(out.result.content, 'Bloqueado por política: Bloqueado: El dispositivo tiene una operación en curso');
    assert.equal(out.evaluation?.matchedCondition, 'El dispositivo tiene una operación en curso');
    assert.equal(calls.restart, restarts, 'el handler no se llama');
    assert.equal(platform.metrics().blockedByPolicy, before + 1);
    const entry = platform.cases.get(c.id)!.timeline.find((e) => e.kind === 'policy')!;
    assert.equal(entry.decision, 'deny');
    assert.equal(entry.executed, false);
  });

  await check('condición escalate: no ejecuta, escala el caso y avisa', async () => {
    const c = newCase(platform, 'hr-ruzafa');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01', attempts: 3 });
    assert.equal(out.decision, 'escalate');
    assert.equal(out.executed, false);
    assert.equal(out.result.content, 'Escalado a una persona: Escalado: Demasiados reinicios seguidos');
    assert.equal(platform.cases.get(c.id)!.status, 'escalated');
    assert.ok(platform.notifications.list().some((n) => n.level === 'warning' && n.caseId === c.id));
  });

  await check('condición con nivel: baja el techo a notify (ejecuta y notifica) pero nunca lo sube', async () => {
    const c = newCase(platform, 'hr-centro');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01', lowBattery: true });
    assert.equal(out.decision, 'notify');
    assert.equal(out.executed, true);
    assert.equal(out.evaluation?.reason, 'Techo auto (por defecto) · baja a notify: Batería baja');
    assert.ok(platform.notifications.list().some((n) => n.level === 'info' && n.title === 'Ejecutado y notificado: Reiniciar DAT-01'));

    const raised = await platform.policy.evaluate('prueba_restart_device', { trusted: true }, { siteId: 'pp-getafe' }, c.id);
    assert.equal(raised.decision, 'approve', 'una condición auto no sube un techo approve');
    assert.equal(raised.ceilingSource, 'client');
  });

  let approvalId = '';
  let approvalCaseId = '';
  await check('override de cliente: crea aprobación pendiente y deja el caso en waiting_approval', async () => {
    const restarts = calls.restart;
    const c = newCase(platform, 'pp-alcala');
    approvalCaseId = c.id;
    const out = await platform.tools.invoke('prueba_restart_device', { deviceId: 'DAT-01' }, { caseId: c.id, actor: 'rule', reason: 'Datáfono bloqueado' });
    assert.equal(out.decision, 'approve');
    assert.equal(out.executed, false);
    assert.equal(out.result.ok, true);
    assert.match(out.result.content, /^Acción enviada a aprobación humana \(apr_[0-9a-f]+\)\. Aún no se ha ejecutado\.$/);
    assert.equal(out.evaluation?.reason, 'Techo approve (override de cliente Pan de Pueblo) · sin condiciones activas');
    assert.ok(out.approvalId);
    approvalId = out.approvalId;
    const approval = platform.approvals.get(approvalId)!;
    assert.equal(approval.status, 'pending');
    assert.equal(approval.summary, 'Reiniciar DAT-01 · Pan de Pueblo · Alcalá');
    assert.equal(approval.risk, 'physical');
    assert.equal(approval.reason, 'Datáfono bloqueado');
    assert.equal(platform.cases.get(c.id)!.status, 'waiting_approval');
    assert.equal(calls.restart, restarts);
    assert.equal(platform.metrics().pendingApprovals, 1);
  });

  await check('decidir approved: ejecuta con skipPolicy, queda executed y el caso lo resuelve una persona', async () => {
    const restarts = calls.restart;
    const decided = await platform.approvals.decide(approvalId, 'approved', 'Selftest', 'Adelante');
    assert.equal(decided.status, 'executed');
    assert.equal(decided.result?.ok, true);
    assert.equal(decided.decidedBy, 'Selftest');
    assert.equal(calls.restart, restarts + 1);
    const c = platform.cases.get(approvalCaseId)!;
    assert.equal(c.status, 'resolved');
    assert.equal(c.resolvedBy, 'human');
    assert.ok(c.timeline.some((e) => e.kind === 'approval'));
    assert.ok(c.timeline.some((e) => e.kind === 'tool' && e.actor === 'human'));
    assert.equal(platform.metrics().feedback.approved, 1);
    await assert.rejects(platform.approvals.decide(approvalId, 'approved', 'Selftest'), /ya está decidida/);
  });

  await check('decidir rejected: no ejecuta, cuenta feedback y resuelve por persona', async () => {
    const restarts = calls.restart;
    const c = newCase(platform, 'pp-getafe');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01' });
    const decided = await platform.approvals.decide(out.approvalId!, 'rejected', 'Selftest', 'No');
    assert.equal(decided.status, 'rejected');
    assert.equal(calls.restart, restarts);
    assert.equal(platform.cases.get(c.id)!.resolvedBy, 'human');
    assert.equal(platform.metrics().feedback.rejected, 1);
  });

  await check('runtime con mock: tool_result en un único mensaje, completa y resuelve por agente con coste > 0', async () => {
    const original = platform.llm.complete;
    const requests: LlmRequest[] = [];
    const responses: LlmResponse[] = [];
    platform.llm.complete = async (request) => {
      requests.push(structuredClone(request));
      const response = await original(request);
      responses.push(structuredClone(response));
      return response;
    };
    try {
      const c = newCase(platform, 'hr-benimaclet', { device: 'DAT-01' });
      const result = await platform.runtime.run({ agentId: 'prueba', caseId: c.id, task: 'Revisa el datáfono.' });
      assert.equal(result.status, 'completed');
      assert.equal(result.turns, 2);
      assert.ok(result.costUsd > 0, 'coste > 0');
      assert.equal(result.finalText, 'Resumen: 2 acciones, 2 ejecutadas, 2 en total.');

      const done = platform.cases.get(c.id)!;
      assert.equal(done.status, 'resolved');
      assert.equal(done.resolvedBy, 'agent');
      assert.equal(done.agentId, 'prueba');
      assert.equal(done.summary, result.finalText);
      assert.ok(done.costUsd > 0 && done.tokens.input > 0 && done.tokens.output > 0);
      const llmEntries = done.timeline.filter((e) => e.kind === 'llm');
      assert.equal(llmEntries.length, 2);
      assert.equal(llmEntries[0].model, 'claude-haiku-4-5 (simulado)');

      assert.match(requests[0].system, /NO confiables/);
      assert.match(String(requests[0].messages[0].content), /<datos_del_caso confiable="no">/);
      assert.equal(requests[0].maxTokens, 16000);
      const second = requests[1].messages;
      assert.equal(second.length, 3);
      assert.deepEqual(second[1], { role: 'assistant', content: responses[0].content }, 'assistant tal cual');
      assert.equal(second[2].role, 'user');
      const blocks = second[2].content as { type: string; tool_use_id: string; is_error: boolean }[];
      assert.equal(blocks.length, 2);
      assert.ok(blocks.every((b) => b.type === 'tool_result' && b.is_error === false));

      const started = events.find((e) => e.type === 'run.started' && e.run.caseId === c.id);
      const finished = events.find((e) => e.type === 'run.finished' && e.run.caseId === c.id);
      assert.ok(started && finished && finished.type === 'run.finished' && finished.status === 'completed');
    } finally {
      platform.llm.complete = original;
    }
  });

  await check('enqueue: tope de concurrencia 3 e idle() espera también lo encolado durante la espera', async () => {
    let maxActive = 0;
    let extraCaseId = '';
    const offStarted = platform.events.on((e) => {
      if (e.type === 'run.started') maxActive = Math.max(maxActive, platform.runtime.activeRuns().length);
    });
    const offFinished = platform.events.on((e) => {
      if (e.type === 'run.finished' && !extraCaseId) {
        extraCaseId = newCase(platform, 'fb-sants', { mode: 'queue' }).id;
        platform.runtime.enqueue({ agentId: 'prueba', caseId: extraCaseId, task: 'Encolada mientras idle() espera.' });
      }
    });
    try {
      const ids = ['hr-centro', 'hr-ruzafa', 'hr-campanar', 'fb-gracia', 'fb-poblenou'].map((s) => newCase(platform, s, { mode: 'queue' }).id);
      for (const caseId of ids) platform.runtime.enqueue({ agentId: 'prueba', caseId, task: 'Tarea en cola.' });
      await platform.runtime.idle();
      assert.ok(extraCaseId, 'se encoló una ejecución durante la espera');
      for (const id of [...ids, extraCaseId]) {
        const c = platform.cases.get(id)!;
        assert.equal(c.status, 'resolved', `${id} resuelto`);
        assert.equal(c.resolvedBy, 'agent');
      }
      assert.equal(maxActive, 3);
      assert.equal(platform.runtime.activeRuns().length, 0);
      assert.ok(platform.cases.get(ids[3])!.timeline.some((e) => e.kind === 'note' && e.title.startsWith('En cola')));
    } finally {
      offStarted();
      offFinished();
    }
  });

  await check('modo shadow: no ejecuta; override de tienda sustituye al defecto; reset de política', async () => {
    const restarts = calls.restart;
    platform.policy.setActionLevel('prueba_restart_device', 'shadow');
    assert.ok(events.some((e) => e.type === 'policy.changed'));
    const c = newCase(platform, 'hr-campanar');
    const out = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01' });
    assert.equal(out.decision, 'shadow');
    assert.equal(out.executed, false);
    assert.equal(out.result.ok, true);
    assert.equal(out.result.content, '[modo sombra] Acción registrada pero NO ejecutada: Reiniciar DAT-01');
    assert.equal(calls.restart, restarts);

    platform.policy.setOverride({ siteId: 'hr-campanar' }, 'prueba_restart_device', 'notify');
    const site = await platform.policy.evaluate('prueba_restart_device', {}, { siteId: 'hr-campanar' }, c.id);
    assert.equal(site.decision, 'notify');
    assert.equal(site.ceilingSource, 'site');
    platform.policy.setOverride({ siteId: 'hr-campanar' }, 'prueba_restart_device', null);
    assert.equal((await platform.policy.evaluate('prueba_restart_device', {}, { siteId: 'hr-campanar' }, c.id)).decision, 'shadow');

    const config = platform.policy.reset();
    assert.equal(config.actions.find((a) => a.action === 'prueba_restart_device')!.level, 'auto');
    assert.equal(config.overrides.length, 1);
  });

  await check('refusal: el caso se escala y la ejecución termina en refused', async () => {
    const original = platform.llm.complete;
    platform.llm.complete = async (request) => ({ ...(await original(request)), content: [], stopReason: 'refusal' });
    try {
      const c = newCase(platform, 'hr-cabanyal');
      const result = await platform.runtime.run({ agentId: 'prueba', caseId: c.id, task: 'Tarea.' });
      assert.equal(result.status, 'refused');
      assert.equal(platform.cases.get(c.id)!.status, 'escalated');
    } finally {
      platform.llm.complete = original;
    }
  });

  await check('presupuesto agotado: entrada error, caso escalado y estado budget_exceeded', async () => {
    const c = newCase(platform, 'hr-patraix');
    const result = await platform.runtime.run({ agentId: 'prueba_tacano', caseId: c.id, task: 'Tarea.' });
    assert.equal(result.status, 'budget_exceeded');
    const done = platform.cases.get(c.id)!;
    assert.equal(done.status, 'escalated');
    assert.ok(done.timeline.some((e) => e.kind === 'error' && e.title === 'Presupuesto agotado'));
  });

  await check('errores: handler que lanza, herramienta desconocida y agente inexistente no lanzan', async () => {
    const c = newCase(platform, 'hr-centro');
    const failed = await invokeAs(platform, c.id, 'prueba_restart_device', { deviceId: 'DAT-01', fail: true });
    assert.equal(failed.result.ok, false);
    assert.equal(failed.result.content, 'Error: fallo simulado');
    assert.ok(platform.cases.get(c.id)!.timeline.some((e) => e.kind === 'error'));

    const unknown = await invokeAs(platform, c.id, 'no_existe', {});
    assert.deepEqual(unknown, { executed: false, decision: 'deny', result: { ok: false, content: 'Herramienta desconocida: no_existe' } });

    const result = await platform.runtime.run({ agentId: 'agente_fantasma', caseId: c.id, task: 'Tarea.' });
    assert.equal(result.status, 'failed');
    assert.equal(platform.cases.get(c.id)!.status, 'failed');
  });

  await check('reglas en serie (una rota no rompe a las demás) y escenarios', async () => {
    const before = platform.cases.list().length;
    const originalError = console.error;
    console.error = () => {};
    try {
      await platform.rules.emit('prueba.evento', { siteId: 'fb-gracia' });
    } finally {
      console.error = originalError;
    }
    assert.ok(events.some((e) => e.type === 'domain' && e.event.name === 'prueba.evento'));
    const created = platform.cases.list().slice(before);
    assert.equal(created.length, 1);
    assert.equal(created[0].resolvedBy, 'rule');
    assert.equal(created[0].costUsd, 0);
    assert.deepEqual(await platform.projects.runScenario('prueba-escenario'), { message: 'Escenario ejecutado' });
    await assert.rejects(platform.projects.runScenario('no-existe'), /Escenario desconocido/);
  });

  await check('métricas coherentes', () => {
    const m = platform.metrics();
    assert.equal(m.casesTotal, platform.cases.list().length);
    assert.equal(m.casesResolved, m.resolvedByRule + m.resolvedByAgent + m.resolvedByHuman);
    assert.ok(m.autoResolutionRate > 0 && m.autoResolutionRate < 1);
    assert.ok(m.llmCalls >= 2 && m.toolCalls > 0 && m.costUsd > 0);
    assert.equal(m.byProject.prueba.cases, m.casesTotal);
  });

  await check('reset(): vacía el estado, restaura la política y reinicia los proyectos', async () => {
    platform.policy.setActionLevel('prueba_get_status', 'shadow');
    await platform.reset();
    assert.equal(platform.cases.list().length, 0);
    assert.equal(platform.approvals.list().length, 0);
    assert.equal(platform.policy.getConfig().actions.find((a) => a.action === 'prueba_get_status')!.level, 'auto');
    assert.equal(platform.metrics().feedback.approved, 0);
    assert.equal(calls.reset, 1);
    assert.equal(events.at(-1)?.type, 'reset');
    assert.equal(existsSync(join(root, 'data')), false, 'inMemory no toca disco');
  });

  await check('store persistente: escritura diferida, flush y restauración', async () => {
    const file = join(root, 'estado', 'state.json');
    const store = createStore({ filePath: file, saveDelayMs: 20 });
    store.put('cosas', { id: 'a', n: 1 });
    store.setValue('clave', { x: 1 });
    assert.equal(existsSync(file), false, 'aún no se ha escrito');
    await store.flush();
    assert.equal(existsSync(file), true);
    const restored = createStore({ filePath: file });
    assert.deepEqual(restored.get('cosas', 'a'), { id: 'a', n: 1 });
    assert.deepEqual(restored.getValue('clave'), { x: 1 });
    store.put('cosas', { id: 'b', n: 2 });
    await sleep(80);
    assert.equal(createStore({ filePath: file }).list('cosas').length, 2, 'el temporizador guarda solo');
  });

  await check('configuración real del proyecto: cascada y motivos del Policy Gate', async () => {
    const real = await createPlatform({ rootDir: projectRoot, inMemory: true, fast: true, provider: 'mock' });
    let cobro = false;
    real.policy.registerPredicate('transaction_in_flight', () => cobro);
    real.policy.registerPredicate('restart_attempts_exceeded', () => false);
    const alcala = await real.policy.evaluate('dispositivo_restart_device', {}, { siteId: 'pp-alcala' }, 'sin-caso');
    assert.equal(alcala.decision, 'approve');
    assert.equal(alcala.reason, 'Techo approve (override de cliente Pan de Pueblo) · sin condiciones activas');
    const centro = await real.policy.evaluate('dispositivo_restart_device', {}, { siteId: 'hr-centro' }, 'sin-caso');
    assert.equal(centro.decision, 'auto');
    assert.equal(centro.reason, 'Techo auto (por defecto) · sin condiciones activas');
    cobro = true;
    const blocked = await real.policy.evaluate('dispositivo_restart_device', {}, { siteId: 'pp-alcala' }, 'sin-caso');
    assert.equal(blocked.decision, 'deny', 'deny gana aunque el techo sea approve');
    assert.equal(blocked.reason, 'Bloqueado: Hay un cobro en curso en el terminal');
    assert.equal(real.llm.modelFor('reasoning'), 'claude-opus-5');
  });

  rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} comprobación(es) fallida(s).` : '\nTodo correcto.');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('La autocomprobación ha fallado al arrancar:', err);
  process.exit(1);
});
