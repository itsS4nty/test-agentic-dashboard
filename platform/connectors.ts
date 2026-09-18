/**
 * Conectores para las herramientas de los agentes generados por el agente creador.
 *
 * Es la única vía por la que un agente generado toca la red o el entorno: lee sus variables al
 * ejecutar, exige https (salvo localhost), corta a los 15 s, recorta la respuesta y nunca la
 * devuelve con el token dentro.
 */
import type { RiskClass, ToolDefinition, ToolResult } from './contracts.ts';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Schema = ToolDefinition['inputSchema'];

export interface HttpToolDef {
  name: string;
  project: string;
  description: string;
  risk: RiskClass;
  method: Method;
  /** Variable con la URL base, p. ej. OBRADOR_API_URL. */
  baseUrlEnv: string;
  /** Variable con el token Bearer, opcional. */
  tokenEnv?: string;
  /** Ruta relativa con {parámetros}: /pedidos/{id} */
  path: string;
  inputSchema: Schema;
}

export interface WebhookToolDef {
  name: string;
  project: string;
  description: string;
  risk: RiskClass;
  /** Variable con la URL del webhook, p. ej. SLACK_WEBHOOK_URL. */
  urlEnv: string;
  inputSchema: Schema;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

function mask(text: string, secret?: string): string {
  return secret ? text.split(secret).join('[oculto]') : text;
}

function firstSentence(text: string): string {
  return text.split(/(?<=\.)\s/)[0].replace(/\.$/, '');
}

function checkUrl(raw: string, envName: string): URL | ToolResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, content: `La variable ${envName} no contiene una URL válida.` };
  }
  if (url.protocol !== 'https:' && !LOCAL.has(url.hostname)) {
    return { ok: false, content: `${envName} debe usar https.` };
  }
  return url;
}

async function send(url: URL, init: RequestInit, secret?: string): Promise<ToolResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = mask((await res.text()).slice(0, 4000), secret);
    return { ok: res.ok, content: `${init.method} ${url.pathname} → ${res.status}${body ? `\n${body}` : ''}` };
  } catch (err) {
    return { ok: false, content: mask(`No se pudo conectar con ${url.host}: ${(err as Error).message}`, secret) };
  }
}

export function httpTool(def: HttpToolDef): ToolDefinition {
  return {
    name: def.name,
    project: def.project,
    description: def.description,
    risk: def.risk,
    inputSchema: def.inputSchema,
    describe: () => firstSentence(def.description),
    async handler(input: Record<string, unknown> = {}) {
      const base = process.env[def.baseUrlEnv];
      if (!base) return { ok: false, content: `Conexión no configurada: define ${def.baseUrlEnv} en .env.` };
      const token = def.tokenEnv ? process.env[def.tokenEnv] : undefined;
      const path = def.path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(input[key] ?? '')));
      const checked = checkUrl(`${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, def.baseUrlEnv);
      if (!(checked instanceof URL)) return checked;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      let body: string | undefined;
      if (def.method === 'GET' || def.method === 'DELETE') {
        for (const [key, value] of Object.entries(input)) {
          if (!def.path.includes(`{${key}}`) && value !== undefined && value !== null && typeof value !== 'object') {
            checked.searchParams.set(key, String(value));
          }
        }
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(input);
      }
      return send(checked, { method: def.method, headers, body }, token);
    },
  };
}

export function webhookTool(def: WebhookToolDef): ToolDefinition {
  return {
    name: def.name,
    project: def.project,
    description: def.description,
    risk: def.risk,
    inputSchema: def.inputSchema,
    describe: () => firstSentence(def.description),
    async handler(input: Record<string, unknown> = {}) {
      const raw = process.env[def.urlEnv];
      if (!raw) return { ok: false, content: `Conexión no configurada: define ${def.urlEnv} en .env.` };
      const checked = checkUrl(raw, def.urlEnv);
      if (!(checked instanceof URL)) return checked;
      const text = typeof input.message === 'string' ? input.message : JSON.stringify(input);
      return send(checked, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }, raw);
    },
  };
}
