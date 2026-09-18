/**
 * Registro de herramientas. Toda invocación pasa por el Policy Gate (salvo `skipPolicy`,
 * que solo usan las aprobaciones humanas) y deja traza en el caso.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type {
  Actor,
  PlatformApi,
  PolicyDecision,
  Scope,
  TimelineEntry,
  ToolContext,
  ToolDefinition,
  ToolInvokeOutcome,
  ToolRegistry,
  ToolResult,
} from './contracts.ts';
import { errorMessage, truncate } from './util.ts';

const NAME_PATTERN = /^[a-z0-9_]+$/;
const EXCERPT_CHARS = 500;

const DECISION_TITLE: Record<PolicyDecision, string> = {
  auto: 'Permitido',
  notify: 'Permitido con aviso',
  approve: 'Enviado a aprobación',
  shadow: 'Modo sombra',
  deny: 'Bloqueado por política',
  escalate: 'Escalado por política',
};

export function createToolRegistry(platform: PlatformApi): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  function trace(caseId: string, entry: Omit<TimelineEntry, 'id' | 'at'>): void {
    if (platform.cases.get(caseId)) platform.cases.addTimeline(caseId, entry);
  }

  function describe(tool: ToolDefinition, input: unknown): string {
    if (tool.describe) {
      try {
        const text = tool.describe(input, platform);
        if (text) return text;
      } catch (err) {
        console.warn(`[herramientas] describe() de ${tool.name} ha fallado: ${errorMessage(err)}`);
      }
    }
    return tool.name;
  }

  function resolveScope(tool: ToolDefinition, input: unknown, caseId: string): Scope {
    let scope: Scope | undefined;
    if (tool.scope) {
      try {
        scope = tool.scope(input, { platform, caseId });
      } catch (err) {
        console.warn(`[herramientas] scope() de ${tool.name} ha fallado; se usa el del caso. ${errorMessage(err)}`);
      }
    }
    const out: Scope = { ...(scope ?? platform.cases.get(caseId)?.scope ?? {}) };
    if (out.siteId && !out.clientId) {
      const site = platform.directory.site(out.siteId);
      if (site) out.clientId = site.clientId;
    }
    return out;
  }

  /** Ejecuta el handler sin lanzar nunca. `threw` indica que no llegó a completarse. */
  async function execute(
    tool: ToolDefinition,
    input: unknown,
    ctx: ToolContext,
    label: string,
  ): Promise<{ result: ToolResult; threw: boolean }> {
    try {
      const raw = await tool.handler(input, ctx);
      if (!raw || typeof raw !== 'object') throw new Error('la herramienta no ha devuelto resultado');
      return { result: { ...raw, ok: Boolean(raw.ok), content: String(raw.content ?? '') }, threw: false };
    } catch (err) {
      const message = errorMessage(err);
      trace(ctx.caseId, {
        kind: 'error',
        title: `Error al ejecutar: ${label}`,
        detail: message,
        actor: ctx.actor,
        agentId: ctx.agentId,
        tool: tool.name,
      });
      return { result: { ok: false, content: `Error: ${message}` }, threw: true };
    }
  }

  function toolEntry(
    tool: ToolDefinition,
    input: unknown,
    result: ToolResult,
    label: string,
    actor: Actor,
    agentId: string | undefined,
    decision: PolicyDecision,
    afterApproval = false,
  ): Omit<TimelineEntry, 'id' | 'at'> {
    const prefix = !result.ok ? 'Falló' : afterApproval ? 'Ejecutado tras aprobación' : 'Ejecutado';
    return {
      kind: 'tool',
      title: `${prefix}: ${label}`,
      detail: truncate(result.content, EXCERPT_CHARS),
      actor,
      agentId,
      tool: tool.name,
      decision,
      executed: true,
      data: { ok: result.ok, input },
    };
  }

  const registry: ToolRegistry = {
    register(tool) {
      if (!NAME_PATTERN.test(tool.name)) {
        throw new Error(`Nombre de herramienta no válido: "${tool.name}" (solo a-z, 0-9 y _)`);
      }
      tools.set(tool.name, tool);
    },

    get: (name) => tools.get(name),

    list: () => [...tools.values()],

    toApiTools(names) {
      const out: Anthropic.Tool[] = [];
      for (const name of names) {
        const tool = tools.get(name);
        if (!tool) {
          console.warn(`[herramientas] ${name} no está registrada; no se ofrece al modelo.`);
          continue;
        }
        out.push({ name: tool.name, description: tool.description, input_schema: tool.inputSchema });
      }
      return out;
    },

    async invoke(name, rawInput, invocation): Promise<ToolInvokeOutcome> {
      const { caseId, actor, agentId, reason } = invocation;
      const input = rawInput ?? {};
      const tool = tools.get(name);

      if (!tool) {
        const content = `Herramienta desconocida: ${name}`;
        trace(caseId, { kind: 'error', title: content, actor, agentId, tool: name });
        return { executed: false, decision: 'deny', result: { ok: false, content } };
      }

      const scope = resolveScope(tool, input, caseId);
      const label = describe(tool, input);
      const ctx: ToolContext = { platform, caseId, actor, agentId, scope };

      // Acción ya aprobada por una persona: se ejecuta sin volver a evaluar.
      if (invocation.skipPolicy) {
        const { result, threw } = await execute(tool, input, ctx, label);
        if (!threw) trace(caseId, toolEntry(tool, input, result, label, 'human', undefined, 'auto', true));
        return { executed: !threw, decision: 'auto', result };
      }

      const evaluation = await platform.policy.evaluate(name, input, scope, caseId);
      const { decision } = evaluation;
      const scopeText = platform.directory.describeScope(scope);

      const policyEntry = (executed: boolean, extra: Record<string, unknown> = {}) =>
        trace(caseId, {
          kind: 'policy',
          title: `${DECISION_TITLE[decision]}: ${label}`,
          detail: evaluation.reason,
          actor,
          agentId,
          tool: name,
          decision,
          executed,
          data: {
            ceiling: evaluation.ceiling,
            ceilingSource: evaluation.ceilingSource,
            matchedCondition: evaluation.matchedCondition,
            scope: scopeText,
            risk: tool.risk,
            input,
            ...extra,
          },
        });

      switch (decision) {
        case 'auto':
        case 'notify': {
          if (!(tool.risk === 'read' && decision === 'auto')) policyEntry(true);
          const { result, threw } = await execute(tool, input, ctx, label);
          if (!threw) trace(caseId, toolEntry(tool, input, result, label, actor, agentId, decision));
          if (decision === 'notify' && !threw) {
            platform.notifications.push({
              level: 'info',
              title: `Ejecutado y notificado: ${label}`,
              detail: `${scopeText} · ${truncate(result.content, 200)}`,
              caseId,
              project: tool.project,
            });
          }
          return { executed: !threw, decision, evaluation, result };
        }

        case 'approve': {
          const approval = platform.approvals.create({
            caseId,
            project: tool.project,
            actor,
            agentId,
            tool: name,
            input,
            scope,
            summary: scopeText === 'Global' ? label : `${label} · ${scopeText}`,
            reason,
            risk: tool.risk,
          });
          policyEntry(false, { approvalId: approval.id });
          const record = platform.cases.get(caseId);
          if (record && record.status !== 'escalated' && record.status !== 'waiting_approval') {
            platform.cases.update(caseId, { status: 'waiting_approval' });
          }
          return {
            executed: false,
            decision,
            evaluation,
            approvalId: approval.id,
            result: { ok: true, content: `Acción enviada a aprobación humana (${approval.id}). Aún no se ha ejecutado.` },
          };
        }

        case 'shadow':
          policyEntry(false);
          return {
            executed: false,
            decision,
            evaluation,
            result: { ok: true, content: `[modo sombra] Acción registrada pero NO ejecutada: ${label}` },
          };

        case 'deny':
          policyEntry(false);
          return {
            executed: false,
            decision,
            evaluation,
            result: { ok: false, content: `Bloqueado por política: ${evaluation.reason}` },
          };

        case 'escalate':
          policyEntry(false);
          if (platform.cases.get(caseId)) platform.cases.escalate(caseId, evaluation.reason);
          return {
            executed: false,
            decision,
            evaluation,
            result: { ok: false, content: `Escalado a una persona: ${evaluation.reason}` },
          };
      }
    },
  };

  return registry;
}
