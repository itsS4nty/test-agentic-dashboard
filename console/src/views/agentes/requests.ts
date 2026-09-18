/**
 * Envío de una solicitud de agente: `POST /api/agent-requests` (docs/CONTRACTS.md, proyecto
 * plataforma). 201 → `{ requestId, caseId, message }`; 400 → `{ error, errors: { field, message }[] }`.
 */
import type { AgentRequestCreated, AgentSpec, SpecError } from '../project/types.ts';

/** El servidor rechazó la especificación: `errors` trae el motivo campo a campo. */
export class AgentRequestRejected extends Error {
  readonly errors: SpecError[];

  constructor(message: string, errors: SpecError[]) {
    super(message);
    this.name = 'AgentRequestRejected';
    this.errors = errors;
  }
}

function isSpecError(value: unknown): value is SpecError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SpecError).field === 'string' &&
    typeof (value as SpecError).message === 'string'
  );
}

export async function createAgentRequest(spec: AgentSpec): Promise<AgentRequestCreated> {
  let res: Response;
  try {
    res = await fetch('/api/agent-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
  } catch {
    throw new Error('No se pudo contactar con el servidor.');
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (res.ok) return body as AgentRequestCreated;

  const payload = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; errors?: unknown };
  const errors = Array.isArray(payload.errors) ? payload.errors.filter(isSpecError) : [];
  const message =
    typeof payload.error === 'string' && payload.error
      ? payload.error
      : res.status === 404
        ? 'Este servidor no admite todavía la creación de agentes.'
        : `No se pudo enviar la solicitud (${res.status}).`;

  if (res.status === 400 || errors.length) throw new AgentRequestRejected(message, errors);
  throw new Error(message);
}
