/**
 * Herramientas del agente de código sobre el repositorio real de terminal-pagos.
 * Las de lectura no cambian nada; las de código crean ramas, PRs y fusiones.
 * Con GitHub conectado (github.ts), además suben las ramas, abren el PR y fusionan allí.
 */
import type { PlatformApi, ToolDefinition, ToolResult } from '../../platform/contracts.ts';
import { describeGitHubError, linkFor, PR_MARKER } from './github.ts';
import { repoFor, TEST_COMMAND, type TerminalRepo, type TestRun } from './repo.ts';
import {
  COMPONENT,
  PROJECT_ID,
  bumpPatch,
  clip,
  getState,
  saveState,
  type GitHubPullRequest,
  type PullRequest,
  type TestSummary,
} from './state.ts';

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const MAX_FILES_PER_FIX = 20;

function fail(content: string, data?: unknown): ToolResult {
  return { ok: false, content, data };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function branchProblem(branch: string): string | null {
  const invalid =
    !BRANCH_PATTERN.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock');
  if (invalid) return `Nombre de rama no válido: "${branch}". Usa algo como fix/descripcion-corta.`;
  if (branch === 'main') return 'No se escribe directamente en main: trabaja en una rama fix/…';
  return null;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function testLine(run: TestSummary): string {
  return `${run.passed} ${plural(run.passed, 'pasa', 'pasan')}, ${run.failed} ${plural(run.failed, 'falla', 'fallan')}`;
}

function describeTestRun(branch: string, run: TestRun): string {
  const lines = [`Tests en ${branch} (${TEST_COMMAND}): ${testLine(run)}.`];
  if (run.failures.length) lines.push(`Tests que fallan: ${run.failures.map((name) => `«${name}»`).join(', ')}.`);
  lines.push('', 'Salida:', clip(run.output, 3500));
  return lines.join('\n');
}

const toSummary = (run: TestRun): TestSummary => ({ passed: run.passed, failed: run.failed, output: run.output });

function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

function linkCaseToPr(platform: PlatformApi, caseId: string, prId: string): void {
  const found = platform.cases.get(caseId);
  if (found) platform.cases.update(caseId, { data: { ...found.data, prId } });
}

/**
 * Deja en la rama un commit que sube la versión de parche respecto a main, para que fusionar sea
 * publicar. Si la rama ya lleva otra versión (commit anterior o cambio del agente), no hace nada.
 */
async function ensureReleaseCommit(repo: TerminalRepo, branch: string): Promise<string | null> {
  const mainVersion = await repo.readVersion();
  return repo.onBranch(branch, async () => {
    if ((await repo.readVersion()) !== mainVersion) return null;
    const next = bumpPatch(mainVersion);
    await repo.writeVersion(next);
    await repo.git(['add', 'package.json']);
    await repo.git(['commit', '-q', '-m', `release: ${COMPONENT} ${next}`]);
    return next;
  });
}

/** Cuerpo del PR en GitHub: descripción del agente, tests en local y la marca de la demo. */
function pullBody(description: string, before: TestSummary, after: TestSummary, branch: string): string {
  return [
    description,
    '',
    '---',
    '',
    `**Tests en local** · \`main\`: ${testLine(before)} → \`${branch}\`: ${testLine(after)}.`,
    '',
    '_Abierto por el agente de código de la demo. «Reiniciar demo» cierra este PR y borra su rama._',
    '',
    PR_MARKER,
  ].join('\n');
}

const listFiles: ToolDefinition<Record<string, never>> = {
  name: 'bugs_list_files',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Lista los ficheros del repositorio terminal-pagos (rama main) con su número de líneas. No incluye .git ni node_modules.',
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, { platform }) {
    const repo = repoFor(platform);
    const files = await repo.exclusive(() => repo.listFiles());
    return {
      ok: true,
      content: `Repositorio ${COMPONENT} (main), ${files.length} ficheros:\n${files
        .map((file) => `- ${file.path} (${file.lines} líneas)`)
        .join('\n')}`,
      data: { files },
    };
  },
};

const readFileTool: ToolDefinition<{ path: string }> = {
  name: 'bugs_read_file',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Lee un fichero del repositorio terminal-pagos en la rama main y lo devuelve con números de línea. ' +
    '`path` es relativo a la raíz del repositorio (por ejemplo, src/terminal.ts). Rechaza rutas fuera del repositorio.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Ruta relativa a la raíz del repositorio.' } },
    required: ['path'],
  },
  async handler(input, { platform }) {
    const repo = repoFor(platform);
    try {
      const relative = repo.relative(input?.path);
      const content = await repo.exclusive(() => repo.readText(relative));
      const lines = content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const width = String(lines.length).length;
      const numbered = lines.map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`).join('\n');
      return {
        ok: true,
        content: `${relative} (${lines.length} líneas, rama main):\n${numbered}`,
        data: { path: relative, content },
      };
    } catch (error) {
      return fail((error as Error).message);
    }
  },
};

const searchCode: ToolDefinition<{ query: string }> = {
  name: 'bugs_search_code',
  project: PROJECT_ID,
  risk: 'read',
  description:
    'Busca un texto (sin distinguir mayúsculas) en todos los ficheros del repositorio terminal-pagos en main y ' +
    'devuelve las líneas que lo contienen como fichero:línea. Sirve para localizar dónde se gestiona un síntoma.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Texto literal a buscar, por ejemplo "timeout".' } },
    required: ['query'],
  },
  async handler(input, { platform }) {
    const query = text(input?.query);
    if (query.length < 2) return fail('La búsqueda necesita al menos 2 caracteres.');
    const repo = repoFor(platform);
    const { matches, truncated } = await repo.exclusive(() => repo.search(query));
    if (!matches.length) {
      return { ok: true, content: `Sin coincidencias para «${query}» en ${COMPONENT}.`, data: { query, matches } };
    }
    const lines = matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
    return {
      ok: true,
      content:
        `${matches.length} coincidencias para «${query}»${truncated ? ' (mostrando las primeras)' : ''}:\n` +
        lines.join('\n'),
      data: { query, matches, truncated },
    };
  },
};

const runTests: ToolDefinition<{ branch?: string }> = {
  name: 'bugs_run_tests',
  project: PROJECT_ID,
  risk: 'read',
  description:
    `Ejecuta los tests de terminal-pagos (${TEST_COMMAND}) en main o en la rama indicada y devuelve cuántos ` +
    'pasan, cuántos fallan, qué tests fallan y la salida. Úsala para reproducir un bug antes de tocar código y ' +
    'para comprobar un arreglo antes de abrir un PR.',
  inputSchema: {
    type: 'object',
    properties: { branch: { type: 'string', description: 'Rama sobre la que ejecutar los tests. Por defecto, main.' } },
  },
  async handler(input, { platform }) {
    const branch = text(input?.branch) || 'main';
    const repo = repoFor(platform);
    return repo.exclusive(async () => {
      if (branch !== 'main' && (branchProblem(branch) || !(await repo.branchExists(branch)))) {
        return fail(`La rama "${branch}" no existe. Ramas disponibles: ${(await repo.branches()).join(', ')}.`);
      }
      const run = await repo.onBranch(branch, () => repo.runTests());
      return { ok: true, content: describeTestRun(branch, run), data: { branch, ...run } };
    });
  },
};

interface ProposeFixInput {
  branch: string;
  files: { path: string; content: string }[];
  commitMessage: string;
}

const proposeFix: ToolDefinition<ProposeFixInput> = {
  name: 'bugs_propose_fix',
  project: PROJECT_ID,
  risk: 'code',
  description:
    'Crea una rama desde main (o añade un commit si la rama ya existe), escribe el contenido COMPLETO de cada ' +
    'fichero indicado y hace commit. Nunca toca main. Devuelve el diff acumulado de la rama contra main. ' +
    'Si hay un repositorio de GitHub conectado, sube también la rama. ' +
    'Cambia solo lo imprescindible para arreglar el bug.',
  inputSchema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Nombre de la rama, por ejemplo fix/terminal-timeout.' },
      files: {
        type: 'array',
        description: 'Ficheros a escribir, cada uno con su contenido completo final.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta relativa a la raíz del repositorio.' },
            content: { type: 'string', description: 'Contenido completo del fichero.' },
          },
          required: ['path', 'content'],
        },
      },
      commitMessage: { type: 'string', description: 'Mensaje de commit: primera línea corta y explicación del porqué.' },
    },
    required: ['branch', 'files', 'commitMessage'],
  },
  describe(input) {
    const paths = Array.isArray(input?.files) ? input.files.map((file) => file?.path).join(', ') : '';
    return `Crear commit en la rama ${input?.branch} (${paths})`;
  },
  async handler(input, { platform }) {
    const branch = text(input?.branch);
    const problem = branchProblem(branch);
    if (problem) return fail(problem);
    const files = Array.isArray(input?.files) ? input.files : [];
    if (!files.length) return fail('Indica al menos un fichero con su contenido completo.');
    if (files.length > MAX_FILES_PER_FIX) return fail(`Demasiados ficheros (${files.length}); un arreglo mínimo no debería tocar tantos.`);
    if (files.some((file) => typeof file?.path !== 'string' || typeof file?.content !== 'string')) {
      return fail('Cada fichero necesita "path" y "content" como texto.');
    }
    const commitMessage = text(input?.commitMessage);
    if (!commitMessage) return fail('Falta commitMessage.');

    const repo = repoFor(platform);
    return repo.exclusive(async () => {
      let normalized: { path: string; content: string }[];
      try {
        normalized = files.map((file) => ({ path: repo.relative(file.path), content: file.content }));
      } catch (error) {
        return fail((error as Error).message);
      }
      const paths = normalized.map((file) => file.path);

      const existed = await repo.branchExists(branch);
      if (!existed) await repo.git(['branch', branch, 'main']);

      let commit: string | null;
      try {
        commit = await repo.onBranch(branch, async () => {
          await repo.writeFiles(normalized);
          await repo.git(['add', '-A', '--', ...paths]);
          const status = await repo.git(['status', '--porcelain']);
          if (!status.stdout.trim()) return null;
          await repo.git(['commit', '-q', '-m', commitMessage]);
          return repo.headCommit();
        });
      } catch (error) {
        if (!existed) await repo.git(['branch', '-q', '-D', branch], { allowFailure: true });
        throw error;
      }

      if (!commit && !existed) {
        await repo.git(['branch', '-q', '-D', branch]);
        return fail('Los ficheros propuestos son idénticos a main: no hay nada que cambiar.');
      }

      const diff = await repo.diff(branch);
      saveState(platform, { branches: await repo.branches() });
      const { added, removed } = diffStats(diff);
      const headline = commit
        ? `Commit ${commit} en la rama ${branch} (${existed ? 'rama existente' : 'nueva, creada desde main'}): ${paths.join(', ')}.`
        : `La rama ${branch} ya contenía exactamente estos cambios; no hay commit nuevo.`;

      const link = linkFor(platform);
      let pushed = '';
      if (link.mode === 'github') {
        try {
          await link.pushBranch(repo, branch);
          pushed = `\nRama subida a GitHub (${link.settings?.repo}).`;
        } catch (error) {
          return fail(
            `${headline}\nEl commit está en local, pero no se ha podido subir la rama a GitHub: ${describeGitHubError(error)}`,
            { branch, commit, files: paths },
          );
        }
      }
      return {
        ok: true,
        content: `${headline}${pushed}\nDiff contra main: +${added} −${removed} líneas.\n\n${clip(diff, 4000)}`,
        data: { branch, commit, files: paths, diff },
      };
    });
  },
};

interface OpenPrInput {
  branch: string;
  title: string;
  description: string;
}

const openPr: ToolDefinition<OpenPrInput> = {
  name: 'bugs_open_pr',
  project: PROJECT_ID,
  risk: 'code',
  description:
    'Abre un pull request de la rama hacia main: ejecuta los tests en main y en la rama, añade a la rama un commit ' +
    'que sube la versión de parche (así fusionar es publicar), calcula el diff y registra el PR. Si hay un ' +
    'repositorio de GitHub conectado, sube la rama y abre allí el PR. Si en la rama falla algún test, el PR no se ' +
    'abre. La descripción debe explicar diagnóstico, causa raíz, arreglo y resultado de los tests antes y después.',
  inputSchema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Rama con el arreglo.' },
      title: { type: 'string', description: 'Título corto del PR.' },
      description: { type: 'string', description: 'Descripción para quien revisa: diagnóstico, causa, arreglo y tests.' },
    },
    required: ['branch', 'title', 'description'],
  },
  describe(input) {
    return `Abrir PR «${input?.title}» desde ${input?.branch}`;
  },
  async handler(input, { platform, caseId }) {
    const branch = text(input?.branch);
    const problem = branchProblem(branch);
    if (problem) return fail(problem);
    const title = text(input?.title);
    const description = text(input?.description);
    if (!title) return fail('Falta el título del PR.');
    if (!description) return fail('Falta la descripción del PR: explica diagnóstico, causa raíz y arreglo.');

    const repo = repoFor(platform);
    const link = linkFor(platform);
    const result = await repo.exclusive(async (): Promise<ToolResult> => {
      if (!(await repo.branchExists(branch))) {
        return fail(`La rama ${branch} no existe. Crea antes el arreglo con bugs_propose_fix.`);
      }
      const changes = await repo.diff(branch);
      if (!changes.trim()) return fail(`La rama ${branch} no tiene cambios respecto a main.`);

      const before = await repo.runTests();
      const after = await repo.onBranch(branch, () => repo.runTests());
      if (after.failed > 0) {
        return fail(
          `No se abre el PR: en la rama ${branch} ${plural(after.failed, 'falla 1 test', `fallan ${after.failed} tests`)}. ` +
            `Corrige el arreglo y vuelve a comprobarlo.\n\n${describeTestRun(branch, after)}`,
          { branch, testsAfter: toSummary(after) },
        );
      }

      const release = await ensureReleaseCommit(repo, branch);
      const diff = await repo.diff(branch);
      const headSha = await repo.sha(`refs/heads/${branch}`);
      const existing = getState(platform).prs.find((pr) => pr.branch === branch && pr.status === 'open');

      let github: GitHubPullRequest | undefined;
      if (link.mode === 'github') {
        try {
          await link.pushBranch(repo, branch);
          github = await link.openPull({
            number: existing?.github?.number,
            branch,
            title,
            body: pullBody(description, before, after, branch),
          });
        } catch (error) {
          return fail(
            `Los tests pasan en ${branch}, pero no se ha podido abrir el PR en GitHub: ${describeGitHubError(error)}`,
            { branch, testsAfter: toSummary(after) },
          );
        }
      }

      const state = getState(platform);
      const number = Math.max(state.nextPr ?? 1, state.prs.length + 1);
      const pr: PullRequest = {
        id: existing?.id ?? `PR-${number}`,
        title,
        branch,
        status: 'open',
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        caseId,
        description,
        diff,
        testsBefore: toSummary(before),
        testsAfter: toSummary(after),
        headSha,
        ...(github ? { github } : {}),
      };
      const prs = existing ? state.prs.map((item) => (item.id === pr.id ? pr : item)) : [...state.prs, pr];
      saveState(platform, { prs, branches: await repo.branches(), nextPr: existing ? number : number + 1 });
      linkCaseToPr(platform, caseId, pr.id);

      const { added, removed } = diffStats(diff);
      const version = await repo.onBranch(branch, () => repo.readVersion());
      return {
        ok: true,
        content:
          `${existing ? 'Actualizado' : 'Abierto'} ${pr.id} «${title}» (${branch} → main).\n` +
          (github ? `En GitHub: #${github.number} ${github.url} (el repositorio no tiene CI: valen los tests de aquí).\n` : '') +
          `Tests en main: ${testLine(before)}. Tests en la rama: ${testLine(after)}.\n` +
          `${release ? 'Añadido a la rama el commit de versión' : 'La rama ya incluía la versión'}: al fusionar se publica ${COMPONENT} ${version}.\n` +
          `Diff: +${added} −${removed} líneas.\n` +
          `Para fusionarlo, usa bugs_merge_pr con prId "${pr.id}".`,
        data: {
          id: pr.id,
          branch,
          title,
          status: pr.status,
          version,
          github,
          testsBefore: { passed: before.passed, failed: before.failed, failures: before.failures },
          testsAfter: { passed: after.passed, failed: after.failed },
        },
      };
    });

    if (result.ok && link.mode === 'github') link.schedule(0);
    return result;
  },
};

interface MergeOutcome {
  result: ToolResult;
  merged?: PullRequest;
  newVersion?: string;
}

const now = () => new Date().toISOString();

/** Sustituye un PR en el estado más reciente (sin await entre leer y guardar). */
function replacePr(platform: PlatformApi, pr: PullRequest, patch: Partial<Parameters<typeof saveState>[1]> = {}): void {
  saveState(platform, { ...patch, prs: getState(platform).prs.map((item) => (item.id === pr.id ? pr : item)) });
}

/** Si main no ha cambiado de versión con la fusión (PR sin commit de versión), la publica con un commit. */
async function releaseIfNeeded(repo: TerminalRepo, previousVersion: string): Promise<{ version: string; committed: boolean }> {
  const current = await repo.readVersion();
  if (current !== previousVersion) return { version: current, committed: false };
  const next = bumpPatch(previousVersion);
  await repo.writeVersion(next);
  await repo.git(['add', 'package.json']);
  await repo.git(['commit', '-q', '-m', `release: ${COMPONENT} ${next}`]);
  return { version: next, committed: true };
}

async function mergeLocally(platform: PlatformApi, repo: TerminalRepo, pr: PullRequest): Promise<MergeOutcome> {
  if (pr.status === 'merged') return { result: fail(`${pr.id} ya está fusionado.`) };
  if (!(await repo.branchExists(pr.branch))) return { result: fail(`La rama ${pr.branch} de ${pr.id} ya no existe.`) };

  await repo.checkoutMain();
  const previousVersion = await repo.readVersion();
  const merge = await repo.git(['merge', '--no-ff', '--no-edit', '-m', `Fusiona ${pr.id}: ${pr.title}`, pr.branch], {
    allowFailure: true,
  });
  if (merge.code !== 0) {
    await repo.git(['merge', '--abort'], { allowFailure: true });
    return { result: fail(`No se puede fusionar ${pr.id} automáticamente:\n${(merge.stderr || merge.stdout).trim()}`) };
  }

  const { version: newVersion } = await releaseIfNeeded(repo, previousVersion);
  const commit = await repo.headCommit();
  const merged: PullRequest = { ...pr, status: 'merged', mergedAt: now() };
  replacePr(platform, merged, { version: newVersion, branches: await repo.branches() });
  return {
    merged,
    newVersion,
    result: {
      ok: true,
      content:
        `${pr.id} fusionado en main (commit ${commit}). ${COMPONENT} pasa de ${previousVersion} a ${newVersion}; ` +
        'la nueva versión se desplegará en los datáfonos.',
      data: { prId: pr.id, branch: pr.branch, previousVersion, newVersion, commit },
    },
  };
}

async function mergeOnGitHub(platform: PlatformApi, repo: TerminalRepo, pr: PullRequest): Promise<MergeOutcome> {
  const link = linkFor(platform);
  const state = getState(platform);
  if (pr.status === 'merged') {
    return {
      result: {
        ok: true,
        content: `${pr.id}${pr.github ? ` (#${pr.github.number})` : ''} ya estaba fusionado; ${COMPONENT} está en ${state.version}.`,
        data: { prId: pr.id, branch: pr.branch, newVersion: state.version, alreadyMerged: true },
      },
    };
  }
  if (!pr.github) {
    return {
      result: fail(
        `${pr.id} no está en GitHub: se abrió sin conexión. Vuelve a abrirlo con bugs_open_pr (rama ${pr.branch}) ` +
          'para publicarlo en GitHub antes de fusionar.',
      ),
    };
  }

  const number = pr.github.number;
  const base = link.settings?.baseBranch ?? 'main';
  let previousVersion: string;
  let mergedOnGitHub: boolean;
  let headSha: string;
  try {
    const remote = await link.getPull(number);
    headSha = remote.headSha;
    if (!remote.merged && remote.state === 'closed') {
      replacePr(platform, { ...pr, status: 'closed', closedAt: now() });
      return { result: fail(`${pr.id} (#${number}) está cerrado en GitHub sin fusionar; no se fusiona.`) };
    }
    mergedOnGitHub = remote.merged;
    await repo.checkoutMain();
    previousVersion = await repo.readVersion();
    if (!remote.merged) await link.mergePull(number, { sha: pr.headSha, title: `Fusiona ${pr.id}: ${pr.title}` });
    await link.syncMain(repo);
  } catch (error) {
    return { result: fail(`No se ha podido fusionar ${pr.id} (#${number}) en GitHub: ${describeGitHubError(error)}`) };
  }

  let newVersion: string;
  try {
    const release = await releaseIfNeeded(repo, previousVersion);
    if (release.committed) await link.pushMain(repo);
    newVersion = release.version;
  } catch (error) {
    return {
      result: fail(
        `${pr.id} (#${number}) está fusionado en GitHub, pero no se ha podido publicar la versión nueva: ${describeGitHubError(error)}`,
      ),
    };
  }

  const commit = await repo.headCommit();
  const ci = await link.ciStatus(pr.headSha ?? headSha);
  const merged: PullRequest = { ...pr, status: 'merged', mergedAt: now(), github: { ...pr.github, ci } };
  replacePr(platform, merged, { version: newVersion, branches: await repo.branches() });
  return {
    merged,
    newVersion,
    result: {
      ok: true,
      content:
        `${pr.id} (#${number}) ${mergedOnGitHub ? 'ya estaba fusionado directamente en GitHub' : 'fusionado en GitHub'} ` +
        `en ${base} (commit ${commit}). ${COMPONENT} pasa de ${previousVersion} a ${newVersion}; ` +
        'la nueva versión se desplegará en los datáfonos.',
      data: { prId: pr.id, branch: pr.branch, previousVersion, newVersion, commit, github: merged.github },
    },
  };
}

/**
 * Fusiona un PR y publica la versión: en local con git, o en GitHub si está conectado (idempotente:
 * si ya está fusionado allí, solo trae main). Emite `code.fix_merged` cuando hay versión nueva.
 * La usan la herramienta `bugs_merge_pr` y el sondeo de GitHub.
 */
export async function mergePullRequest(platform: PlatformApi, prId: string): Promise<ToolResult> {
  const repo = repoFor(platform);
  const outcome = await repo.exclusive(async (): Promise<MergeOutcome> => {
    const state = getState(platform);
    const pr = state.prs.find((item) => item.id === prId);
    if (!pr) return { result: fail(`No existe el PR "${prId}". PRs: ${state.prs.map((item) => item.id).join(', ') || 'ninguno'}.`) };
    if (pr.status === 'closed') {
      return { result: fail(`${pr.id} está cerrado sin fusionar${pr.github ? ' en GitHub' : ''}; no se puede fusionar.`) };
    }
    return linkFor(platform).mode === 'github' ? mergeOnGitHub(platform, repo, pr) : mergeLocally(platform, repo, pr);
  });

  // Fuera del cerrojo: las reglas de otros proyectos pueden tardar o volver a llamar aquí.
  if (outcome.merged && outcome.newVersion) {
    await platform.rules.emit('code.fix_merged', {
      component: COMPONENT,
      prId: outcome.merged.id,
      branch: outcome.merged.branch,
      newVersion: outcome.newVersion,
    });
    platform.projects.changed(PROJECT_ID);
  }
  return outcome.result;
}

const mergePr: ToolDefinition<{ prId: string }> = {
  name: 'bugs_merge_pr',
  project: PROJECT_ID,
  risk: 'code',
  description:
    'Fusiona un PR abierto en main, publica la siguiente versión de parche de terminal-pagos y avisa a dispositivos ' +
    'para que la despliegue en los datáfonos. Con GitHub conectado, la fusión se hace en GitHub. ' +
    'Llega a producción: normalmente requiere aprobación humana.',
  inputSchema: {
    type: 'object',
    properties: { prId: { type: 'string', description: 'Identificador del PR, por ejemplo PR-1.' } },
    required: ['prId'],
  },
  describe(input, platform) {
    const state = getState(platform);
    const pr = state.prs.find((item) => item.id === input?.prId);
    return pr
      ? `Fusionar ${pr.id} «${pr.title}» y publicar ${COMPONENT} ${bumpPatch(state.version)}`
      : `Fusionar ${String(input?.prId)} en main`;
  },
  async handler(input, { platform }) {
    return mergePullRequest(platform, text(input?.prId));
  },
};

export const bugsTools: ToolDefinition[] = [listFiles, readFileTool, searchCode, runTests, proposeFix, openPr, mergePr];
