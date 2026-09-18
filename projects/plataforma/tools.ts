/**
 * Herramientas del agente creador. La IA escribe manifiesto, prompt y herramientas; la plataforma
 * añade políticas, .env.example y registro, valida, abre el PR y, con aprobación, lo fusiona.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import type { PlatformApi, ToolDefinition, ToolResult } from '../../platform/contracts.ts';
import { childEnv } from '../bugs/redact.ts';
import { envBlock, insertPolicies, plan, policyBlock, projectIndex, registerInIndex } from './generate.ts';
import { authEnv, clean, git, githubTarget, octokit, pushBranch } from './git.ts';
import type { AgentSpec } from './spec.ts';
import { AGENT_ID, PROJECT_ID, getState, requestForCase, saveState, updateRequest } from './state.ts';
import type { AgentPr, ValidationStep } from './state.ts';

const run = promisify(execFile);

/** Repo sobre el que trabaja el creador: el de la plataforma (en el smoke, una copia). */
export const repoDir = (platform: PlatformApi) => process.env.CREADOR_REPO_DIR || platform.rootDir;
const worktreeDir = (platform: PlatformApi, requestId: string) => join(platform.dataDir, 'worktrees', requestId);

export async function baseBranch(platform: PlatformApi): Promise<string> {
  return process.env.GITHUB_BASE_BRANCH || (await git(repoDir(platform), ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main'));
}

function context(platform: PlatformApi, caseId: string) {
  const request = requestForCase(platform, caseId);
  if (!request) throw new Error('Este caso no corresponde a ninguna solicitud de agente.');
  const spec = getState(platform).specs[request.id] as AgentSpec;
  return { request, spec, plan: plan(spec), dir: worktreeDir(platform, request.id) };
}

const fail = (content: string): ToolResult => ({ ok: false, content });

async function ensureWorktree(platform: PlatformApi, requestId: string, agentId: string): Promise<string> {
  const dir = worktreeDir(platform, requestId);
  if (existsSync(join(dir, '.git'))) return dir;
  const repo = repoDir(platform);
  await git(repo, ['worktree', 'prune']).catch(() => undefined);
  let branch = `agente/${agentId}`;
  const exists = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
  if (exists) branch = `${branch}-${requestId.toLowerCase()}`;
  mkdirSync(dirname(dir), { recursive: true });
  // Con GitHub, la rama sale de la base del remoto: el PR solo lleva el agente nuevo.
  let from = 'HEAD';
  const target = await githubTarget(repo);
  if (target) {
    const base = await baseBranch(platform);
    await git(repo, ['fetch', '--no-tags', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], authEnv(target.token));
    from = `origin/${base}`;
  }
  await git(repo, ['worktree', 'add', '-b', branch, dir, from]);
  return dir;
}

// ── 1. Leer la solicitud ──────────────────────────────────────────────────

const getRequest: ToolDefinition = {
  name: 'plataforma_get_request',
  project: PROJECT_ID,
  description:
    'Devuelve la solicitud del agente a crear: la especificación que ha rellenado la persona, los identificadores y ' +
    'nombres de herramientas que ha fijado la plataforma, las variables de entorno, los ficheros que debes escribir y un ejemplo.',
  risk: 'read',
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, { platform, caseId }) {
    const { request, spec, plan: p } = context(platform, caseId);
    await ensureWorktree(platform, request.id, p.agentId);
    if (request.status === 'queued') updateRequest(platform, request.id, { status: 'working' });
    const root = repoDir(platform);
    const example = (f: string) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
    const content = [
      '# Solicitud',
      JSON.stringify(spec, null, 2),
      '',
      '# Lo que fija la plataforma (no lo cambies)',
      `agentId: ${p.agentId}`,
      `projectId: ${p.projectId}`,
      'Herramientas (nombre, conexión, riesgo, nivel de autonomía, variables):',
      ...p.tools.map(
        (t) =>
          `- ${t.name}: ${t.kind === 'http' ? `${t.method} ${t.path ?? '(elige la ruta)'}` : 'webhook'} · conexión "${t.connection}" · ` +
          `risk: '${t.risk}' · nivel ${t.level} · ${t.kind === 'http' ? `baseUrlEnv: ${t.env.url}, tokenEnv: ${t.env.token}` : `urlEnv: ${t.env.url}`}`,
      ),
      '',
      '# Ficheros que escribes tú (plataforma_write_file)',
      `- ${p.files.manifest}: YAML con id, name, description, version: 1, project, tier (${spec.tier}), effort, max_turns (${spec.maxTurns}), budget.tokens_per_case, budget.usd_per_case (${spec.budgetUsd}), tools (exactamente las de arriba), owner.`,
      `- ${p.files.prompt}: el prompt de sistema del agente, en español, concreto para este dominio.`,
      `- ${p.files.tools}: exporta \`export const tools: ToolDefinition[]\` construido SOLO con httpTool/webhookTool.`,
      '',
      'La plataforma genera sola ' + `${p.files.index}` + ', las políticas, .env.example y el registro en projects/index.ts.',
      '',
      '# API de conectores (platform/connectors.ts)',
      "import { httpTool, webhookTool } from '../../platform/connectors.ts';",
      "import type { ToolDefinition } from '../../platform/contracts.ts';",
      "httpTool({ name, project, description, risk, method: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE', baseUrlEnv, tokenEnv, path: '/ruta/{param}', inputSchema: { type: 'object', properties: {...}, required: [...] } })",
      '  · Los {param} de la ruta salen del input; en GET/DELETE el resto del input va como query string; en el resto, como cuerpo JSON.',
      "webhookTool({ name, project, description, risk, urlEnv, inputSchema }) → envía { text: input.message }.",
      'No uses fetch, process.env, fs ni child_process: los conectores ya leen las variables y controlan la red.',
      '',
      '# Ejemplo de un agente existente',
      '## agents/facturacion/agent.yaml',
      example('agents/facturacion/agent.yaml'),
      '## agents/facturacion/prompt.md (inicio)',
      example('agents/facturacion/prompt.md').slice(0, 1500),
    ].join('\n');
    return { ok: true, content, data: { agentId: p.agentId, projectId: p.projectId } };
  },
};

// ── 2. Escribir un fichero ────────────────────────────────────────────────

const writeFile: ToolDefinition<{ path: string; content: string }> = {
  name: 'plataforma_write_file',
  project: PROJECT_ID,
  description:
    'Escribe uno de los tres ficheros del agente en su rama: agents/<id>/agent.yaml, agents/<id>/prompt.md o projects/<projectId>/tools.ts. ' +
    'Sobrescribe el fichero entero.',
  risk: 'write_internal',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Ruta relativa al repo, una de las tres permitidas.' },
      content: { type: 'string', description: 'Contenido completo del fichero.' },
    },
    required: ['path', 'content'],
  },
  describe: (input) => `Escribir ${input.path}`,
  async handler(input, { platform, caseId }) {
    const { request, plan: p } = context(platform, caseId);
    const allowed = [p.files.manifest, p.files.prompt, p.files.tools];
    if (!allowed.includes(input.path)) return fail(`Ruta no permitida: ${input.path}. Solo: ${allowed.join(', ')}.`);
    if (typeof input.content !== 'string' || !input.content.trim()) return fail('El contenido está vacío.');
    if (input.content.length > 40_000) return fail('Fichero demasiado grande (máximo 40 000 caracteres).');
    const dir = await ensureWorktree(platform, request.id, p.agentId);
    const target = join(dir, input.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, input.content.endsWith('\n') ? input.content : `${input.content}\n`);
    return { ok: true, content: `Escrito ${input.path} (${input.content.split('\n').length} líneas).`, data: { path: input.path } };
  },
};

// ── 3. Validar ────────────────────────────────────────────────────────────

const FORBIDDEN: [RegExp, string][] = [
  [/\bprocess\s*\.\s*env\b/, 'process.env'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bchild_process\b/, 'child_process'],
  [/\beval\s*\(|new\s+Function\s*\(/, 'eval'],
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*\(/, 'import() dinámico'],
];
const ALLOWED_IMPORTS = new Set(['../../platform/connectors.ts', '../../platform/contracts.ts']);

async function validate(platform: PlatformApi, caseId: string) {
  const { request, spec, plan: p, dir } = context(platform, caseId);
  const steps: ValidationStep[] = [];
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);

  const missing = [p.files.manifest, p.files.prompt, p.files.tools].filter((f) => read(f) === null);
  steps.push({ name: 'Ficheros', ok: missing.length === 0, output: missing.length ? `Faltan: ${missing.join(', ')}` : 'Manifiesto, prompt y herramientas presentes.' });

  // Fontanería de la plataforma, idempotente.
  writeFileSync(join(dir, p.files.index), projectIndex(spec, p));
  const root = (f: string) => readFileSync(join(dir, f), 'utf8');
  if (!root('config/policies.yaml').includes(`action: ${p.tools[0]?.name}\n`)) {
    writeFileSync(join(dir, 'config/policies.yaml'), insertPolicies(root('config/policies.yaml'), policyBlock(spec, p)));
  }
  if (p.envVars.length && !root('.env.example').includes(`${p.envVars[0]}=`)) {
    writeFileSync(join(dir, '.env.example'), root('.env.example').replace(/\n*$/, '\n') + envBlock(spec, p));
  }
  writeFileSync(join(dir, 'projects/index.ts'), registerInIndex(root('projects/index.ts'), p));
  steps.push({ name: 'Fontanería', ok: true, output: `${p.files.index}, config/policies.yaml, .env.example y projects/index.ts actualizados.` });

  const manifestText = read(p.files.manifest);
  if (manifestText !== null) {
    const problems: string[] = [];
    try {
      const m = parse(manifestText) ?? {};
      if (m.id !== p.agentId) problems.push(`id debe ser ${p.agentId}`);
      if (m.project !== p.projectId) problems.push(`project debe ser ${p.projectId}`);
      if (!['fast', 'reasoning'].includes(m.tier)) problems.push('tier debe ser fast o reasoning');
      const tools: string[] = Array.isArray(m.tools) ? m.tools : [];
      const expected = p.tools.map((t) => t.name);
      const extra = tools.filter((t) => !expected.includes(t));
      const absent = expected.filter((t) => !tools.includes(t));
      if (extra.length) problems.push(`herramientas desconocidas: ${extra.join(', ')}`);
      if (absent.length) problems.push(`faltan herramientas: ${absent.join(', ')}`);
      if (!(Number(m.budget?.usd_per_case) > 0)) problems.push('budget.usd_per_case obligatorio');
    } catch (err) {
      problems.push(`YAML no válido: ${(err as Error).message}`);
    }
    steps.push({ name: 'Manifiesto', ok: problems.length === 0, output: problems.join('; ') || 'Correcto.' });
  }

  const prompt = read(p.files.prompt);
  if (prompt !== null) {
    steps.push({ name: 'Prompt', ok: prompt.trim().length >= 200, output: prompt.trim().length >= 200 ? `${prompt.trim().length} caracteres.` : 'Demasiado corto (mínimo 200 caracteres).' });
  }

  const toolsText = read(p.files.tools);
  if (toolsText !== null) {
    const imports = [...toolsText.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const bad = [...imports.filter((i) => !ALLOWED_IMPORTS.has(i)).map((i) => `import de ${i}`), ...FORBIDDEN.filter(([re]) => re.test(toolsText)).map(([, l]) => l)];
    steps.push({ name: 'Seguridad', ok: bad.length === 0, output: bad.length ? `No permitido: ${bad.join(', ')}` : 'Solo usa los conectores de la plataforma.' });

    if (bad.length === 0) {
      try {
        const { stdout } = await run(process.execPath, ['--import', 'tsx', join(platform.rootDir, 'projects/plataforma/load-check.ts'), join(dir, p.files.index)], {
          cwd: platform.rootDir,
          env: childEnv(),
          timeout: 30_000,
        });
        const loaded = JSON.parse(stdout.trim().split('\n').pop()!) as { tools: { name: string; risk: string; description: string; hasHandler: boolean }[] };
        const problems: string[] = [];
        for (const t of p.tools) {
          const found = loaded.tools.find((x) => x.name === t.name);
          if (!found) problems.push(`falta ${t.name}`);
          else if (found.risk !== t.risk) problems.push(`${t.name}: risk debe ser '${t.risk}'`);
        }
        const extra = loaded.tools.filter((x) => !p.tools.some((t) => t.name === x.name)).map((x) => x.name);
        if (extra.length) problems.push(`herramientas no previstas: ${extra.join(', ')}`);
        steps.push({ name: 'Carga', ok: problems.length === 0, output: problems.join('; ') || `${loaded.tools.length} herramientas cargadas con su riesgo correcto.` });
      } catch (err) {
        const e = err as { stderr?: string; message: string };
        steps.push({ name: 'Carga', ok: false, output: clean((e.stderr || e.message).split('\n').slice(0, 12).join('\n')) });
      }
    }
  }

  const result = { ok: steps.every((s) => s.ok), steps };
  const state = getState(platform);
  state.validations[request.id] = result;
  saveState(platform, state);
  return result;
}

const validateTool: ToolDefinition = {
  name: 'plataforma_validate',
  project: PROJECT_ID,
  description:
    'Añade la fontanería (index.ts del proyecto, políticas, .env.example, registro) y valida la rama: ficheros, manifiesto, ' +
    'prompt, seguridad de las herramientas y que cargan con los nombres y riesgos fijados. Si algo falla, corrige y vuelve a validar.',
  risk: 'read',
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, { platform, caseId }) {
    const result = await validate(platform, caseId);
    const lines = result.steps.map((s) => `${s.ok ? 'OK ' : 'ERR'} ${s.name}: ${s.output}`);
    return { ok: result.ok, content: `${result.ok ? 'Validación correcta.' : 'La validación falla.'}\n${lines.join('\n')}`, data: result };
  },
};

// ── 4. Abrir el PR ────────────────────────────────────────────────────────

const openPr: ToolDefinition<{ title: string; body: string }> = {
  name: 'plataforma_open_pr',
  project: PROJECT_ID,
  description: 'Hace commit de la rama del agente y abre el PR contra la rama base. Exige la última validación correcta.',
  risk: 'write_internal',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título del PR, p. ej. "Nuevo agente: Pedidos del obrador".' },
      body: { type: 'string', description: 'Descripción en texto plano: qué hace el agente, herramientas y qué hay que configurar.' },
    },
    required: ['title', 'body'],
  },
  describe: (input) => `Abrir PR: ${input.title}`,
  async handler(input, { platform, caseId }) {
    const { request, plan: p, dir } = context(platform, caseId);
    const state = getState(platform);
    if (request.prId) return fail(`Ya hay un PR abierto para esta solicitud: ${request.prId}.`);
    if (!state.validations[request.id]?.ok) return fail('Antes de abrir el PR, plataforma_validate tiene que salir correcta.');
    const validation = state.validations[request.id];
    const base = await baseBranch(platform);
    const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', `${input.title}\n\nSolicitud ${request.id}, caso ${request.caseId}. Generado por el agente creador.`]);
    const files = (await git(dir, ['diff', '--name-status', 'HEAD~1', 'HEAD']))
      .split('\n')
      .filter(Boolean)
      .map((l) => ({ path: l.split('\t')[1], status: (l.startsWith('A') ? 'added' : 'modified') as 'added' | 'modified' }));
    const diff = (await git(dir, ['diff', 'HEAD~1', 'HEAD'])).slice(0, 200_000);

    const pr: AgentPr = {
      id: `APR-${String(state.prs.length + 1).padStart(3, '0')}`,
      requestId: request.id,
      title: input.title,
      branch,
      agentId: p.agentId,
      caseId,
      status: 'open',
      createdAt: new Date().toISOString(),
      files,
      diff,
      validation,
      envVars: p.envVars,
    };

    const target = await githubTarget(repoDir(platform));
    if (target) {
      try {
        await pushBranch(dir, branch, target);
        const body =
          `${input.body}\n\n` +
          `Validación de la plataforma:\n${validation.steps.map((s) => `- ${s.ok ? '✅' : '❌'} ${s.name}: ${s.output}`).join('\n')}\n\n` +
          (p.envVars.length ? `Variables a configurar en .env: ${p.envVars.map((v) => `\`${v}\``).join(', ')}\n\n` : '') +
          `Se fusiona a mano: revísalo y pulsa Merge. La plataforma lo detecta y activa el agente sin reiniciar.\n\nSolicitud ${request.id} · caso ${request.caseId}\n\n🤖 Generado por el agente creador de la plataforma`;
        const { data } = await octokit(target).pulls.create({ owner: target.owner, repo: target.repo, title: input.title, head: branch, base, body });
        pr.github = { number: data.number, url: data.html_url };
      } catch (err) {
        return fail(`No se pudo abrir el PR en GitHub: ${clean((err as Error).message)}`);
      }
    }
    state.prs.push(pr);
    saveState(platform, state);
    updateRequest(platform, request.id, { status: 'pr_open', prId: pr.id });
    return {
      ok: true,
      content:
        `PR ${pr.id} abierto${pr.github ? ` en GitHub (#${pr.github.number}, ${pr.github.url})` : ' en local'}: ${files.length} ficheros en ${branch} contra ${base}. ` +
        'Lo revisa y lo fusiona una persona; la plataforma activa el agente al detectar la fusión.',
      data: { prId: pr.id, github: pr.github },
    };
  },
};

// ── 5. Fusión manual en GitHub: detección y activación ───────────────────

async function activate(platform: PlatformApi, pr: AgentPr): Promise<AgentPr['activation']> {
  const repo = repoDir(platform);
  const index = join(repo, `projects/${pr.agentId.replace(/-/g, '_')}/index.ts`);
  if (repo !== platform.rootDir) return { state: 'restart_required', detail: 'El creador trabaja sobre una copia del repositorio.' };
  if (!existsSync(index)) return { state: 'restart_required', detail: 'El código aún no está en la copia local; actualiza y reinicia.' };
  try {
    platform.manifests.reload();
    const mod = await import(pathToFileURL(index).href);
    const project = mod.default ?? Object.values(mod)[0];
    if (!platform.projects.get(project.id)) await platform.projects.register(project);
    const planned = plan(getState(platform).specs[pr.requestId]);
    for (const t of planned.tools) platform.policy.setActionLevel(t.name, t.level);
    platform.projects.changed(project.id);
    return { state: 'active', detail: 'Cargado en caliente, sin reiniciar.' };
  } catch (err) {
    return { state: 'restart_required', detail: clean((err as Error).message) };
  }
}

/**
 * Cierre de un PR que una persona ha fusionado (en GitHub, o a mano en local): trae el código a
 * esta copia (solo avance rápido) y activa el agente sin reiniciar. Idempotente.
 */
export async function completeMerge(platform: PlatformApi, prId: string): Promise<AgentPr | undefined> {
  const state = getState(platform);
  const pr = state.prs.find((x) => x.id === prId);
  if (!pr || pr.status !== 'open') return pr;
  const repo = repoDir(platform);
  const base = await baseBranch(platform);
  let note = '';
  try {
    const target = pr.github ? await githubTarget(repo) : null;
    const current = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (current !== base) note = `La copia local está en ${current}, no en ${base}.`;
    else if (target) await git(repo, ['pull', '--ff-only', '--no-rebase', 'origin', base], authEnv(target.token));
    else await git(repo, ['merge', '--no-edit', pr.branch]);
  } catch (err) {
    note = `No se pudo actualizar la copia local: ${clean((err as Error).message)}`;
  }
  pr.status = 'merged';
  pr.mergedAt = new Date().toISOString();
  pr.activation = note ? { state: 'restart_required', detail: note } : await activate(platform, pr);
  saveState(platform, state);
  updateRequest(platform, pr.requestId, { status: pr.activation?.state === 'active' ? 'active' : 'merged' });
  if (platform.cases.get(pr.caseId)) {
    platform.cases.addTimeline(pr.caseId, {
      kind: 'note',
      actor: 'human',
      title: `${pr.id}${pr.github ? ` (#${pr.github.number})` : ''} fusionado por una persona`,
      detail: pr.activation?.state === 'active' ? 'Agente activo sin reiniciar.' : `Pendiente de reinicio: ${pr.activation?.detail}`,
    });
  }
  rmSync(worktreeDir(platform, pr.requestId), { recursive: true, force: true });
  await git(repo, ['worktree', 'prune']).catch(() => undefined);
  return pr;
}

/** Un sondeo de los PR abiertos en GitHub. Devuelve si queda alguno abierto. */
export async function syncAgentPrs(platform: PlatformApi): Promise<boolean> {
  const open = getState(platform).prs.filter((pr) => pr.status === 'open' && pr.github);
  if (!open.length) return false;
  const target = await githubTarget(repoDir(platform));
  if (!target) return false;
  for (const pr of open) {
    try {
      const { data } = await octokit(target).pulls.get({ owner: target.owner, repo: target.repo, pull_number: pr.github!.number });
      if (data.merged) await completeMerge(platform, pr.id);
      else if (data.state === 'closed') {
        const state = getState(platform);
        const current = state.prs.find((x) => x.id === pr.id);
        if (current) current.status = 'closed';
        saveState(platform, state);
        updateRequest(platform, pr.requestId, { status: 'closed' });
      }
    } catch (err) {
      console.warn(`[plataforma] No se puede consultar ${pr.id} en GitHub: ${clean((err as Error).message)}`);
    }
  }
  return getState(platform).prs.some((pr) => pr.status === 'open' && pr.github);
}

export const plataformaTools: ToolDefinition[] = [getRequest, writeFile, validateTool, openPr];
export { AGENT_ID };
