/**
 * Conexión opcional con GitHub: el repositorio de la plataforma (monorepo), donde el producto que
 * mantiene el agente de código vive en la carpeta `terminal-pagos/`.
 *
 * Se activa con GITHUB_TOKEN (y DEMO_GITHUB distinto de `off`). El repositorio es GITHUB_REPO o, si no
 * está, el `origin` en GitHub del propio repositorio de la plataforma. Sin eso, o si algo falla al
 * conectar, el proyecto trabaja en local exactamente igual que siempre.
 *
 * El repositorio local `<dataDir>/repos/terminal-pagos` es SOLO local (sin remoto). Para abrir un PR
 * se usa únicamente la API de GitHub: se crea un commit con los ficheros cambiados de la rama de
 * arreglo, colocados bajo `terminal-pagos/`, encima de la punta de la rama base; se crea (o se
 * actualiza) la rama `fix/…` y se abre el PR. Nada más escribe en GitHub:
 * - nunca se toca la rama base ni ninguna rama que no empiece por `fix/`, ni una `fix/…` que no haya
 *   creado la demo;
 * - nunca se fusiona: el PR lo revisa y lo fusiona una persona a mano en GitHub. El sondeo lo detecta
 *   y hace el cierre en local (versión nueva, `code.fix_merged`);
 * - «Reiniciar demo» no toca GitHub.
 *
 * Seguridad: el token solo se lee de `process.env` y solo lo usa Octokit. Nunca va en argumentos,
 * URLs, trazas, notificaciones, snapshots ni resultados que ve el modelo.
 */
import { execFile } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { PlatformApi } from '../../platform/contracts.ts';
import { childEnv, redact, registerSecret } from './redact.ts';
import { COMPONENT, PROJECT_ID, type CiStatus, type GitHubPullRequest } from './state.ts';

/** Marca en el cuerpo de los PRs que abre la demo (evita depender de etiquetas). */
export const PR_MARKER = '<!-- agentes-demo -->';

/**
 * Marca en el mensaje de los commits que crea la demo en GitHub. Una rama `fix/…` que ya existe solo
 * se reescribe si su último commit la lleva: nunca se pisa el trabajo de una persona.
 */
export const COMMIT_TRAILER = 'Agentes-Demo: terminal-pagos';

/** Carpeta del producto dentro del repositorio de la plataforma. */
export const REMOTE_DIR = COMPONENT;

/** Única forma de rama que la demo crea o actualiza en GitHub. */
export const FIX_BRANCH_PREFIX = 'fix/';

const API_TIMEOUT_MS = 15_000;
export const POLL_INTERVAL_MS = 10_000;

export type GitHubMode = 'local' | 'github';

export interface GitHubSettings {
  owner: string;
  name: string;
  /** `owner/nombre` */
  repo: string;
  baseBranch: string;
  apiUrl: string;
  htmlUrl: string;
}

export interface RemotePull {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  headSha: string;
}

/** Operación que la demo se niega a hacer en GitHub (por ejemplo, escribir fuera de `fix/…`). */
export class GuardError extends Error {}

/** Fichero de la rama de arreglo para el commit en GitHub. `content: null` = borrado. */
export interface BranchFile {
  /** Ruta relativa a la raíz de terminal-pagos. */
  path: string;
  content: string | null;
  mode?: '100644' | '100755';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/** Estado HTTP de un error de Octokit, si lo tiene. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Mensaje de la API sin secretos y sin la URL de la documentación. */
function apiMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redact(text.replace(/\s*-\s*https:\/\/docs\.github\.com\S*/g, '').trim());
}

/** Explicación en español de un error de GitHub o de git, sin secretos. */
export function describeGitHubError(error: unknown): string {
  if (error instanceof GuardError) return redact(error.message);
  const status = statusOf(error);
  const detail = apiMessage(error);
  switch (status) {
    case 401:
      return 'GitHub rechaza el token (no es válido o ha caducado).';
    case 403:
      return `GitHub deniega la operación: el token no tiene permisos suficientes o se ha superado el límite de uso (${detail}).`;
    case 404:
      return 'GitHub no encuentra el recurso: el repositorio no existe o el token no tiene acceso a él.';
    case 405:
      return `GitHub no permite la operación (${detail}).`;
    case 409:
      return `Conflicto en GitHub (${detail}).`;
    case 422:
      return `GitHub no acepta la petición (${detail}).`;
    default:
      if (status && status >= 500 && !/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|aborted/i.test(detail)) {
        return `Error de GitHub (${status}): ${detail}`;
      }
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout/i.test(detail)) {
        return `Sin conexión con GitHub (${detail}).`;
      }
      return detail;
  }
}

function requestOptions() {
  return { request: { signal: AbortSignal.timeout(API_TIMEOUT_MS) } };
}

/**
 * `owner/nombre` del `origin` del repositorio de la plataforma si apunta a github.com. Sin GITHUB_REPO
 * se usa este: todo vive en el mismo repositorio (el producto, en `terminal-pagos/`). Solo lee la
 * configuración local de git (sin red) y nunca muestra la URL, que podría llevar credenciales.
 */
function platformOriginRepo(rootDir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: rootDir, env: childEnv({ GIT_TERMINAL_PROMPT: '0' }), timeout: 5_000, encoding: 'utf8' },
      (error, stdout) => {
        const match = error ? null : /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(stdout).trim());
        resolve(match ? `${match[1]}/${match[2]}` : undefined);
      },
    );
  });
}

export class GitHubLink {
  mode: GitHubMode = 'local';
  /** Aviso visible en la consola cuando se ha configurado GitHub pero no se puede usar. */
  warning?: string;
  /** Hay configuración de GitHub (aunque no se haya podido usar). */
  configured = false;
  settings?: GitHubSettings;
  timer?: NodeJS.Timeout;
  stopped = false;

  #token?: string;
  #octokit?: Octokit;

  constructor(readonly platform: PlatformApi) {}

  get remote(): { repo: string; url: string } | undefined {
    return this.mode === 'github' && this.settings ? { repo: this.settings.repo, url: this.settings.htmlUrl } : undefined;
  }

  // ── Configuración y validación ─────────────────────────────

  /**
   * Lee la configuración del entorno y valida el token contra el repositorio. Devuelve los ajustes
   * si se puede seguir en modo GitHub; si no, deja `warning` (cuando había configuración) y null.
   * No toca el repositorio: el modo pasa a `github` con `activate()`.
   */
  async connect(): Promise<GitHubSettings | null> {
    this.mode = 'local';
    this.warning = undefined;
    this.configured = false;
    this.settings = undefined;
    this.#token = undefined;
    this.#octokit = undefined;

    const token = process.env.GITHUB_TOKEN?.trim();
    const switchedOff = process.env.DEMO_GITHUB?.trim().toLowerCase() === 'off';
    if (!token || switchedOff) return null;
    // Sin GITHUB_REPO, el repositorio de la plataforma (su `origin` en GitHub).
    const repoName = process.env.GITHUB_REPO?.trim() || (await platformOriginRepo(this.platform.rootDir));
    if (!repoName) return null;

    registerSecret(token);
    this.configured = true;

    const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(repoName.replace(/\.git$/, ''));
    if (!match) {
      this.warning = 'GITHUB_REPO debe tener la forma owner/nombre. El proyecto Código trabaja en local.';
      return null;
    }
    const [, owner, name] = match;
    const repo = `${owner}/${name}`;

    const baseBranch = process.env.GITHUB_BASE_BRANCH?.trim() || 'main';
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(baseBranch) || baseBranch.includes('..')) {
      this.warning = 'GITHUB_BASE_BRANCH no es un nombre de rama válido. El proyecto Código trabaja en local.';
      return null;
    }

    const apiUrl = (process.env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
    let parsedApi: URL;
    try {
      parsedApi = new URL(apiUrl);
    } catch {
      this.warning = 'GITHUB_API_URL no es una URL válida. El proyecto Código trabaja en local.';
      return null;
    }
    if (parsedApi.username || parsedApi.password) {
      this.warning = 'GITHUB_API_URL no puede llevar credenciales: el token va solo en GITHUB_TOKEN. El proyecto Código trabaja en local.';
      return null;
    }
    // El token viaja en una cabecera: nunca en claro por la red (http solo hacia esta máquina, para pruebas).
    if (parsedApi.protocol !== 'https:' && !(parsedApi.protocol === 'http:' && LOOPBACK_HOSTS.has(parsedApi.hostname))) {
      this.warning = 'GITHUB_API_URL debe ser https:// (http:// solo hacia 127.0.0.1 o localhost, para pruebas). El proyecto Código trabaja en local.';
      return null;
    }
    const octokit = new Octokit({ auth: token, baseUrl: apiUrl, userAgent: 'agentes-demo', log: silentLog });
    let htmlUrl = `https://github.com/${owner}/${name}`;
    try {
      const { data } = await octokit.repos.get({ owner, repo: name, ...requestOptions() });
      if (data.permissions?.push !== true) {
        this.warning = `El token no tiene permiso de escritura en ${repo}. El proyecto Código trabaja en local.`;
        return null;
      }
      if (data.archived) {
        this.warning = `El repositorio ${repo} está archivado y no admite cambios. El proyecto Código trabaja en local.`;
        return null;
      }
      if (typeof data.html_url === 'string') htmlUrl = data.html_url;
    } catch (error) {
      this.warning = `No se puede usar GitHub (${repo}): ${describeGitHubError(error)} El proyecto Código trabaja en local.`;
      return null;
    }

    this.#token = token;
    this.#octokit = octokit;
    this.settings = { owner, name, repo, baseBranch, apiUrl, htmlUrl };
    return this.settings;
  }

  activate(): void {
    if (this.settings && this.#octokit) {
      this.mode = 'github';
      this.warning = undefined;
    }
  }

  /** Vuelve a modo local con un aviso visible (consola, notificación y snapshot). */
  fallback(reason: string): void {
    this.mode = 'local';
    this.warning = redact(reason);
  }

  /** Publica el aviso actual como notificación y en la terminal del servidor. */
  announceWarning(): void {
    if (!this.warning) return;
    console.warn(`[bugs] ${this.warning}`);
    this.platform.notifications.push({
      level: 'warning',
      title: 'GitHub: el proyecto Código trabaja en local',
      detail: this.warning,
      project: PROJECT_ID,
    });
  }

  private api(): { octokit: Octokit; settings: GitHubSettings } {
    if (!this.#octokit || !this.settings) throw new Error('GitHub no está conectado.');
    return { octokit: this.#octokit, settings: this.settings };
  }

  // ── Rama de arreglo por la API ─────────────────────────────

  /**
   * Publica la rama de arreglo en GitHub solo con la API: un commit cuyo padre es la punta actual de
   * la rama base, con los ficheros indicados bajo `terminal-pagos/`, y la referencia
   * `refs/heads/<branch>` apuntando a él (se crea, o se reescribe si ya existía). Solo acepta ramas
   * `fix/…` distintas de la base: nunca toca la rama base ni otras ramas. Devuelve el sha del commit.
   */
  async publishFixBranch(input: { branch: string; files: BranchFile[]; message: string }): Promise<string> {
    const { octokit, settings } = this.api();
    const common = { owner: settings.owner, repo: settings.name };
    const { branch } = input;
    if (
      !branch.startsWith(FIX_BRANCH_PREFIX) ||
      branch === settings.baseBranch ||
      branch.length <= FIX_BRANCH_PREFIX.length ||
      branch.includes('..') ||
      !/^[A-Za-z0-9._/-]+$/.test(branch)
    ) {
      throw new GuardError(`La demo solo escribe en GitHub ramas ${FIX_BRANCH_PREFIX}…; "${branch}" no se sube.`);
    }
    if (!input.files.length) throw new Error(`La rama ${branch} no tiene cambios que subir.`);

    const { data: baseRef } = await octokit.git.getRef({ ...common, ref: `heads/${settings.baseBranch}`, ...requestOptions() });
    const baseSha = baseRef.object.sha;
    const { data: baseCommit } = await octokit.git.getCommit({ ...common, commit_sha: baseSha, ...requestOptions() });
    // El producto tiene que estar ya en la rama base: si no, el PR crearía una carpeta a medias.
    try {
      await octokit.repos.getContent({ ...common, path: `${REMOTE_DIR}/package.json`, ref: baseSha, ...requestOptions() });
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      throw new GuardError(
        `La rama ${settings.baseBranch} de ${settings.repo} no tiene la carpeta ${REMOTE_DIR}/: súbela a GitHub antes de abrir PRs.`,
      );
    }

    const tree = input.files.map((file) => {
      const path = `${REMOTE_DIR}/${file.path.replace(/^\/+/, '')}`;
      const mode = file.mode ?? '100644';
      return file.content === null
        ? { path, mode, type: 'blob' as const, sha: null }
        : { path, mode, type: 'blob' as const, content: file.content };
    });
    const { data: newTree } = await octokit.git.createTree({
      ...common,
      base_tree: baseCommit.tree.sha,
      tree,
      ...requestOptions(),
    });
    if (newTree.sha === baseCommit.tree.sha) {
      throw new Error(
        `La carpeta ${REMOTE_DIR}/ de ${settings.baseBranch} en GitHub ya contiene exactamente estos cambios: no hay nada que proponer.`,
      );
    }
    const { data: commit } = await octokit.git.createCommit({
      ...common,
      message: `${input.message.trim()}\n\n${COMMIT_TRAILER}`,
      tree: newTree.sha,
      parents: [baseSha],
      ...requestOptions(),
    });

    try {
      await octokit.git.createRef({ ...common, ref: `refs/heads/${branch}`, sha: commit.sha, ...requestOptions() });
    } catch (error) {
      if (statusOf(error) !== 422 || !/already exists/i.test(apiMessage(error))) throw error;
      // Restos de una ejecución anterior con el mismo nombre: la rama fix/… se reescribe, pero solo si
      // la dejó la demo (su último commit lleva la marca). Una rama de una persona no se toca.
      const { data: current } = await octokit.git.getRef({ ...common, ref: `heads/${branch}`, ...requestOptions() });
      const { data: head } = await octokit.git.getCommit({ ...common, commit_sha: current.object.sha, ...requestOptions() });
      if (!head.message?.includes(COMMIT_TRAILER)) {
        throw new GuardError(
          `La rama ${branch} ya existe en ${settings.repo} y no la ha creado la demo: no se reescribe. Usa otro nombre de rama fix/….`,
        );
      }
      await octokit.git.updateRef({ ...common, ref: `heads/${branch}`, sha: commit.sha, force: true, ...requestOptions() });
    }
    return commit.sha;
  }

  // ── Pull requests ──────────────────────────────────────────

  /**
   * Crea el PR, o actualiza título y cuerpo si ya había uno abierto de la demo para la rama. Un PR
   * abierto por una persona para esa rama se reutiliza tal cual, sin editarlo. Nunca fusiona ni cierra.
   */
  async openPull(input: { number?: number; branch: string; title: string; body: string }): Promise<GitHubPullRequest> {
    const { octokit, settings } = this.api();
    const common = { owner: settings.owner, repo: settings.name };

    let number = input.number;
    if (number) {
      const { data } = await octokit.pulls.get({ ...common, pull_number: number, ...requestOptions() });
      if (data.state !== 'open' || data.head?.ref !== input.branch || !data.body?.includes(PR_MARKER)) number = undefined;
    }
    if (!number) {
      const { data: existing } = await octokit.pulls.list({
        ...common,
        state: 'open',
        head: `${settings.owner}:${input.branch}`,
        per_page: 10,
        ...requestOptions(),
      });
      const found = existing.find((pull) => pull.head?.ref === input.branch);
      if (found && !found.body?.includes(PR_MARKER)) return { number: found.number, url: found.html_url, ci: 'none' };
      number = found?.number;
    }

    if (number) {
      const { data } = await octokit.pulls.update({
        ...common,
        pull_number: number,
        title: input.title,
        body: input.body,
        ...requestOptions(),
      });
      return { number: data.number, url: data.html_url, ci: 'none' };
    }
    // Justo después de crear la rama, GitHub a veces aún no la reconoce (422): se reintenta un par de veces.
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await octokit.pulls.create({
          ...common,
          title: input.title,
          body: input.body,
          head: input.branch,
          base: settings.baseBranch,
          ...requestOptions(),
        });
        return { number: data.number, url: data.html_url, ci: 'none' };
      } catch (error) {
        const retry = statusOf(error) === 422 && !/already exists/i.test(apiMessage(error)) && attempt < 2;
        if (!retry) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.platform.fast ? 50 : 2_000));
      }
    }
  }

  async getPull(number: number): Promise<RemotePull> {
    const { octokit, settings } = this.api();
    const { data } = await octokit.pulls.get({
      owner: settings.owner,
      repo: settings.name,
      pull_number: number,
      ...requestOptions(),
    });
    return {
      number: data.number,
      url: data.html_url,
      state: data.state === 'open' ? 'open' : 'closed',
      merged: Boolean(data.merged),
      headSha: data.head.sha,
    };
  }

  /**
   * Resultado de CI de un commit. La demo no añade ninguna CI al repositorio, así que lo normal es
   * que el commit no tenga comprobaciones: eso es `none`, no un fallo. Se pregunta una vez por los
   * check runs; solo si la API no deja leerlos (403, o 404 en instalaciones antiguas) se mira además
   * GitHub Actions. Una lista vacía es una respuesta, no un motivo para seguir buscando.
   */
  async ciStatus(sha: string): Promise<CiStatus> {
    const { octokit, settings } = this.api();
    const common = { owner: settings.owner, repo: settings.name };

    try {
      const { data } = await octokit.checks.listForRef({ ...common, ref: sha, per_page: 100, ...requestOptions() });
      return summarize(data.check_runs.map((run) => ({ status: run.status, conclusion: run.conclusion }))) ?? 'none';
    } catch (error) {
      const code = statusOf(error);
      if (code !== 403 && code !== 404) return 'none';
    }

    try {
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
        ...common,
        head_sha: sha,
        per_page: 50,
        ...requestOptions(),
      });
      return summarize(data.workflow_runs.map((run) => ({ status: run.status, conclusion: run.conclusion }))) ?? 'none';
    } catch {
      return 'none';
    }
  }

  // ── Sondeo ─────────────────────────────────────────────────

  #tick?: () => Promise<boolean>;
  #running = false;
  #again = false;

  /** Función de sondeo: devuelve si hay que seguir sondeando (quedan PRs abiertos en GitHub). */
  setTicker(tick: () => Promise<boolean>): void {
    this.#tick = tick;
  }

  /** Programa un sondeo (cada ~10 s) si hay GitHub, no es modo rápido y no se ha parado. */
  schedule(delayMs = POLL_INTERVAL_MS): void {
    if (this.stopped || this.platform.fast || this.mode !== 'github' || !this.#tick) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      this.#running = true;
      this.#again = false;
      let again = true;
      try {
        again = await this.#tick!();
      } catch (error) {
        console.warn(`[bugs] Sondeo de GitHub: ${describeGitHubError(error)}`);
      } finally {
        this.#running = false;
      }
      if (again || this.#again) this.schedule();
    }, delayMs);
    this.timer.unref?.();
  }

  stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** null si no hay ninguna ejecución. */
function summarize(runs: { status?: string | null; conclusion?: string | null }[]): CiStatus | null {
  if (!runs.length) return null;
  if (runs.some((run) => run.conclusion && FAILED.has(run.conclusion))) return 'failure';
  if (runs.some((run) => run.status !== 'completed')) return 'pending';
  return 'success';
}

const links = new Map<PlatformApi, GitHubLink>();

export function linkFor(platform: PlatformApi): GitHubLink {
  let link = links.get(platform);
  if (!link) {
    link = new GitHubLink(platform);
    links.set(platform, link);
  }
  return link;
}

/** Para todos los sondeos (ProjectModule.stop no recibe la plataforma). */
export function stopAllLinks(): void {
  for (const link of links.values()) {
    link.stopped = true;
    link.stopPolling();
  }
}
