/**
 * Lo que la plataforma decide sola a partir de la especificación: nombres de herramientas,
 * variables de entorno, riesgo y nivel de autonomía de cada operación, y los ficheros de
 * "fontanería" (index.ts del proyecto, políticas, .env.example, registro). También genera una
 * versión determinista de los ficheros que escribe la IA, que usa el modo simulado.
 */
import type { AgentSpec, ConnectionSpec, OperationSpec } from './spec.ts';
import { projectIdOf } from './spec.ts';

export interface PlannedTool {
  name: string;
  connection: string;
  operation: string;
  kind: 'http' | 'webhook';
  risk: 'read' | 'write_external' | 'financial';
  level: 'auto' | 'approve';
  method?: string;
  path?: string;
  env: { url: string; token?: string };
  description: string;
}

export interface Plan {
  agentId: string;
  projectId: string;
  exportName: string;
  tools: PlannedTool[];
  envVars: string[];
  files: { manifest: string; prompt: string; tools: string; index: string };
}

const snake = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const camel = (id: string) => id.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function envFor(projectId: string, connection: ConnectionSpec) {
  const prefix = `${projectId}_${snake(connection.name) || 'conexion'}`.toUpperCase();
  return connection.kind === 'webhook' ? { url: `${prefix}_WEBHOOK_URL` } : { url: `${prefix}_URL`, token: `${prefix}_TOKEN` };
}

function riskOf(op: OperationSpec): PlannedTool['risk'] {
  if (op.access === 'read') return 'read';
  return op.money ? 'financial' : 'write_external';
}

export function plan(spec: AgentSpec): Plan {
  const agentId = spec.id!;
  const projectId = projectIdOf(agentId);
  const used = new Set<string>();
  const tools: PlannedTool[] = [];
  for (const connection of spec.connections) {
    const env = envFor(projectId, connection);
    for (const op of connection.operations) {
      let name = `${projectId}_${snake(op.name) || 'operacion'}`.slice(0, 60).replace(/_+$/, '');
      for (let n = 2; used.has(name); n++) name = `${name.slice(0, 57)}_${n}`;
      used.add(name);
      tools.push({
        name,
        connection: connection.name,
        operation: op.name,
        kind: connection.kind,
        risk: riskOf(op),
        level: op.access === 'read' ? 'auto' : 'approve',
        method: connection.kind === 'http' ? (op.method ?? (op.access === 'read' ? 'GET' : 'POST')) : undefined,
        path: connection.kind === 'http' ? op.path : undefined,
        env,
        description: op.description || op.name,
      });
    }
  }
  const envVars = [...new Set(tools.flatMap((t) => [t.env.url, ...(t.env.token ? [t.env.token] : [])]))];
  const base: Plan = { agentId, projectId, exportName: camel(projectId), tools, envVars, files: {} as Plan['files'] };
  base.files = {
    manifest: `agents/${agentId}/agent.yaml`,
    prompt: `agents/${agentId}/prompt.md`,
    tools: `projects/${projectId}/tools.ts`,
    index: `projects/${projectId}/index.ts`,
  };
  return base;
}

const q = (text: string) => JSON.stringify(text);
const yamlStr = (text: string) => JSON.stringify(text.replace(/\s+/g, ' ').trim());

// ── Versión determinista de los ficheros de la IA (modo simulado) ──────────

export function draftManifest(spec: AgentSpec, p: Plan): string {
  return [
    `id: ${p.agentId}`,
    `name: ${yamlStr(spec.name)}`,
    `description: ${yamlStr(spec.purpose.split(/(?<=\.)\s/)[0])}`,
    'version: 1',
    `project: ${p.projectId}`,
    `tier: ${spec.tier}`,
    'effort: medium',
    `max_turns: ${spec.maxTurns}`,
    'budget:',
    '  tokens_per_case: 100000',
    `  usd_per_case: ${spec.budgetUsd.toFixed(2)}`,
    'tools:',
    ...p.tools.map((t) => `  - ${t.name}`),
    `owner: ${yamlStr(spec.owner)}`,
    '',
  ].join('\n');
}

export function draftPrompt(spec: AgentSpec, p: Plan): string {
  const lines = [
    `Eres el agente "${spec.name}" de la plataforma de HitSystems (software para cadenas de panaderías).`,
    '',
    '## Objetivo',
    spec.purpose,
    '',
  ];
  if (spec.context) lines.push('## Contexto', spec.context, '');
  lines.push('## Herramientas');
  for (const t of p.tools) {
    lines.push(`- \`${t.name}\`: ${t.description}${t.level === 'approve' ? ' Requiere aprobación de una persona.' : ''}`);
  }
  lines.push(
    '',
    '## Reglas',
    '- Consulta antes de actuar y no inventes datos: si una herramienta falla, dilo y no sigas a ciegas.',
    '- Las acciones de escritura pasan por la política de autonomía; si quedan pendientes de aprobación, explícalo.',
    '- Termina con un resumen breve en texto plano: qué has hecho, qué queda pendiente y por qué.',
    '',
  );
  return lines.join('\n');
}

export function draftTools(spec: AgentSpec, p: Plan): string {
  const entries = p.tools.map((t) => {
    const params = [...(t.path ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const props = params.map((k) => `${k}: { type: 'string', description: ${q(`Valor de ${k} en la ruta.`)} }`);
    if (t.kind === 'webhook') props.push(`message: { type: 'string', description: 'Texto del mensaje.' }`);
    else if (t.method === 'GET') props.push(`filtro: { type: 'string', description: 'Filtro opcional (query string).' }`);
    else props.push(`datos: { type: 'object', description: 'Cuerpo de la petición.' }`);
    const required = t.kind === 'webhook' ? ['message', ...params] : params;
    const schema = `{ type: 'object', properties: { ${props.join(', ')} }, required: ${JSON.stringify(required)} }`;
    if (t.kind === 'webhook') {
      return `  webhookTool({
    name: ${q(t.name)},
    project: PROJECT,
    description: ${q(t.description)},
    risk: ${q(t.risk)},
    urlEnv: ${q(t.env.url)},
    inputSchema: ${schema},
  }),`;
    }
    return `  httpTool({
    name: ${q(t.name)},
    project: PROJECT,
    description: ${q(t.description)},
    risk: ${q(t.risk)},
    method: ${q(t.method!)},
    baseUrlEnv: ${q(t.env.url)},
    tokenEnv: ${q(t.env.token!)},
    path: ${q(t.path ?? `/${snake(t.operation)}`)},
    inputSchema: ${schema},
  }),`;
  });
  return `/**
 * Herramientas del agente ${spec.name}. Solo usan los conectores de la plataforma.
 */
import { httpTool, webhookTool } from '../../platform/connectors.ts';
import type { ToolDefinition } from '../../platform/contracts.ts';

const PROJECT = ${q(p.projectId)};

export const tools: ToolDefinition[] = [
${entries.join('\n')}
];
`;
}

// ── Fontanería que añade la plataforma ─────────────────────────────────────

export function projectIndex(spec: AgentSpec, p: Plan): string {
  const rule =
    spec.trigger === 'event' && spec.event
      ? `
let fired = 0;

const onEvent: Rule = {
  id: '${p.projectId}_on_event',
  project: PROJECT,
  description: ${q(`Ante ${spec.event}, abre un caso y se lo pasa al agente (máximo 3 por arranque).`)},
  on: ${q(spec.event)},
  handle: async (event, platform) => {
    if (fired >= 3) return;
    fired++;
    const record = platform.cases.create({ project: PROJECT, title: ${q(`${spec.name}: `)} + event.name, source: 'ticket', scope: {}, agentId: AGENT_ID });
    platform.runtime.enqueue({ agentId: AGENT_ID, caseId: record.id, task: 'Evento ' + event.name + ':\\n' + JSON.stringify(event.payload, null, 2) });
  },
};
`
      : '';
  return `/**
 * Proyecto ${p.projectId}: ${spec.name}. Generado por el agente creador de agentes.
 */
import type { ProjectModule${rule ? ', Rule' : ''} } from '../../platform/contracts.ts';
import { tools } from './tools.ts';

const PROJECT = ${q(p.projectId)};
const AGENT_ID = ${q(p.agentId)};
${rule}
export const ${p.exportName}: ProjectModule = {
  id: PROJECT,
  name: ${q(spec.name)},
  description: ${q(spec.purpose.split(/(?<=\.)\s/)[0])},
  tools,
  rules: [${rule ? 'onEvent' : ''}],
  scenarios: [
    {
      id: ${q(`${p.projectId}-probar`)},
      project: PROJECT,
      title: ${q(`Probar ${spec.name}`)},
      description: 'Abre un caso de prueba y se lo pasa al agente.',
      order: 200,
      run: async (platform) => {
        const record = platform.cases.create({ project: PROJECT, title: ${q(`Prueba: ${spec.name}`)}, source: 'ticket', scope: {}, agentId: AGENT_ID });
        platform.runtime.enqueue({ agentId: AGENT_ID, caseId: record.id, task: ${q(`Caso de prueba. ${spec.purpose}`)} });
        return { message: ${q(`Caso de prueba enviado a ${spec.name}.`)}, caseIds: [record.id] };
      },
    },
  ],
};

export default ${p.exportName};
`;
}

export function policyBlock(spec: AgentSpec, p: Plan): string {
  const lines = [``, `  # ── ${spec.name} (agente creador) ──────────────────────`];
  for (const t of p.tools) lines.push(`  - action: ${t.name}`, `    level: ${t.level}`);
  return lines.join('\n') + '\n';
}

/** Inserta el bloque al final de `actions:`, antes de `overrides:` si existe. */
export function insertPolicies(source: string, block: string): string {
  const i = source.search(/\n+overrides:/);
  if (i === -1) return source.replace(/\n*$/, '\n') + block;
  return source.slice(0, i) + '\n' + block + source.slice(i);
}

export function envBlock(spec: AgentSpec, p: Plan): string {
  const lines = ['', `# ${spec.name} (${p.agentId})`];
  for (const c of spec.connections) {
    const env = envFor(p.projectId, c);
    lines.push(`# ${c.name}${c.description ? `: ${c.description.replace(/\s+/g, ' ')}` : ''}`);
    lines.push(`${env.url}=`);
    if (env.token) lines.push(`${env.token}=`);
  }
  return lines.join('\n') + '\n';
}

/** Añade el import y la entrada en allProjects de projects/index.ts. */
export function registerInIndex(source: string, p: Plan): string {
  if (source.includes(`./${p.projectId}/index.ts`)) return source;
  const withImport = source.replace(
    /(import [^\n]+ from '\.\/[^']+\/index\.ts';\n)(?![\s\S]*import [^\n]+ from '\.\/[^']+\/index\.ts';)/,
    `$1import { ${p.exportName} } from './${p.projectId}/index.ts';\n`,
  );
  return withImport.replace(/export const allProjects: ProjectModule\[\] = \[([^\]]*)\]/, (_, list: string) => `export const allProjects: ProjectModule[] = [${list.trim()}, ${p.exportName}]`);
}
