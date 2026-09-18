/**
 * Rutas HTTP de la API (docs/CONTRACTS.md § 7).
 * Las formas de respuesta reflejan exactamente console/src/api.ts.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';
import { AUTONOMY_ORDER } from '../platform/contracts.ts';
import { submitAgentRequest } from '../projects/plataforma/index.ts';
import type {
  ActionPolicy,
  ApprovalStatus,
  AutonomyLevel,
  CaseStatus,
  Client,
  LlmProviderId,
  PlatformApi,
  PlatformEvent,
  PolicyConfig,
  RiskClass,
  Scope,
} from '../platform/contracts.ts';

// Formas de respuesta: copia de console/src/api.ts (la consola no forma parte del tsconfig del servidor).
interface StatusInfo {
  provider: LlmProviderId;
  providerLabel: string;
  models: { reasoning: string; fast: string };
  projects: { id: string; name: string; description: string }[];
  startedAt: string;
}

interface ActionInfo {
  name: string;
  project: string;
  description: string;
  risk: RiskClass;
  policy?: ActionPolicy;
}

interface PoliciesInfo {
  config: PolicyConfig;
  actions: ActionInfo[];
  clients: Client[];
}

interface ScenarioInfo {
  id: string;
  project: string;
  title: string;
  description: string;
  order: number;
}

interface RuleInfo {
  id: string;
  project: string;
  description: string;
  on: string;
}

const CASE_STATUSES: readonly CaseStatus[] = ['open', 'running', 'waiting_approval', 'resolved', 'escalated', 'failed'];
const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected', 'executed', 'failed'];
const SSE_PING_MS = 15_000;

// ─────────────────────────────────────────────────────────────
// Utilidades de validación y respuesta
// ─────────────────────────────────────────────────────────────

function fail(reply: FastifyReply, code: number, error: string) {
  return reply.code(code).send({ error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is AutonomyLevel {
  return typeof value === 'string' && (AUTONOMY_ORDER as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Una acción es conocida si hay herramienta registrada o entrada en la configuración de políticas. */
function isKnownAction(platform: PlatformApi, action: string): boolean {
  return Boolean(platform.tools.get(action)) || platform.policy.getConfig().actions.some((a) => a.action === action);
}

const levelsText = AUTONOMY_ORDER.join(', ');

// ─────────────────────────────────────────────────────────────
// Registro de rutas
// ─────────────────────────────────────────────────────────────

export function registerRoutes(app: FastifyInstance, platform: PlatformApi): void {
  // ── Estado general ───────────────────────────────────────
  app.get('/api/status', async (): Promise<StatusInfo> => ({
    provider: platform.llm.provider,
    providerLabel: platform.llm.label,
    models: { reasoning: platform.llm.modelFor('reasoning'), fast: platform.llm.modelFor('fast') },
    projects: platform.projects.list().map((p) => ({ id: p.id, name: p.name, description: p.description })),
    startedAt: platform.startedAt,
  }));

  app.get('/api/metrics', async () => platform.metrics());

  // ── Eventos en vivo (SSE) ────────────────────────────────
  const sseClients = new Set<ServerResponse>();

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseClients.add(res);

    const write = (chunk: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const send = (event: PlatformEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

    send({ type: 'hello', at: new Date().toISOString() });
    const unsubscribe = platform.events.on(send);
    const ping = setInterval(() => write(': ping\n\n'), SSE_PING_MS);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      unsubscribe();
      sseClients.delete(res);
    };
    request.raw.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  // Las conexiones SSE no se cierran solas: se terminan antes de cerrar el servidor.
  app.addHook('preClose', async () => {
    for (const res of sseClients) res.end();
    sseClients.clear();
  });

  // ── Casos ────────────────────────────────────────────────
  app.get<{ Querystring: { project?: string; status?: string } }>('/api/cases', async (request, reply) => {
    const { project, status } = request.query;
    if (status !== undefined && !isOneOf(status, CASE_STATUSES)) {
      return fail(reply, 400, `Estado de caso no válido: "${status}". Valores: ${CASE_STATUSES.join(', ')}`);
    }
    const filter: { project?: string; status?: CaseStatus } = {};
    if (project) filter.project = project;
    if (status) filter.status = status;
    return platform.cases.list(filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (request, reply) => {
    const found = platform.cases.get(request.params.id);
    if (!found) return fail(reply, 404, `Caso no encontrado: ${request.params.id}`);
    return found;
  });

  // ── Aprobaciones ─────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>('/api/approvals', async (request, reply) => {
    const { status } = request.query;
    if (status !== undefined && !isOneOf(status, APPROVAL_STATUSES)) {
      return fail(reply, 400, `Estado de aprobación no válido: "${status}". Valores: ${APPROVAL_STATUSES.join(', ')}`);
    }
    const approvals = status ? platform.approvals.list({ status }) : platform.approvals.list();
    return approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  app.post<{ Params: { id: string } }>('/api/approvals/:id/decision', async (request, reply) => {
    const body = request.body;
    if (!isRecord(body)) return fail(reply, 400, 'Se esperaba un cuerpo JSON { decision, comment? }');
    const { decision, comment } = body;
    if (decision !== 'approved' && decision !== 'rejected') {
      return fail(reply, 400, 'El campo "decision" debe ser "approved" o "rejected"');
    }
    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      return fail(reply, 400, 'El campo "comment" debe ser texto');
    }

    const approval = platform.approvals.get(request.params.id);
    if (!approval) return fail(reply, 404, `Aprobación no encontrada: ${request.params.id}`);
    if (approval.status !== 'pending') {
      return fail(reply, 409, `La aprobación ${approval.id} ya está decidida (estado: ${approval.status})`);
    }
    const text = typeof comment === 'string' && comment.trim() ? comment.trim() : undefined;
    return platform.approvals.decide(approval.id, decision, 'Consola', text);
  });

  // ── Políticas (el dial) ──────────────────────────────────
  app.get('/api/policies', async (): Promise<PoliciesInfo> => {
    const config = platform.policy.getConfig();
    const actions: ActionInfo[] = platform.tools.list().map((tool) => {
      const info: ActionInfo = {
        name: tool.name,
        project: tool.project,
        description: tool.description,
        risk: tool.risk,
      };
      const policy = config.actions.find((a) => a.action === tool.name);
      if (policy) info.policy = policy;
      return info;
    });
    return { config, actions, clients: platform.directory.clients() };
  });

  app.put<{ Params: { action: string } }>('/api/policies/actions/:action', async (request, reply) => {
    const { action } = request.params;
    const body = request.body;
    if (!isRecord(body) || !isLevel(body.level)) {
      return fail(reply, 400, `Se esperaba un cuerpo JSON { level } con uno de: ${levelsText}`);
    }
    if (!isKnownAction(platform, action)) return fail(reply, 404, `Acción desconocida: ${action}`);
    return platform.policy.setActionLevel(action, body.level);
  });

  app.put('/api/policies/overrides', async (request, reply) => {
    const body = request.body;
    if (!isRecord(body)) return fail(reply, 400, 'Se esperaba un cuerpo JSON { scope, action, level }');
    const { scope: rawScope, action, level } = body;

    if (typeof action !== 'string' || !action) return fail(reply, 400, 'El campo "action" es obligatorio');
    if (level !== null && !isLevel(level)) {
      return fail(reply, 400, `El campo "level" debe ser null (quitar override) o uno de: ${levelsText}`);
    }
    if (!isRecord(rawScope)) return fail(reply, 400, 'El campo "scope" debe ser un objeto { clientId?, siteId? }');

    const scope: Scope = {};
    for (const key of ['clientId', 'siteId', 'deviceId'] as const) {
      const value = rawScope[key];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string') return fail(reply, 400, `El campo "scope.${key}" debe ser texto`);
      scope[key] = value;
    }
    if (!scope.clientId && !scope.siteId) {
      return fail(reply, 400, 'Un override necesita al menos "scope.clientId" o "scope.siteId"');
    }
    if (scope.clientId && !platform.directory.client(scope.clientId)) {
      return fail(reply, 400, `Cliente desconocido: ${scope.clientId}`);
    }
    if (scope.siteId) {
      const site = platform.directory.site(scope.siteId);
      if (!site) return fail(reply, 400, `Tienda desconocida: ${scope.siteId}`);
      if (scope.clientId && site.clientId !== scope.clientId) {
        return fail(reply, 400, `La tienda ${scope.siteId} no pertenece al cliente ${scope.clientId}`);
      }
    }
    if (!isKnownAction(platform, action)) return fail(reply, 404, `Acción desconocida: ${action}`);

    return platform.policy.setOverride(scope, action, level);
  });

  app.post('/api/policies/reset', async () => platform.policy.reset());

  // ── Agentes, reglas, ejecuciones y notificaciones ────────
  app.get('/api/agents', async () => platform.manifests.list());

  app.get('/api/rules', async (): Promise<RuleInfo[]> =>
    platform.rules.list().map((r) => ({ id: r.id, project: r.project, description: r.description, on: r.on })),
  );

  app.get('/api/runs', async () => platform.runtime.activeRuns());

  app.get('/api/notifications', async () => platform.notifications.list());

  // ── Proyectos y escenarios ───────────────────────────────
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const project = platform.projects.get(request.params.id);
    if (!project) return fail(reply, 404, `Proyecto no encontrado: ${request.params.id}`);
    if (!project.snapshot) return fail(reply, 404, `El proyecto ${project.id} no publica estado para la consola`);
    const snapshot = await project.snapshot(platform);
    return snapshot ?? {};
  });

  app.get('/api/scenarios', async (): Promise<ScenarioInfo[]> =>
    platform.projects
      .scenarios()
      .map((s) => ({ id: s.id, project: s.project, title: s.title, description: s.description, order: s.order }))
      .sort((a, b) => a.order - b.order),
  );

  app.post<{ Params: { id: string } }>('/api/scenarios/:id/run', async (request, reply) => {
    const scenario = platform.projects.scenarios().find((s) => s.id === request.params.id);
    if (!scenario) return fail(reply, 404, `Escenario no encontrado: ${request.params.id}`);
    const outcome = await platform.projects.runScenario(scenario.id);
    const response: { message: string; caseIds?: string[] } = { message: outcome.message };
    if (outcome.caseIds?.length) response.caseIds = outcome.caseIds;
    return response;
  });

  // ── Agente creador de agentes ─────────────────────────────
  app.post('/api/agent-requests', async (request, reply) => {
    const result = submitAgentRequest(platform, request.body);
    if (!result.ok) return reply.code(400).send({ error: 'La especificación no es válida.', errors: result.errors });
    return reply.code(201).send({ requestId: result.requestId, caseId: result.caseId, message: result.message });
  });

  app.post('/api/reset', async () => {
    await platform.reset();
    return { ok: true as const };
  });
}
