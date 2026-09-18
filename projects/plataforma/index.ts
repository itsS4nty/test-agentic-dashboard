/**
 * Proyecto plataforma: el agente creador de agentes. Una persona describe el agente en la consola
 * (POST /api/agent-requests); el agente `creador` escribe sus ficheros y abre un PR en este repo.
 */
import type { MockScript, PlatformApi, ProjectModule, Scenario } from '../../platform/contracts.ts';
import { draftManifest, draftPrompt, draftTools, plan } from './generate.ts';
import { validateSpec } from './spec.ts';
import type { AgentSpec, SpecError } from './spec.ts';
import { AGENT_ID, PROJECT_ID, getState, requestForCase, resetState, saveState } from './state.ts';
import { baseBranch, plataformaTools, repoDir } from './tools.ts';
import { githubTarget } from './git.ts';

/** Ids que no puede usar un agente nuevo: agentes, proyectos y solicitudes en curso. */
export function reservedIds(platform: PlatformApi): string[] {
  const state = getState(platform);
  return [
    ...platform.manifests.list().map((m) => m.id),
    ...platform.projects.list().map((p) => p.id),
    ...state.requests.filter((r) => r.status !== 'failed' && r.status !== 'closed').map((r) => r.agentId),
  ];
}

export function submitAgentRequest(
  platform: PlatformApi,
  input: unknown,
): { ok: true; requestId: string; caseId: string; message: string } | { ok: false; errors: SpecError[] } {
  const checked = validateSpec(input);
  if (!checked.ok) return checked;
  const spec = checked.spec;
  const reserved = reservedIds(platform);
  if (reserved.includes(spec.id!) || reserved.includes(spec.id!.replace(/-/g, '_'))) {
    return { ok: false, errors: [{ field: 'id', message: `Ya existe un agente o proyecto «${spec.id}». Cambia el nombre o el identificador.` }] };
  }
  const state = getState(platform);
  state.seq += 1;
  const requestId = `SOL-${String(state.seq).padStart(3, '0')}`;
  const record = platform.cases.create({
    project: PROJECT_ID,
    title: `Crear agente: ${spec.name}`,
    source: 'code',
    scope: {},
    severity: 'low',
    agentId: AGENT_ID,
    data: { requestId, agentId: spec.id },
  });
  state.specs[requestId] = spec;
  state.requests.unshift({ id: requestId, caseId: record.id, name: spec.name, agentId: spec.id!, createdAt: new Date().toISOString(), status: 'queued' });
  saveState(platform, state);
  platform.runtime.enqueue({
    agentId: AGENT_ID,
    caseId: record.id,
    task:
      `Nueva solicitud ${requestId}: crear el agente «${spec.name}» (${spec.id}). ` +
      'Lee la solicitud, escribe los tres ficheros, valida hasta que salga correcta, abre el PR y pide la fusión.',
  });
  return { ok: true, requestId, caseId: record.id, message: `Solicitud ${requestId} enviada al agente creador.` };
}

/** Guion del modo simulado: los mismos pasos que la IA, con ficheros generados de forma determinista. */
const creadorMock: MockScript = (ctx) => {
  const request = requestForCase(ctx.platform, ctx.caseRecord.id);
  if (!request) return { text: 'No encuentro la solicitud de este caso.' };
  const spec = getState(ctx.platform).specs[request.id];
  const p = plan(spec);
  const last = ctx.lastResults[0];
  if (ctx.turn === 0) return { text: 'Leo la solicitud.', toolCalls: [{ name: 'plataforma_get_request', input: {} }] };
  if (last?.name === 'plataforma_get_request') {
    return {
      text: 'Escribo manifiesto, prompt y herramientas.',
      toolCalls: [
        { name: 'plataforma_write_file', input: { path: p.files.manifest, content: draftManifest(spec, p) } },
        { name: 'plataforma_write_file', input: { path: p.files.prompt, content: draftPrompt(spec, p) } },
        { name: 'plataforma_write_file', input: { path: p.files.tools, content: draftTools(spec, p) } },
      ],
    };
  }
  if (last?.name === 'plataforma_write_file') return { text: 'Valido la rama.', toolCalls: [{ name: 'plataforma_validate', input: {} }] };
  if (last?.name === 'plataforma_validate') {
    if (!last.ok) return { text: `La validación falla y no abro el PR.\n${last.content}` };
    return {
      text: 'Validación correcta. Abro el PR.',
      toolCalls: [
        {
          name: 'plataforma_open_pr',
          input: {
            title: `Nuevo agente: ${spec.name}`,
            body: `${spec.purpose}\n\nHerramientas: ${p.tools.map((t) => `${t.name} (${t.level})`).join(', ')}.`,
          },
        },
      ],
    };
  }
  if (last?.name === 'plataforma_open_pr' && last.ok) {
    const prId = (last.data as { prId: string }).prId;
    return { text: 'Pido la fusión.', toolCalls: [{ name: 'plataforma_merge_pr', input: { prId } }] };
  }
  const pr = getState(ctx.platform).prs.find((x) => x.requestId === request.id);
  return {
    text:
      `He creado el agente ${spec.name} (${p.agentId}) con ${p.tools.length} herramientas y abierto el PR ${pr?.id ?? ''}.\n` +
      (pr?.status === 'merged' ? 'El PR está fusionado.' : 'Pendiente: una persona tiene que aprobar la fusión.') +
      (p.envVars.length ? `\nAntes de usarlo hay que rellenar en .env: ${p.envVars.join(', ')}.` : ''),
  };
};

export const EXAMPLE_SPEC: AgentSpec = {
  name: 'Pedidos del obrador',
  purpose:
    'Revisa cada mañana los pedidos que las tiendas han enviado al obrador central, detecta cantidades anómalas frente a la media ' +
    'de las últimas semanas y avisa al encargado de producción antes de las 6:00. Si falta un pedido de una tienda, lo reclama.',
  trigger: 'manual',
  connections: [
    {
      name: 'ERP obrador',
      kind: 'http',
      description: 'API REST del ERP del obrador central.',
      operations: [
        { name: 'Listar pedidos del día', description: 'Pedidos de todas las tiendas para una fecha.', access: 'read', method: 'GET', path: '/pedidos' },
        { name: 'Histórico de pedidos de una tienda', description: 'Pedidos de las últimas semanas de una tienda.', access: 'read', method: 'GET', path: '/tiendas/{tiendaId}/pedidos' },
        { name: 'Ajustar cantidad de un pedido', description: 'Corrige la cantidad de una línea de pedido.', access: 'write', method: 'PATCH', path: '/pedidos/{pedidoId}' },
      ],
    },
    {
      name: 'Slack producción',
      kind: 'webhook',
      description: 'Canal #produccion del obrador.',
      operations: [{ name: 'Avisar a producción', description: 'Publica un aviso en el canal de producción.', access: 'write' }],
    },
  ],
  context: 'Una tienda de 365 pide de media 120 barras al día; los sábados, un 40 % más. Una variación mayor del 50 % es anómala.',
  tier: 'fast',
  budgetUsd: 0.3,
  maxTurns: 8,
  owner: 'Producción',
};

const crearScenario: Scenario = {
  id: 'plataforma-crear-agente',
  project: PROJECT_ID,
  title: 'Crear un agente de ejemplo',
  description: 'Envía al agente creador una solicitud de ejemplo (pedidos del obrador) para que escriba el agente y abra el PR.',
  order: 100,
  run: async (platform) => {
    const spec = { ...EXAMPLE_SPEC };
    const taken = reservedIds(platform);
    let id = 'pedidos-obrador';
    for (let n = 2; taken.includes(id) || taken.includes(id.replace(/-/g, '_')); n++) id = `pedidos-obrador-${n}`;
    const result = submitAgentRequest(platform, { ...spec, id });
    if (!result.ok) return { message: `No se pudo crear la solicitud: ${result.errors.map((e) => e.message).join(' ')}` };
    return { message: result.message, caseIds: [result.caseId] };
  },
};

let cachedMode: { mode: 'local' | 'github'; remote?: { repo: string; url: string }; base: string } | null = null;

async function refreshMode(platform: PlatformApi) {
  const target = await githubTarget(repoDir(platform)).catch(() => null);
  cachedMode = {
    mode: target ? 'github' : 'local',
    remote: target ? { repo: `${target.owner}/${target.repo}`, url: `https://github.com/${target.owner}/${target.repo}` } : undefined,
    base: await baseBranch(platform).catch(() => 'main'),
  };
}

export const plataforma: ProjectModule = {
  id: PROJECT_ID,
  name: 'Plataforma',
  description: 'El agente creador de agentes: de una descripción a un PR con el agente nuevo en este repositorio.',
  tools: plataformaTools,
  rules: [],
  mocks: { [AGENT_ID]: creadorMock },
  scenarios: [crearScenario],
  init: async (platform) => {
    getState(platform);
    await refreshMode(platform);
  },
  reset: async (platform) => {
    resetState(platform);
  },
  snapshot: (platform) => {
    const state = getState(platform);
    return {
      mode: cachedMode?.mode ?? 'local',
      remote: cachedMode?.remote,
      baseBranch: cachedMode?.base ?? 'main',
      requests: state.requests,
      prs: state.prs.map(({ requestId: _r, ...pr }) => pr),
    };
  },
};
