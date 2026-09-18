/**
 * Comprobación del modo GitHub del proyecto de código SIN GitHub real.
 *
 *   npx tsx projects/bugs/github-check.ts
 *
 * Monta en una carpeta temporal un repositorio git bare que hace de remoto (GITHUB_GIT_URL=file://…)
 * y un servidor HTTP local que imita solo los endpoints de la API de GitHub que usa la demo
 * (GITHUB_API_URL=http://127.0.0.1:<puerto>); las fusiones se aplican sobre el bare con git.
 * Recorre: arranque con repo vacío, PR del agente, fusión aprobada en la consola, fusión y cierre
 * hechos «desde GitHub», reinicio, repo ajeno (sin marcador), token inválido, remoto de git distinto
 * del repositorio de la API, API por http hacia otra máquina y que el token no aparezca en ningún
 * sitio. Borra sus temporales al terminar.
 *
 * La carpeta temporal sale de GITHUB_CHECK_TMPDIR o, si no está, del directorio temporal del sistema.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DomainEvent, PlatformApi, PlatformEvent } from '../../platform/contracts.ts';
import { createPlatform } from '../../platform/index.ts';
import { describeGitHubError, gitAuthEnv, MARKER_FILE, PR_MARKER } from './github.ts';
import { bugs } from './index.ts';
import { setGitObserver, type GitRun } from './repo.ts';
import type { BugsState } from './state.ts';
import { syncGitHub } from './sync.ts';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const tmpRoot = mkdtempSync(join(process.env.GITHUB_CHECK_TMPDIR || tmpdir(), 'agentes-github-check-'));

const TOKEN = 'centinela-7f3a9c2e5b1d-token-que-no-debe-salir';
const WRONG_TOKEN = 'centinela-otro-4c8e1a-token-invalido';
const OWNER = 'demo-owner';
const NAME = 'terminal-pagos-demo';
const REPO = `${OWNER}/${NAME}`;
const BRANCH = 'fix/terminal-libera-tras-timeout';

// ─────────────────────────────────────────────────────────────
// Arnés
// ─────────────────────────────────────────────────────────────

let failures = 0;
function check(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  OK     ${label}`);
  } else {
    failures++;
    console.log(`  FALLO  ${label}${detail === undefined ? '' : `\n         ${JSON.stringify(detail)}`}`);
  }
}

/** Todo lo que sale por consola, para buscar el token al final. */
const captured: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    captured.push(String(chunk));
    return write(chunk, ...rest);
  }) as typeof stream.write;
}

const gitRuns: GitRun[] = [];
setGitObserver((run) => gitRuns.push(run));

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'GitHub',
      GIT_AUTHOR_EMAIL: 'noreply@github.test',
      GIT_COMMITTER_NAME: 'GitHub',
      GIT_COMMITTER_EMAIL: 'noreply@github.test',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

const bareVersion = (bare: string, ref = 'main') =>
  (JSON.parse(tryGit(bare, ['show', `${ref}:package.json`]) ?? '{}') as { version?: string }).version;
const refsOf = (bare: string) => tryGit(bare, ['for-each-ref', '--format=%(refname) %(objectname)']) ?? '';

// ─────────────────────────────────────────────────────────────
// API de GitHub falsa
// ─────────────────────────────────────────────────────────────

interface FakePull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: 'open' | 'closed';
  merged: boolean;
  headSha: string;
  mergeSha?: string;
}

const fake = {
  bare: '',
  pulls: [] as FakePull[],
  requests: [] as { method: string; path: string; authorization: string }[],
  /** Ejecuciones de CI del repositorio. Vacío (lo normal): no hay CI, porque la demo no la añade. */
  ciRuns: [] as { status: string; conclusion: string | null }[],
  /** Como un token fine-grained sin permiso de Checks: los check runs dan 403 y hay que mirar Actions. */
  checksDenied: false,
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, any>) : {};
}

function pullJson(pull: FakePull) {
  const current = pull.state === 'open' ? tryGit(fake.bare, ['rev-parse', '--verify', `refs/heads/${pull.head}`]) : undefined;
  return {
    number: pull.number,
    html_url: `https://github.com/${REPO}/pull/${pull.number}`,
    state: pull.state,
    merged: pull.merged,
    merged_at: pull.merged ? new Date().toISOString() : null,
    title: pull.title,
    body: pull.body,
    head: { ref: pull.head, sha: current ?? pull.headSha, repo: { full_name: REPO } },
    base: { ref: pull.base },
    merge_commit_sha: pull.mergeSha ?? null,
  };
}

/** Fusión con commit de merge sobre el bare, como haría GitHub. */
function mergeInBare(pull: FakePull, title: string): string {
  const baseSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.base}`]);
  const tree = git(fake.bare, ['merge-tree', '--write-tree', baseSha, pull.headSha]);
  const commit = git(fake.bare, ['commit-tree', tree, '-p', baseSha, '-p', pull.headSha, '-m', title]);
  git(fake.bare, ['update-ref', `refs/heads/${pull.base}`, commit, baseSha]);
  pull.merged = true;
  pull.state = 'closed';
  pull.mergeSha = commit;
  return commit;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const authorization = String(req.headers.authorization ?? '');
  fake.requests.push({ method: req.method ?? 'GET', path: url.pathname, authorization });
  if (authorization !== `token ${TOKEN}`) return send(res, 401, { message: 'Bad credentials' });

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'repos' || parts[1] !== OWNER || parts[2] !== NAME) return send(res, 404, { message: 'Not Found' });
  const rest = parts.slice(3);
  const method = req.method ?? 'GET';

  try {
    if (rest.length === 0 && method === 'GET') {
      return send(res, 200, {
        name: NAME,
        full_name: REPO,
        html_url: `https://github.com/${REPO}`,
        archived: false,
        default_branch: 'main',
        permissions: { admin: false, push: true, pull: true },
      });
    }

    if (rest[0] === 'contents' && method === 'GET') {
      // Como GitHub: `ref` puede ser una rama o el SHA de un commit (que tiene que existir en ESTE repositorio).
      const ref = url.searchParams.get('ref') ?? 'main';
      const path = rest.slice(1).join('/');
      const object = /^[0-9a-f]{40}$/.test(ref) ? ref : `refs/heads/${ref}`;
      const content = tryGit(fake.bare, ['show', `${object}:${path}`]);
      if (content === undefined) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { type: 'file', name: path, path, encoding: 'base64', content: Buffer.from(content).toString('base64') });
    }

    if (rest[0] === 'pulls' && rest.length === 1 && method === 'GET') {
      const state = url.searchParams.get('state') ?? 'open';
      const head = url.searchParams.get('head');
      const list = fake.pulls
        .filter((pull) => state === 'all' || pull.state === state)
        .filter((pull) => !head || `${OWNER}:${pull.head}` === head)
        .sort((a, b) => b.number - a.number)
        .map(pullJson);
      return send(res, 200, list);
    }

    if (rest[0] === 'pulls' && rest.length === 1 && method === 'POST') {
      const body = await readJson(req);
      const headSha = tryGit(fake.bare, ['rev-parse', '--verify', `refs/heads/${body.head}`]);
      if (!headSha) return send(res, 422, { message: 'Validation Failed', errors: [{ field: 'head', code: 'invalid' }] });
      if (fake.pulls.some((pull) => pull.state === 'open' && pull.head === body.head)) {
        return send(res, 422, { message: `Validation Failed: A pull request already exists for ${OWNER}:${body.head}.` });
      }
      const pull: FakePull = {
        number: fake.pulls.length + 1,
        title: String(body.title),
        body: String(body.body ?? ''),
        head: String(body.head),
        base: String(body.base),
        state: 'open',
        merged: false,
        headSha,
      };
      fake.pulls.push(pull);
      return send(res, 201, pullJson(pull));
    }

    const pull = rest[0] === 'pulls' ? fake.pulls.find((item) => item.number === Number(rest[1])) : undefined;
    if (rest[0] === 'pulls' && !pull) return send(res, 404, { message: 'Not Found' });

    if (pull && rest.length === 2 && method === 'GET') {
      if (pull.state === 'open') pull.headSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.head}`]);
      return send(res, 200, pullJson(pull));
    }

    if (pull && rest.length === 2 && method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.title === 'string') pull.title = body.title;
      if (typeof body.body === 'string') pull.body = body.body;
      if (body.state === 'closed' && !pull.merged) pull.state = 'closed';
      if (pull.state === 'open') pull.headSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.head}`]);
      return send(res, 200, pullJson(pull));
    }

    if (pull && rest[2] === 'merge' && method === 'PUT') {
      const body = await readJson(req);
      if (pull.state !== 'open') return send(res, 405, { message: 'Pull Request is not mergeable' });
      pull.headSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.head}`]);
      if (body.sha && body.sha !== pull.headSha) {
        return send(res, 409, { message: 'Head branch was modified. Review and try the merge again.' });
      }
      const sha = mergeInBare(pull, String(body.commit_title ?? `Merge pull request #${pull.number}`));
      return send(res, 200, { sha, merged: true, message: 'Pull Request successfully merged' });
    }

    if (rest[0] === 'commits' && rest[2] === 'check-runs' && method === 'GET') {
      // Lo normal: el token puede leer los check runs. Sin CI en el repositorio, la lista viene vacía.
      if (fake.checksDenied) return send(res, 403, { message: 'Resource not accessible by personal access token' });
      return send(res, 200, {
        total_count: fake.ciRuns.length,
        check_runs: fake.ciRuns.map((run, index) => ({ id: index + 1, head_sha: rest[1], ...run })),
      });
    }

    if (rest[0] === 'actions' && rest[1] === 'runs' && method === 'GET') {
      const sha = url.searchParams.get('head_sha');
      return send(res, 200, {
        total_count: fake.ciRuns.length,
        workflow_runs: fake.ciRuns.map((run, index) => ({ id: index + 1, head_sha: sha, ...run })),
      });
    }

    return send(res, 404, { message: `Not Found (${method} ${url.pathname})` });
  } catch (error) {
    return send(res, 500, { message: String(error) });
  }
});

// ─────────────────────────────────────────────────────────────
// Recorrido
// ─────────────────────────────────────────────────────────────

const platforms: PlatformApi[] = [];
const events: PlatformEvent[] = [];
const snapshots: unknown[] = [];

type Snapshot = BugsState & {
  repoPath: string;
  mode: 'local' | 'github';
  remote?: { repo: string; url: string };
  warning?: string;
};

async function startPlatform(
  name: string,
  options: { persist?: boolean } = {},
): Promise<{ platform: PlatformApi; dataDir: string; snapshot: () => Snapshot }> {
  const dataDir = join(tmpRoot, name);
  const platform = await createPlatform({ rootDir, dataDir, provider: 'mock', fast: true, inMemory: !options.persist });
  platforms.push(platform);
  platform.events.on((event) => events.push(event));
  await platform.projects.register(bugs);
  const snapshot = () => {
    const value = bugs.snapshot!(platform) as Snapshot;
    snapshots.push(value);
    return value;
  };
  return { platform, dataDir, snapshot };
}

function domainEvents(name: string): DomainEvent[] {
  return events.flatMap((event) => (event.type === 'domain' && event.event.name === name ? [event.event] : []));
}

async function runScenario(platform: PlatformApi): Promise<string> {
  const { caseIds } = await platform.projects.runScenario('bugs-analizar');
  await platform.runtime.idle();
  return caseIds?.[0] ?? '';
}

function pendingMerge(platform: PlatformApi, caseId: string) {
  return platform.approvals.list({ caseId, status: 'pending' }).find((approval) => approval.tool === 'bugs_merge_pr');
}

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;

const bare = join(tmpRoot, 'remote.git');
git(tmpRoot, ['init', '-q', '--bare', '-b', 'main', bare]);
fake.bare = bare;

process.env.DEMO_GITHUB = 'on';
process.env.GITHUB_TOKEN = TOKEN;
process.env.GITHUB_REPO = REPO;
process.env.GITHUB_BASE_BRANCH = 'main';
process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;
process.env.GITHUB_GIT_URL = pathToFileURL(bare).href;

const localConfigs: string[] = [];

try {
  // 1 ─────────────────────────────────────────────────────────
  console.log('\n1. Repositorio vacío: arranque en modo GitHub');
  const { platform, dataDir, snapshot } = await startPlatform('data-github');
  const localRepo = join(dataDir, 'repos', 'terminal-pagos');
  const first = snapshot();
  check(first.mode === 'github' && !first.warning, 'modo github sin aviso', { mode: first.mode, warning: first.warning });
  check(first.remote?.repo === REPO && first.remote.url === `https://github.com/${REPO}`, 'remote con repo y URL', first.remote);
  check(tryGit(bare, ['cat-file', '-e', `main:${MARKER_FILE}`]) !== undefined, `main del bare tiene ${MARKER_FILE}`);
  const bareTree = (tryGit(bare, ['ls-tree', '-r', '--name-only', 'main']) ?? '').split('\n').filter(Boolean);
  check(!bareTree.some((path) => path.startsWith('.github/')), 'la demo no sube ningún workflow a .github/', bareTree);
  check(bareTree.includes('package.json') && bareTree.includes('test/terminal.test.ts'), 'la plantilla subida conserva los tests', bareTree);
  check(bareVersion(bare) === '2.14.2', 'main del bare en 2.14.2', bareVersion(bare));
  check(git(localRepo, ['rev-parse', 'main']) === git(bare, ['rev-parse', 'main']), 'main local y remoto en el mismo commit');
  const localConfig = readFileSync(join(localRepo, '.git', 'config'), 'utf8');
  localConfigs.push(localConfig);
  check(localConfig.includes(pathToFileURL(bare).href), '.git/config apunta al remoto sin credenciales');
  check(fake.requests.some((r) => r.authorization === `token ${TOKEN}`), 'la API recibe el token en la cabecera');

  // 2 ─────────────────────────────────────────────────────────
  console.log('\n2. Escenario bugs-analizar en modo GitHub');
  const caseId = await runScenario(platform);
  const pr = snapshot().prs[0];
  check(pr?.status === 'open' && pr.github?.number === 1, 'PR abierto con número de GitHub', pr?.github);
  check(pr?.github?.url === `https://github.com/${REPO}/pull/1`, 'PR con URL de GitHub', pr?.github?.url);
  check(fake.pulls[0]?.body.includes(PR_MARKER) && fake.pulls[0].head === BRANCH, 'PR en la API falsa con la marca de la demo', fake.pulls[0]?.head);
  check(git(bare, ['rev-parse', `refs/heads/${BRANCH}`]) === pr?.headSha, 'la rama está en el bare en el commit revisado');
  check(bareVersion(bare, BRANCH) === '2.14.3', 'la rama del PR lleva el commit de versión 2.14.3', bareVersion(bare, BRANCH));
  check(pr?.testsBefore.failed === 1 && pr.testsAfter.failed === 0, 'tests antes 1 fallo, después 0', [pr?.testsBefore.failed, pr?.testsAfter.failed]);
  check(pendingMerge(platform, caseId), 'fusión pendiente de aprobación');
  const askedActions = (from: number) => fake.requests.slice(from).some((r) => r.path.startsWith(`/repos/${REPO}/actions/runs`));
  let since = fake.requests.length;
  await syncGitHub(platform);
  check(snapshot().prs[0]?.github?.ci === 'none', 'sin CI en el repositorio, el PR queda en «no hay CI» (nunca failure)', snapshot().prs[0]?.github);
  check(!askedActions(since), 'con los check runs vacíos no se insiste con GitHub Actions');
  // Si alguien añade CI al repositorio, el sondeo la refleja.
  fake.ciRuns = [{ status: 'completed', conclusion: 'success' }];
  await syncGitHub(platform);
  check(snapshot().prs[0]?.github?.ci === 'success', 'con CI en el repositorio, se refleja su resultado', snapshot().prs[0]?.github);
  // Token fine-grained sin permiso de Checks (403): el resultado se lee de GitHub Actions.
  fake.checksDenied = true;
  fake.ciRuns = [{ status: 'completed', conclusion: 'failure' }];
  since = fake.requests.length;
  await syncGitHub(platform);
  check(snapshot().prs[0]?.github?.ci === 'failure', 'sin permiso de Checks, la CI se lee de GitHub Actions', snapshot().prs[0]?.github);
  check(askedActions(since), 'con los check runs denegados sí se consulta GitHub Actions');
  fake.ciRuns = [];
  await syncGitHub(platform);
  check(snapshot().prs[0]?.github?.ci === 'none', 'sin permiso de Checks y sin ejecuciones, tampoco es failure', snapshot().prs[0]?.github);
  fake.checksDenied = false;
  await syncGitHub(platform);
  check(snapshot().prs[0]?.github?.ci === 'none', 'al quitar la CI se vuelve a «no hay CI»', snapshot().prs[0]?.github);
  const invalidMerge = await platform.tools.invoke('bugs_merge_pr', { prId: 'PR-99' }, { caseId, actor: 'human', skipPolicy: true });
  check(!invalidMerge.result.ok, 'fusionar un PR inexistente devuelve ok:false');

  // 3 ─────────────────────────────────────────────────────────
  console.log('\n3. Aprobar la fusión en la consola');
  const approval = pendingMerge(platform, caseId)!;
  const decided = await platform.approvals.decide(approval.id, 'approved', 'Consola');
  check(decided.status === 'executed', 'aprobación ejecutada', decided.result?.content);
  check(fake.pulls[0]?.merged === true, 'PR #1 fusionado en la API falsa');
  check(bareVersion(bare) === '2.14.3', 'main del bare en 2.14.3', bareVersion(bare));
  check(git(localRepo, ['rev-parse', 'main']) === git(bare, ['rev-parse', 'main']), 'main local actualizado a origin/main');
  check(snapshot().version === '2.14.3' && snapshot().prs[0]?.status === 'merged', 'snapshot: 2.14.3 y PR merged', snapshot().version);
  check(snapshot().prs[0]?.github?.ci === 'none', 'el PR fusionado tampoco muestra CI', snapshot().prs[0]?.github);
  check(domainEvents('code.fix_merged').at(-1)?.payload?.newVersion === '2.14.3', 'code.fix_merged con 2.14.3');
  check(platform.cases.get(caseId)?.status === 'resolved', 'caso resuelto');
  const again = await platform.tools.invoke('bugs_merge_pr', { prId: pr!.id }, { caseId, actor: 'human', skipPolicy: true });
  check(again.result.ok && domainEvents('code.fix_merged').length === 1, 'repetir la fusión es idempotente (sin segundo evento)', again.result.content);

  // 4 ─────────────────────────────────────────────────────────
  console.log('\n4. Fusión hecha directamente en GitHub');
  await platform.reset();
  check(bareVersion(bare) === '2.14.2', 'tras reiniciar, main del bare vuelve a 2.14.2', bareVersion(bare));
  check(tryGit(bare, ['rev-parse', '--verify', `refs/heads/${BRANCH}`]) === undefined, 'la rama del PR fusionado se ha borrado');
  const caseGitHub = await runScenario(platform);
  const prGitHub = snapshot().prs[0];
  check(prGitHub?.github?.number === 2 && pendingMerge(platform, caseGitHub), 'PR #2 abierto con la fusión pendiente', prGitHub?.github);
  mergeInBare(fake.pulls[1], 'Merge pull request #2 (desde GitHub)');
  const eventsBefore = domainEvents('code.fix_merged').length;
  await syncGitHub(platform);
  const approvalGitHub = platform.approvals.list({ caseId: caseGitHub }).find((a) => a.tool === 'bugs_merge_pr');
  check(approvalGitHub?.status === 'executed' && approvalGitHub.decidedBy === 'GitHub', 'aprobación resuelta como aprobada por GitHub', approvalGitHub && [approvalGitHub.status, approvalGitHub.decidedBy]);
  check(snapshot().prs[0]?.status === 'merged' && snapshot().version === '2.14.3', 'PR merged y versión 2.14.3', snapshot().version);
  check(domainEvents('code.fix_merged').length === eventsBefore + 1, 'code.fix_merged emitido una vez');
  check(git(localRepo, ['rev-parse', 'main']) === git(bare, ['rev-parse', 'main']), 'main local igual que el bare');
  check(platform.cases.get(caseGitHub)?.status === 'resolved', 'caso resuelto');

  console.log('\n4b. PR cerrado en GitHub sin fusionar');
  await platform.reset();
  const caseClosed = await runScenario(platform);
  check(snapshot().prs[0]?.github?.number === 3, 'PR #3 abierto', snapshot().prs[0]?.github);
  fake.pulls[2].state = 'closed';
  await syncGitHub(platform);
  const approvalClosed = platform.approvals.list({ caseId: caseClosed }).find((a) => a.tool === 'bugs_merge_pr');
  check(snapshot().prs[0]?.status === 'closed', 'PR marcado como cerrado', snapshot().prs[0]?.status);
  check(approvalClosed?.status === 'rejected' && approvalClosed.decidedBy === 'GitHub', 'aprobación rechazada por GitHub', approvalClosed && [approvalClosed.status, approvalClosed.decidedBy]);
  check(snapshot().version === '2.14.2' && bareVersion(bare) === '2.14.2', 'la versión no cambia', snapshot().version);

  // 5 ─────────────────────────────────────────────────────────
  console.log('\n5. Reiniciar con un PR abierto');
  const caseReopen = await runScenario(platform);
  const reopened = snapshot().prs.find((item) => item.status === 'open');
  check(reopened?.github?.number === 4 && pendingMerge(platform, caseReopen), 'PR #4 abierto sobre la rama existente', reopened?.github);
  await platform.reset();
  check(fake.pulls[3]?.state === 'closed' && !fake.pulls[3].merged, 'PR #4 de la demo cerrado en la API falsa', fake.pulls[3]?.state);
  check(tryGit(bare, ['rev-parse', '--verify', `refs/heads/${BRANCH}`]) === undefined, 'rama del PR borrada en el bare');
  check(bareVersion(bare) === '2.14.2' && tryGit(bare, ['cat-file', '-e', `main:${MARKER_FILE}`]) !== undefined, 'main del bare en 2.14.2 con marcador');
  check(snapshot().prs.length === 0 && snapshot().mode === 'github', 'snapshot sin PRs y en modo github');
  check(git(localRepo, ['rev-parse', 'main']) === git(bare, ['rev-parse', 'main']), 'main local igual que el bare');
  await platform.shutdown();

  // 6 ─────────────────────────────────────────────────────────
  console.log('\n6. Repositorio con contenido y sin marcador: no se toca');
  const foreign = join(tmpRoot, 'foreign.git');
  const work = join(tmpRoot, 'foreign-work');
  git(tmpRoot, ['init', '-q', '--bare', '-b', 'main', foreign]);
  git(tmpRoot, ['init', '-q', '-b', 'main', work]);
  writeFileSync(join(work, 'README.md'), '# Proyecto de otra persona\n');
  git(work, ['add', 'README.md']);
  git(work, ['commit', '-q', '-m', 'inicial']);
  git(work, ['push', '-q', pathToFileURL(foreign).href, 'main', 'main:refs/heads/feature']);
  const refsBefore = refsOf(foreign);
  fake.bare = foreign;
  const mutatingBefore = fake.requests.filter((r) => r.method !== 'GET').length;
  process.env.GITHUB_GIT_URL = pathToFileURL(foreign).href;

  const other = await startPlatform('data-foreign');
  const foreignSnap = other.snapshot();
  check(foreignSnap.mode === 'local', 'cae a modo local', foreignSnap.mode);
  check(foreignSnap.warning?.includes(MARKER_FILE) && foreignSnap.warning.includes('vacío'), 'aviso que pide un repo vacío dedicado', foreignSnap.warning);
  check(other.platform.notifications.list().some((n) => n.level === 'warning' && n.detail === foreignSnap.warning), 'notificación warning con el aviso');
  check(refsOf(foreign) === refsBefore && refsBefore.includes('refs/heads/main'), 'el bare ajeno queda intacto (mismos SHAs)', refsOf(foreign));
  check(fake.requests.filter((r) => r.method !== 'GET').length === mutatingBefore, 'ninguna petición que modifique la API');
  const otherRepo = join(other.dataDir, 'repos', 'terminal-pagos');
  check(tryGit(otherRepo, ['remote']) === '', 'el repositorio local queda sin remoto');
  localConfigs.push(readFileSync(join(otherRepo, '.git', 'config'), 'utf8'));
  const localCase = await runScenario(other.platform);
  check(other.snapshot().prs[0]?.status === 'open' && !other.snapshot().prs[0]?.github && pendingMerge(other.platform, localCase), 'la demo sigue funcionando en local');
  check(refsOf(foreign) === refsBefore, 'el bare ajeno sigue intacto tras el escenario');
  await other.platform.shutdown();

  console.log('\n6b. Token inválido');
  process.env.GITHUB_TOKEN = WRONG_TOKEN;
  process.env.GITHUB_GIT_URL = pathToFileURL(bare).href;
  fake.bare = bare;
  const refsMain = refsOf(bare);
  const invalid = await startPlatform('data-invalid');
  const invalidSnap = invalid.snapshot();
  check(invalidSnap.mode === 'local' && invalidSnap.warning?.includes('token'), 'cae a modo local con aviso sobre el token', invalidSnap.warning);
  check(!JSON.stringify(invalid.platform.notifications.list()).includes(WRONG_TOKEN), 'el aviso no contiene el token');
  check(refsOf(bare) === refsMain, 'el remoto no se toca');
  localConfigs.push(readFileSync(join(invalid.dataDir, 'repos', 'terminal-pagos', '.git', 'config'), 'utf8'));
  await invalid.platform.shutdown();

  console.log('\n6c. git apunta a un repo ajeno y la API al de la demo (con marcador): no se toca');
  // GITHUB_GIT_URL y GITHUB_REPO son independientes. Si la guarda mirase el marcador en la rama base
  // «por nombre» a través de la API, un remoto de git distinto pasaría la guarda y recibiría el force-push.
  process.env.GITHUB_TOKEN = TOKEN;
  process.env.GITHUB_GIT_URL = pathToFileURL(foreign).href;
  fake.bare = bare;
  const refsForeignMismatch = refsOf(foreign);
  const refsDemoMismatch = refsOf(bare);
  const mutatingMismatch = fake.requests.filter((r) => r.method !== 'GET').length;
  const mismatch = await startPlatform('data-mismatch');
  const mismatchSnap = mismatch.snapshot();
  check(mismatchSnap.mode === 'local' && mismatchSnap.warning?.includes(MARKER_FILE), 'cae a modo local con el aviso de la guarda', [mismatchSnap.mode, mismatchSnap.warning]);
  check(refsOf(foreign) === refsForeignMismatch && refsForeignMismatch.includes('refs/heads/main'), 'el bare ajeno queda intacto (mismos SHAs)', refsOf(foreign));
  check(refsOf(bare) === refsDemoMismatch, 'el bare de la demo tampoco cambia');
  check(fake.requests.filter((r) => r.method !== 'GET').length === mutatingMismatch, 'ninguna petición que modifique la API');
  localConfigs.push(readFileSync(join(mismatch.dataDir, 'repos', 'terminal-pagos', '.git', 'config'), 'utf8'));
  await mismatch.platform.shutdown();
  process.env.GITHUB_GIT_URL = pathToFileURL(bare).href;

  console.log('\n6d. API por http hacia otra máquina: el token no se envía');
  // 0.0.0.0 llega al servidor falso, pero no es 127.0.0.1 ni localhost: tiene que rechazarse antes de pedir nada.
  const apiUrl = process.env.GITHUB_API_URL;
  process.env.GITHUB_API_URL = `http://0.0.0.0:${port}`;
  const requestsPlainHttp = fake.requests.length;
  const refsPlainHttp = refsOf(bare);
  const plainHttp = await startPlatform('data-plain-http');
  const plainHttpSnap = plainHttp.snapshot();
  check(plainHttpSnap.mode === 'local' && plainHttpSnap.warning?.includes('GITHUB_API_URL'), 'cae a modo local con aviso sobre GITHUB_API_URL', plainHttpSnap.warning);
  check(fake.requests.length === requestsPlainHttp, 'ninguna petición a la API (el token no viaja en claro)');
  check(refsOf(bare) === refsPlainHttp, 'el remoto no se toca');
  await plainHttp.platform.shutdown();
  process.env.GITHUB_API_URL = apiUrl;

  // 7 ─────────────────────────────────────────────────────────
  console.log('\n7. Estado persistido al arrancar');
  process.env.GITHUB_TOKEN = TOKEN;
  process.env.DEMO_GITHUB = 'off';
  const localRun = await startPlatform('data-persist', { persist: true });
  await runScenario(localRun.platform);
  check(localRun.snapshot().mode === 'local' && localRun.snapshot().prs.length === 1, 'DEMO_GITHUB=off: modo local con un PR local');
  await localRun.platform.shutdown();

  process.env.DEMO_GITHUB = 'on';
  process.env.GITHUB_GIT_URL = pathToFileURL(foreign).href;
  fake.bare = foreign;
  const foreignRun = await startPlatform('data-persist', { persist: true });
  check(foreignRun.snapshot().mode === 'local' && foreignRun.snapshot().warning, 'con GitHub hacia un repo ajeno: local con aviso');
  check(foreignRun.snapshot().prs.length === 1, 'se conserva el trabajo local previo');
  check(refsOf(foreign) === refsBefore, 'el bare ajeno sigue intacto');
  await foreignRun.platform.shutdown();

  process.env.GITHUB_GIT_URL = pathToFileURL(bare).href;
  fake.bare = bare;
  const bootRun = await startPlatform('data-persist', { persist: true });
  check(bootRun.snapshot().mode === 'github' && bootRun.snapshot().prs.length === 0, 'estado de modo local + GitHub del repo de la demo: empieza desde la plantilla');
  const stale = bootRun.platform.approvals.list({ status: 'pending' }).find((a) => a.tool === 'bugs_merge_pr');
  const refsBeforeStale = refsOf(bare);
  const staleDecided = stale && (await bootRun.platform.approvals.decide(stale.id, 'approved', 'Consola'));
  check(staleDecided && staleDecided.status === 'failed' && refsOf(bare) === refsBeforeStale, 'una aprobación antigua de PR-1 no fusiona nada', staleDecided && staleDecided.result?.content);
  const persistCase = await runScenario(bootRun.platform);
  const persistPr = bootRun.snapshot().prs[0];
  check(persistPr?.github && persistPr.id === 'PR-2' && pendingMerge(bootRun.platform, persistCase), 'PR abierto en GitHub sin reutilizar el identificador', persistPr && [persistPr.id, persistPr.github]);
  await bootRun.platform.shutdown();
  const refsAfterBoot = refsOf(bare);
  const pullsAfterBoot = JSON.stringify(fake.pulls.map((pull) => [pull.number, pull.state]));

  const keepRun = await startPlatform('data-persist', { persist: true });
  check(keepRun.snapshot().mode === 'github', 'rearranque con estado del mismo repo: modo github');
  check(keepRun.snapshot().prs[0]?.github?.number === persistPr?.github?.number && keepRun.snapshot().prs[0]?.status === 'open', 'conserva el PR abierto');
  check(refsOf(bare) === refsAfterBoot, 'no reescribe el remoto (mismos SHAs)');
  check(JSON.stringify(fake.pulls.map((pull) => [pull.number, pull.state])) === pullsAfterBoot, 'no cierra PRs');
  const persistRepo = join(keepRun.dataDir, 'repos', 'terminal-pagos');
  check(tryGit(persistRepo, ['rev-parse', `refs/remotes/origin/main`]) === git(bare, ['rev-parse', 'main']), 'hace fetch de origin/main');
  localConfigs.push(readFileSync(join(persistRepo, '.git', 'config'), 'utf8'));
  await keepRun.platform.shutdown();

  // 8 ─────────────────────────────────────────────────────────
  console.log('\n8. El token no sale a ningún sitio');
  const header = gitAuthEnv('https://github.com/demo-owner/terminal-pagos-demo.git', TOKEN);
  const basic = String(header.GIT_CONFIG_VALUE_0 ?? '').replace(/^AUTHORIZATION: basic /, '');
  check(
    header.GIT_CONFIG_COUNT === '1' &&
      header.GIT_CONFIG_KEY_0 === 'http.https://github.com/.extraheader' &&
      Buffer.from(basic, 'base64').toString() === `x-access-token:${TOKEN}`,
    'con https, la cabecera va en GIT_CONFIG_* (entorno)',
  );
  check(Object.keys(gitAuthEnv(pathToFileURL(bare).href, TOKEN)).length === 0, 'con file:// no hay cabecera');
  check(!describeGitHubError(new Error(`fallo con ${TOKEN} y ${basic}`)).includes(TOKEN), 'los errores se limpian del token');

  const haystacks: [string, string][] = [
    ['snapshots', JSON.stringify(snapshots)],
    ['notificaciones', JSON.stringify(platforms.flatMap((p) => p.notifications.list()))],
    ['casos y trazas', JSON.stringify(platforms.flatMap((p) => p.cases.list()))],
    ['aprobaciones', JSON.stringify(platforms.flatMap((p) => p.approvals.list()))],
    ['eventos', JSON.stringify(events)],
    ['git: argumentos y salida', JSON.stringify(gitRuns)],
    ['.git/config', localConfigs.join('\n')],
    ['state.json', readFileSync(join(tmpRoot, 'data-persist', 'state.json'), 'utf8')],
    ['cuerpos de PR', JSON.stringify(fake.pulls)],
    ['salida de consola', captured.join('')],
  ];
  const secretForms = [TOKEN, WRONG_TOKEN, basic, Buffer.from(`x-access-token:${WRONG_TOKEN}`).toString('base64')];
  for (const [label, text] of haystacks) {
    check(text.length > 0 && !secretForms.some((secret) => text.includes(secret)), `sin token en ${label}`);
  }
  check(gitRuns.some((run) => run.args.includes('push')) && gitRuns.some((run) => run.args.includes('ls-remote')), 'se han observado push y ls-remote de git');
} catch (error) {
  failures++;
  console.error('\nError inesperado:', error instanceof Error ? error.stack : error);
} finally {
  setGitObserver(undefined);
  for (const platform of platforms) await platform.shutdown().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tmpRoot, { recursive: true, force: true });
}

console.log(existsSync(tmpRoot) ? `\nNo se ha podido borrar ${tmpRoot}` : '\nTemporales borrados.');
console.log(failures === 0 ? 'Todo correcto.' : `${failures} comprobaciones fallidas.`);
process.exit(failures === 0 ? 0 : 1);
