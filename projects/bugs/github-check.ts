/**
 * Comprobación del modo GitHub del proyecto de código SIN GitHub real.
 *
 *   npx tsx projects/bugs/github-check.ts
 *
 * Monta en una carpeta temporal un repositorio git bare que hace de «repositorio de la plataforma»
 * (con `terminal-pagos/` dentro) y un servidor HTTP local que imita solo los endpoints de la API de
 * GitHub que usa la demo (GITHUB_API_URL=http://127.0.0.1:<puerto>): refs, árboles, commits y PRs.
 * Recorre: arranque, PR del agente creado solo por la API con los cambios bajo `terminal-pagos/`,
 * que el agente no fusiona, fusión manual «en GitHub» detectada por el sondeo, reinicio sin tocar
 * GitHub, rama fix/… reescrita en una segunda ejecución, PR cerrado sin fusionar, ramas que no son
 * fix/…, token inválido y que el token no aparezca en ningún sitio. Borra sus temporales al terminar.
 *
 * La carpeta temporal sale de GITHUB_CHECK_TMPDIR o, si no está, del directorio temporal del sistema.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DomainEvent, PlatformApi, PlatformEvent } from '../../platform/contracts.ts';
import { createPlatform } from '../../platform/index.ts';
import { COMMIT_TRAILER, describeGitHubError, GuardError, linkFor, PR_MARKER } from './github.ts';
import { bugs } from './index.ts';
import { setGitObserver, type GitRun } from './repo.ts';
import type { BugsState } from './state.ts';
import { syncGitHub } from './sync.ts';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const templateDir = fileURLToPath(new URL('./template/', import.meta.url));
const tmpRoot = mkdtempSync(join(process.env.GITHUB_CHECK_TMPDIR || tmpdir(), 'agentes-github-check-'));

const TOKEN = 'centinela-7f3a9c2e5b1d-token-que-no-debe-salir';
const WRONG_TOKEN = 'centinela-otro-4c8e1a-token-invalido';
const OWNER = 'demo-owner';
const NAME = 'plataforma-demo';
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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'GitHub',
  GIT_AUTHOR_EMAIL: 'noreply@github.test',
  GIT_COMMITTER_NAME: 'GitHub',
  GIT_COMMITTER_EMAIL: 'noreply@github.test',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function git(cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: { ...GIT_ENV, ...options.env },
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

const refsOf = (bare: string) => tryGit(bare, ['for-each-ref', '--format=%(refname) %(objectname)']) ?? '';
const versionAt = (bare: string, ref: string) =>
  (JSON.parse(tryGit(bare, ['show', `${ref}:terminal-pagos/package.json`]) ?? '{}') as { version?: string }).version;

// ─────────────────────────────────────────────────────────────
// API de GitHub falsa sobre un bare
// ─────────────────────────────────────────────────────────────

interface FakePull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: 'open' | 'closed';
  merged: boolean;
}

const fake = {
  bare: '',
  pulls: [] as FakePull[],
  requests: [] as { method: string; path: string; authorization: string }[],
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
  const sha = tryGit(fake.bare, ['rev-parse', '--verify', `refs/heads/${pull.head}`]) ?? '0'.repeat(40);
  return {
    number: pull.number,
    html_url: `https://github.com/${REPO}/pull/${pull.number}`,
    state: pull.state,
    merged: pull.merged,
    title: pull.title,
    body: pull.body,
    head: { ref: pull.head, sha, repo: { full_name: REPO } },
    base: { ref: pull.base },
  };
}

/** Lo que hace una persona al pulsar «Merge» en GitHub: commit de merge en la rama base. */
function humanMerge(pull: FakePull): void {
  const baseSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.base}`]);
  const headSha = git(fake.bare, ['rev-parse', `refs/heads/${pull.head}`]);
  const tree = git(fake.bare, ['merge-tree', '--write-tree', baseSha, headSha]);
  const commit = git(fake.bare, ['commit-tree', tree, '-p', baseSha, '-p', headSha, '-m', `Merge pull request #${pull.number}`]);
  git(fake.bare, ['update-ref', `refs/heads/${pull.base}`, commit, baseSha]);
  pull.merged = true;
  pull.state = 'closed';
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const authorization = String(req.headers.authorization ?? '');
  const method = req.method ?? 'GET';
  fake.requests.push({ method, path: decodeURIComponent(url.pathname), authorization });
  if (authorization !== `token ${TOKEN}`) return send(res, 401, { message: 'Bad credentials' });

  const prefix = `/repos/${OWNER}/${NAME}`;
  if (!url.pathname.startsWith(prefix)) return send(res, 404, { message: 'Not Found' });
  // Las refs llevan «/» (a veces codificadas): el resto se decodifica entero.
  const rest = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+/, '');

  try {
    if (rest === '' && method === 'GET') {
      return send(res, 200, {
        name: NAME,
        full_name: REPO,
        html_url: `https://github.com/${REPO}`,
        archived: false,
        default_branch: 'main',
        permissions: { admin: false, push: true, pull: true },
      });
    }

    if (rest.startsWith('contents/') && method === 'GET') {
      const ref = url.searchParams.get('ref') ?? 'main';
      const path = rest.slice('contents/'.length);
      const content = tryGit(fake.bare, ['show', `${ref}:${path}`]);
      if (content === undefined) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { type: 'file', name: path, path, encoding: 'base64', content: Buffer.from(content).toString('base64') });
    }

    if (rest.startsWith('git/ref/') && method === 'GET') {
      const ref = rest.slice('git/ref/'.length);
      const sha = tryGit(fake.bare, ['rev-parse', '--verify', `refs/${ref}`]);
      if (!sha) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { ref: `refs/${ref}`, object: { sha, type: 'commit' } });
    }

    if (rest.startsWith('git/commits/') && method === 'GET') {
      const sha = rest.slice('git/commits/'.length);
      const tree = tryGit(fake.bare, ['rev-parse', '--verify', `${sha}^{tree}`]);
      if (!tree) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { sha, tree: { sha: tree }, message: tryGit(fake.bare, ['log', '-1', '--format=%B', sha]) ?? '' });
    }

    if (rest === 'git/trees' && method === 'POST') {
      const body = await readJson(req);
      const index = join(tmpRoot, `index-${Date.now()}`);
      const env = { GIT_INDEX_FILE: index };
      try {
        git(fake.bare, ['read-tree', String(body.base_tree)], { env });
        for (const entry of body.tree as { path: string; mode: string; sha?: string | null; content?: string }[]) {
          if (entry.sha === null) {
            git(fake.bare, ['update-index', '--force-remove', entry.path], { env });
          } else {
            const blob = git(fake.bare, ['hash-object', '-w', '--stdin'], { input: entry.content ?? '' });
            git(fake.bare, ['update-index', '--add', '--cacheinfo', `${entry.mode},${blob},${entry.path}`], { env });
          }
        }
        return send(res, 201, { sha: git(fake.bare, ['write-tree'], { env }) });
      } finally {
        rmSync(index, { force: true });
      }
    }

    if (rest === 'git/commits' && method === 'POST') {
      const body = await readJson(req);
      const parents = (body.parents as string[]).flatMap((parent) => ['-p', parent]);
      return send(res, 201, { sha: git(fake.bare, ['commit-tree', String(body.tree), ...parents, '-m', String(body.message)]) });
    }

    if (rest === 'git/refs' && method === 'POST') {
      const body = await readJson(req);
      if (tryGit(fake.bare, ['rev-parse', '--verify', String(body.ref)])) {
        return send(res, 422, { message: 'Reference already exists' });
      }
      git(fake.bare, ['update-ref', String(body.ref), String(body.sha)]);
      return send(res, 201, { ref: body.ref, object: { sha: body.sha } });
    }

    if (rest.startsWith('git/refs/') && method === 'PATCH') {
      const body = await readJson(req);
      const ref = `refs/${rest.slice('git/refs/'.length)}`;
      git(fake.bare, ['update-ref', ref, String(body.sha)]);
      return send(res, 200, { ref, object: { sha: body.sha } });
    }

    if (rest === 'pulls' && method === 'GET') {
      const state = url.searchParams.get('state') ?? 'open';
      const head = url.searchParams.get('head');
      const list = fake.pulls
        .filter((pull) => state === 'all' || pull.state === state)
        .filter((pull) => !head || `${OWNER}:${pull.head}` === head)
        .map(pullJson);
      return send(res, 200, list);
    }

    if (rest === 'pulls' && method === 'POST') {
      const body = await readJson(req);
      if (!tryGit(fake.bare, ['rev-parse', '--verify', `refs/heads/${body.head}`])) {
        return send(res, 422, { message: 'Validation Failed', errors: [{ field: 'head', code: 'invalid' }] });
      }
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
      };
      fake.pulls.push(pull);
      return send(res, 201, pullJson(pull));
    }

    const pullMatch = /^pulls\/(\d+)$/.exec(rest);
    const pull = pullMatch ? fake.pulls.find((item) => item.number === Number(pullMatch[1])) : undefined;
    if (pullMatch && !pull) return send(res, 404, { message: 'Not Found' });
    if (pull && method === 'GET') return send(res, 200, pullJson(pull));
    if (pull && method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.title === 'string') pull.title = body.title;
      if (typeof body.body === 'string') pull.body = body.body;
      return send(res, 200, pullJson(pull));
    }

    if (/^commits\/[^/]+\/check-runs$/.test(rest) && method === 'GET') {
      return send(res, 200, { total_count: 0, check_runs: [] });
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

async function startPlatform(name: string): Promise<{ platform: PlatformApi; dataDir: string; snapshot: () => Snapshot }> {
  const dataDir = join(tmpRoot, name);
  const platform = await createPlatform({ rootDir, dataDir, provider: 'mock', fast: true, inMemory: true });
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

/** Peticiones que escriben en la API desde `from`. */
const writesSince = (from: number) => fake.requests.slice(from).filter((r) => r.method !== 'GET');

/** Únicas escrituras permitidas: árboles, commits, refs fix/… y PRs (crear o editar). */
function allowedWrite(request: { method: string; path: string }): boolean {
  const rest = request.path.replace(`/repos/${REPO}/`, '');
  if (request.method === 'POST') return ['git/trees', 'git/commits', 'git/refs', 'pulls'].includes(rest);
  if (request.method === 'PATCH') return rest.startsWith('git/refs/heads/fix/') || /^pulls\/\d+$/.test(rest);
  return false;
}

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;

// Repositorio de la plataforma: README en la raíz y el producto en terminal-pagos/.
const bare = join(tmpRoot, 'plataforma.git');
const seed = join(tmpRoot, 'seed');
git(tmpRoot, ['init', '-q', '--bare', '-b', 'main', bare]);
git(tmpRoot, ['init', '-q', '-b', 'main', seed]);
writeFileSync(join(seed, 'README.md'), '# Plataforma de agentes\n');
cpSync(templateDir, join(seed, 'terminal-pagos'), { recursive: true });
git(seed, ['add', '-A']);
git(seed, ['commit', '-q', '-m', 'plataforma inicial']);
git(seed, ['push', '-q', pathToFileURL(bare).href, 'main']);
const seedMain = git(bare, ['rev-parse', 'main']);
fake.bare = bare;

process.env.DEMO_GITHUB = 'on';
process.env.GITHUB_TOKEN = TOKEN;
process.env.GITHUB_REPO = REPO;
process.env.GITHUB_BASE_BRANCH = 'main';
process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;

const localConfigs: string[] = [];

try {
  // 1 ─────────────────────────────────────────────────────────
  console.log('\n1. Arranque en modo GitHub (repositorio de la plataforma)');
  const { platform, dataDir, snapshot } = await startPlatform('data-github');
  const localRepo = join(dataDir, 'repos', 'terminal-pagos');
  const first = snapshot();
  check(first.mode === 'github' && !first.warning, 'modo github sin aviso', { mode: first.mode, warning: first.warning });
  check(first.remote?.repo === REPO, 'remote con el repositorio', first.remote);
  check(tryGit(localRepo, ['remote']) === '', 'el repositorio local no tiene remoto');
  check(refsOf(bare) === `refs/heads/main ${seedMain}`, 'arrancar no toca GitHub', refsOf(bare));
  check(writesSince(0).length === 0, 'ninguna escritura en la API al arrancar', writesSince(0));
  check(platform.tools.get('bugs_merge_pr') === undefined, 'no existe herramienta para fusionar');
  localConfigs.push(readFileSync(join(localRepo, '.git', 'config'), 'utf8'));

  // 2 ─────────────────────────────────────────────────────────
  console.log('\n2. El agente abre el PR solo por la API');
  const caseId = await runScenario(platform);
  const pr = snapshot().prs[0];
  check(pr?.status === 'open' && pr.github?.number === 1, 'PR abierto con número de GitHub', pr?.github);
  check(fake.pulls[0]?.head === BRANCH && fake.pulls[0].base === 'main', 'PR de fix/… hacia main', fake.pulls[0]);
  check(fake.pulls[0]?.body.includes(PR_MARKER) && fake.pulls[0].body.includes('fusiona a mano'), 'el cuerpo dice que se fusiona a mano', fake.pulls[0]?.body);
  check(git(bare, ['rev-parse', 'main']) === seedMain, 'main de GitHub sin tocar');
  check(git(bare, ['rev-parse', `${BRANCH}^`]) === seedMain, 'la rama fix/… es un commit encima de main');
  const changed = git(bare, ['diff', '--name-only', 'main', BRANCH]).split('\n').sort();
  check(
    changed.join(',') === 'terminal-pagos/package.json,terminal-pagos/src/terminal.ts',
    'el commit solo cambia ficheros de terminal-pagos/',
    changed,
  );
  check(versionAt(bare, BRANCH) === '2.14.3', 'la rama lleva terminal-pagos 2.14.3', versionAt(bare, BRANCH));
  check(git(bare, ['show', `${BRANCH}:terminal-pagos/src/terminal.ts`]).includes('this.finish();'), 'la rama lleva el arreglo');
  check(git(bare, ['show', `${BRANCH}:README.md`]) === '# Plataforma de agentes', 'el resto del repositorio queda igual');
  check(writesSince(0).every(allowedWrite), 'solo escrituras permitidas (árbol, commit, ref fix/…, PR)', writesSince(0));
  check(platform.approvals.list({ caseId }).length === 0, 'sin aprobaciones de fusión');
  check(platform.cases.get(caseId)?.status === 'resolved', 'el agente termina tras abrir el PR', platform.cases.get(caseId)?.status);
  check(/fusiona a mano en GitHub/.test(platform.cases.get(caseId)?.summary ?? ''), 'el resumen deja la fusión a una persona');
  check(
    !gitRuns.some((run) => run.args.some((arg) => ['push', 'fetch', 'ls-remote', 'pull', 'clone'].includes(arg))),
    'ningún git contra un remoto',
  );

  // 3 ─────────────────────────────────────────────────────────
  console.log('\n3. Sondeo con el PR abierto y fusión manual en GitHub');
  check((await syncGitHub(platform)) === true && snapshot().prs[0]?.status === 'open', 'sin fusionar: sigue abierto y se sigue sondeando');
  humanMerge(fake.pulls[0]);
  const mergedMain = git(bare, ['rev-parse', 'main']);
  const writesBeforeClose = fake.requests.length;
  const more = await syncGitHub(platform);
  check(snapshot().prs[0]?.status === 'merged' && snapshot().version === '2.14.3', 'el sondeo detecta la fusión: PR merged y 2.14.3', snapshot().version);
  check(domainEvents('code.fix_merged').length === 1 && domainEvents('code.fix_merged')[0].payload?.newVersion === '2.14.3', 'code.fix_merged con 2.14.3');
  check(git(localRepo, ['show', 'main:package.json']).includes('"version": "2.14.3"'), 'main local fusionado en 2.14.3');
  check(git(bare, ['rev-parse', 'main']) === mergedMain && writesSince(writesBeforeClose).length === 0, 'el cierre no escribe en GitHub');
  check(more === false, 'sin PRs abiertos, el sondeo se para');
  await syncGitHub(platform);
  check(domainEvents('code.fix_merged').length === 1, 'un segundo sondeo no repite el cierre');

  // 4 ─────────────────────────────────────────────────────────
  console.log('\n4. Reiniciar demo no toca GitHub');
  const refsBeforeReset = refsOf(bare);
  const requestsBeforeReset = fake.requests.length;
  await platform.reset();
  check(snapshot().version === '2.14.2' && snapshot().prs.length === 0 && snapshot().mode === 'github', 'local vuelve a 2.14.2 sin PRs');
  check(refsOf(bare) === refsBeforeReset, 'refs de GitHub intactas', refsOf(bare));
  check(writesSince(requestsBeforeReset).length === 0, 'ninguna escritura en la API al reiniciar');

  // 5 ─────────────────────────────────────────────────────────
  console.log('\n5. Con el arreglo ya en main de GitHub no se abre un PR vacío');
  const caseSame = await runScenario(platform);
  check(snapshot().prs.length === 0, 'no se registra PR', snapshot().prs);
  check(/ya contiene exactamente estos cambios/.test(JSON.stringify(platform.cases.get(caseSame)?.timeline ?? [])), 'se explica por qué');
  check(git(bare, ['rev-parse', 'main']) === mergedMain, 'main de GitHub sin tocar');

  // 6 ─────────────────────────────────────────────────────────
  console.log('\n6. Rama fix/… existente: se reescribe y se abre un PR nuevo');
  // Una persona revierte terminal-pagos en main (fuera de la demo).
  git(bare, ['update-ref', 'refs/heads/main', seedMain]);
  await platform.reset();
  const oldBranch = git(bare, ['rev-parse', BRANCH]);
  const caseAgain = await runScenario(platform);
  const again = snapshot().prs[0];
  check(again?.github?.number === 2 && fake.pulls[1]?.state === 'open', 'PR #2 abierto', again?.github);
  check(git(bare, ['rev-parse', BRANCH]) !== oldBranch && git(bare, ['rev-parse', `${BRANCH}^`]) === seedMain, 'fix/… reescrita encima de main');
  check(git(bare, ['rev-parse', 'main']) === seedMain, 'main de GitHub sin tocar');
  check(platform.approvals.list({ caseId: caseAgain }).length === 0, 'sin aprobaciones');

  console.log('\n6b. PR cerrado en GitHub sin fusionar');
  fake.pulls[1].state = 'closed';
  await syncGitHub(platform);
  check(snapshot().prs[0]?.status === 'closed' && snapshot().version === '2.14.2', 'PR cerrado y sin versión nueva', snapshot().prs[0]?.status);
  check(domainEvents('code.fix_merged').length === 1, 'sin code.fix_merged');

  console.log('\n6c. main de GitHub sin la carpeta terminal-pagos/');
  const bareRef = git(bare, ['rev-parse', 'main']);
  const emptyTree = git(bare, ['mktree'], { input: '' });
  const noProduct = git(bare, ['commit-tree', emptyTree, '-p', bareRef, '-m', 'sin producto']);
  git(bare, ['update-ref', 'refs/heads/main', noProduct]);
  const refsNoProduct = refsOf(bare);
  const requestsNoProduct = fake.requests.length;
  await platform.reset();
  const caseNoProduct = await runScenario(platform);
  check(snapshot().prs.length === 0, 'no se abre el PR', snapshot().prs);
  check(/no tiene la carpeta terminal-pagos/.test(JSON.stringify(platform.cases.get(caseNoProduct)?.timeline ?? [])), 'se explica que falta la carpeta');
  check(refsOf(bare) === refsNoProduct && writesSince(requestsNoProduct).length === 0, 'GitHub sin tocar');
  git(bare, ['update-ref', 'refs/heads/main', bareRef]);

  // 7 ─────────────────────────────────────────────────────────
  console.log('\n7. Solo ramas fix/…');
  const link = linkFor(platform);
  const requestsBeforeGuard = fake.requests.length;
  for (const branch of ['main', 'feature/x', 'fix/']) {
    const refused = await link.publishFixBranch({ branch, files: [{ path: 'a.txt', content: 'x' }], message: 'x' }).then(
      () => undefined,
      (error: unknown) => error,
    );
    check(refused instanceof GuardError, `rechaza la rama "${branch}"`, refused && describeGitHubError(refused));
  }
  check(fake.requests.length === requestsBeforeGuard, 'sin peticiones a la API');
  // Una rama fix/… que ha creado una persona (su commit no lleva la marca de la demo) no se reescribe.
  git(bare, ['update-ref', 'refs/heads/fix/de-una-persona', seedMain]);
  const humanRefused = await link
    .publishFixBranch({ branch: 'fix/de-una-persona', files: [{ path: 'a.txt', content: 'x' }], message: 'x' })
    .then(() => undefined, (error: unknown) => error);
  check(humanRefused instanceof GuardError, 'no reescribe una rama fix/… de una persona', humanRefused && describeGitHubError(humanRefused));
  check(git(bare, ['rev-parse', 'fix/de-una-persona']) === seedMain, 'la rama de la persona queda igual');
  check(git(bare, ['log', '-1', '--format=%B', BRANCH]).includes(COMMIT_TRAILER), 'los commits de la demo llevan su marca');
  check(writesSince(0).every(allowedWrite), 'en todo el recorrido, solo escrituras permitidas', writesSince(0).filter((r) => !allowedWrite(r)));
  localConfigs.push(readFileSync(join(localRepo, '.git', 'config'), 'utf8'));
  await platform.shutdown();

  // 8 ─────────────────────────────────────────────────────────
  console.log('\n8. Token inválido');
  process.env.GITHUB_TOKEN = WRONG_TOKEN;
  const refsInvalid = refsOf(bare);
  const invalid = await startPlatform('data-invalid');
  const invalidSnap = invalid.snapshot();
  check(invalidSnap.mode === 'local' && invalidSnap.warning?.includes('token'), 'cae a modo local con aviso sobre el token', invalidSnap.warning);
  check(!JSON.stringify(invalid.platform.notifications.list()).includes(WRONG_TOKEN), 'el aviso no contiene el token');
  check(refsOf(bare) === refsInvalid, 'GitHub no se toca');
  const localCase = await runScenario(invalid.platform);
  check(invalid.snapshot().prs[0]?.status === 'open' && !invalid.snapshot().prs[0]?.github && localCase, 'la demo sigue funcionando en local');
  await invalid.platform.shutdown();
  process.env.GITHUB_TOKEN = TOKEN;

  // 9 ─────────────────────────────────────────────────────────
  console.log('\n9. El token no sale a ningún sitio');
  check(fake.requests.some((r) => r.authorization === `token ${TOKEN}`), 'la API recibe el token en la cabecera');
  check(!describeGitHubError(new Error(`fallo con ${TOKEN}`)).includes(TOKEN), 'los errores se limpian del token');
  const haystacks: [string, string][] = [
    ['snapshots', JSON.stringify(snapshots)],
    ['notificaciones', JSON.stringify(platforms.flatMap((p) => p.notifications.list()))],
    ['casos y trazas', JSON.stringify(platforms.flatMap((p) => p.cases.list()))],
    ['eventos', JSON.stringify(events)],
    ['git: argumentos y salida', JSON.stringify(gitRuns)],
    ['.git/config', localConfigs.join('\n')],
    ['cuerpos de PR', JSON.stringify(fake.pulls)],
    ['salida de consola', captured.join('')],
  ];
  for (const [label, text] of haystacks) {
    check(text.length > 0 && ![TOKEN, WRONG_TOKEN].some((secret) => text.includes(secret)), `sin token en ${label}`);
  }
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
