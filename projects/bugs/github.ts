/**
 * Conexión opcional con un repositorio de GitHub dedicado a la demo.
 *
 * Se activa con GITHUB_TOKEN y GITHUB_REPO (y DEMO_GITHUB distinto de `off`). Sin eso, o si algo
 * falla al conectar, el proyecto trabaja en local exactamente igual que siempre.
 *
 * Seguridad:
 * - El token solo se lee de `process.env` y solo lo usan Octokit y git. Nunca va en argumentos,
 *   URLs, `.git/config`, trazas, notificaciones, snapshots ni resultados que ve el modelo.
 * - git recibe la cabecera de autenticación por variables de entorno (GIT_CONFIG_*), sin ayudantes
 *   de credenciales ni configuración global que pudiera cambiar la URL o usar otras credenciales.
 * - Guarda destructiva: solo se reescribe el remoto (force-push, cierre de PRs, borrado de ramas)
 *   si está vacío o si su rama base tiene el fichero marcador `.agentes-demo`. Se comprueba antes de
 *   cada una de esas operaciones.
 */
import { Buffer } from 'node:buffer';
import { Octokit } from '@octokit/rest';
import type { PlatformApi } from '../../platform/contracts.ts';
import { redact, registerSecret } from './redact.ts';
import type { TerminalRepo } from './repo.ts';
import { PROJECT_ID, type CiStatus, type GitHubPullRequest } from './state.ts';

/** Fichero que marca un repositorio como de la demo. Está en la plantilla. */
export const MARKER_FILE = '.agentes-demo';
/** Marca en el cuerpo de los PRs que abre la demo (evita depender de etiquetas). */
export const PR_MARKER = '<!-- agentes-demo -->';

const API_TIMEOUT_MS = 15_000;
const GIT_REMOTE_TIMEOUT_MS = 90_000;
export const POLL_INTERVAL_MS = 10_000;

export type GitHubMode = 'local' | 'github';

export interface GitHubSettings {
  owner: string;
  name: string;
  /** `owner/nombre` */
  repo: string;
  baseBranch: string;
  apiUrl: string;
  gitUrl: string;
  htmlUrl: string;
}

export interface RemotePull {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  headSha: string;
}

/** Error de la guarda destructiva: el remoto no es un repositorio de la demo. */
export class GuardError extends Error {}

/** Resultado de la guarda: el remoto tal y como estaba al comprobarlo. */
export interface DemoRepoCheck {
  empty: boolean;
  /** Referencias del remoto al comprobarlo: `refs/heads/main` → sha. */
  refs: Map<string, string>;
}

/**
 * `--force-with-lease` para una referencia: git solo la reescribe o la borra si sigue en el commit que
 * vio la guarda (o, si no existía, si sigue sin existir). Nunca se combina con `--force`, que lo anula.
 */
function lease(ref: string, check: DemoRepoCheck): string {
  return `--force-with-lease=${ref}:${check.refs.get(ref) ?? ''}`;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Cabecera de autenticación para git en variables de entorno, con ámbito en el origen de la URL
 * (`http.https://github.com/.extraheader`). Con remotos que no son https no hace falta.
 */
export function gitAuthEnv(gitUrl: string, token: string): NodeJS.ProcessEnv {
  let url: URL;
  try {
    url = new URL(gitUrl);
  } catch {
    return {};
  }
  if (url.protocol !== 'https:') return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${url.origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

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
    const repoName = process.env.GITHUB_REPO?.trim();
    const switchedOff = process.env.DEMO_GITHUB?.trim().toLowerCase() === 'off';
    if (!token || !repoName || switchedOff) return null;

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
    const gitUrl = process.env.GITHUB_GIT_URL?.trim() || `https://github.com/${owner}/${name}.git`;
    let parsedGit: URL;
    try {
      parsedGit = new URL(gitUrl);
    } catch {
      this.warning = 'GITHUB_GIT_URL no es una URL válida. El proyecto Código trabaja en local.';
      return null;
    }
    if (parsedGit.username || parsedGit.password) {
      // No se repite la URL: podría llevar credenciales.
      this.warning = 'GITHUB_GIT_URL no puede llevar credenciales: el token va solo en GITHUB_TOKEN. El proyecto Código trabaja en local.';
      return null;
    }
    if (parsedGit.protocol !== 'https:' && parsedGit.protocol !== 'file:') {
      this.warning = 'GITHUB_GIT_URL debe ser https:// (o file:// para pruebas). El proyecto Código trabaja en local.';
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
    this.settings = { owner, name, repo, baseBranch, apiUrl, gitUrl, htmlUrl };
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

  // ── git contra el remoto ───────────────────────────────────

  /**
   * git con autenticación por entorno. Sin configuración global ni del sistema (podría reescribir
   * la URL o aportar otras credenciales) y sin ayudantes de credenciales.
   */
  private remoteGit(repo: TerminalRepo, args: string[], options: { allowFailure?: boolean } = {}) {
    const { settings } = this.api();
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TRACE_REDACT: '1',
      // Sin trazas heredadas del entorno: volcarían cabeceras a stderr o a un fichero.
      GIT_TRACE: undefined,
      GIT_TRACE_CURL: undefined,
      GIT_TRACE_PACKET: undefined,
      GIT_CURL_VERBOSE: undefined,
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      ...gitAuthEnv(settings.gitUrl, this.#token ?? ''),
    };
    return repo.git(['-c', 'credential.helper=', '-c', 'core.askPass=', ...args], {
      ...options,
      env,
      timeout: GIT_REMOTE_TIMEOUT_MS,
    });
  }

  async useRemote(repo: TerminalRepo): Promise<void> {
    await repo.setRemote(this.api().settings.gitUrl);
  }

  /** Referencias del remoto: `refs/heads/main` → sha. */
  async remoteRefs(repo: TerminalRepo): Promise<Map<string, string>> {
    const { stdout } = await this.remoteGit(repo, ['ls-remote', 'origin']);
    const refs = new Map<string, string>();
    for (const line of stdout.split('\n')) {
      const [sha, ref] = line.trim().split(/\s+/);
      if (sha && ref) refs.set(ref, sha);
    }
    return refs;
  }

  /**
   * Guarda destructiva: el remoto está vacío o su rama base tiene el marcador en la raíz. Lanza
   * `GuardError` si no. Se llama antes de cada operación que reescribe o borra algo en GitHub, y esa
   * operación usa `lease()` con las referencias devueltas para no tocar nada que haya cambiado después.
   */
  async assertDemoRepo(repo: TerminalRepo): Promise<DemoRepoCheck> {
    const { octokit, settings } = this.api();
    const refs = await this.remoteRefs(repo);
    if (refs.size === 0) return { empty: true, refs };
    const refused = new GuardError(
      `El repositorio ${settings.repo} no está vacío y su rama ${settings.baseBranch} no tiene el fichero ${MARKER_FILE}. ` +
        'Para no tocar un repositorio ajeno, el proyecto Código trabaja en local. ' +
        'Usa un repositorio vacío dedicado a la demo (sin README, .gitignore ni licencia).',
    );
    const baseSha = refs.get(`refs/heads/${settings.baseBranch}`);
    if (!baseSha) throw refused;
    try {
      // El marcador se busca en el commit exacto que ve git, no en la rama por nombre: si el remoto de
      // git (GITHUB_GIT_URL) y el repositorio de la API no son el mismo, ese commit no existe en la API
      // y la guarda no pasa.
      const { data } = await octokit.repos.getContent({
        owner: settings.owner,
        repo: settings.name,
        path: MARKER_FILE,
        ref: baseSha,
        ...requestOptions(),
      });
      if (Array.isArray(data) || data.type !== 'file') throw refused;
    } catch (error) {
      const status = statusOf(error);
      if (error instanceof GuardError || status === 404 || status === 422) throw refused;
      throw error;
    }
    return { empty: false, refs };
  }

  /** Trae la rama base a `refs/remotes/origin/<base>`. No cambia nada local salvo esa referencia. */
  async fetchBase(repo: TerminalRepo): Promise<void> {
    const { settings } = this.api();
    const base = settings.baseBranch;
    await this.remoteGit(repo, ['fetch', '--no-tags', '--prune', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  }

  /** Deja `main` local igual que la rama base del remoto. */
  async syncMain(repo: TerminalRepo): Promise<void> {
    const base = this.api().settings.baseBranch;
    await this.fetchBase(repo);
    await repo.git(['checkout', '-q', '-f', 'main']);
    await repo.git(['reset', '-q', '--hard', `refs/remotes/origin/${base}`]);
  }

  /** Sube `main` local a la rama base sin forzar (solo avance rápido). */
  async pushMain(repo: TerminalRepo): Promise<void> {
    const base = this.api().settings.baseBranch;
    await this.remoteGit(repo, ['push', '--porcelain', 'origin', `refs/heads/main:refs/heads/${base}`]);
  }

  /**
   * Sube una rama de arreglo. Si en GitHub ya hay una rama con ese nombre y otro contenido (restos
   * de una ejecución anterior), solo la sobrescribe si el repositorio pasa la guarda.
   */
  async pushBranch(repo: TerminalRepo, branch: string): Promise<void> {
    const { settings } = this.api();
    if (branch === settings.baseBranch) {
      throw new Error(`La rama ${branch} es la rama base de ${settings.repo}: el arreglo tiene que ir en una rama propia.`);
    }
    const ref = `refs/heads/${branch}`;
    const refspec = `${ref}:${ref}`;
    const push = await this.remoteGit(repo, ['push', '--porcelain', 'origin', refspec], { allowFailure: true });
    if (push.code === 0) return;
    const output = `${push.stdout}\n${push.stderr}`;
    if (!/rejected|non-fast-forward|fetch first|stale info/i.test(output)) {
      throw new Error(`git push: ${output.trim()}`);
    }
    const check = await this.assertDemoRepo(repo);
    await this.remoteGit(repo, ['push', '--porcelain', lease(ref, check), 'origin', refspec]);
  }

  /**
   * Devuelve el remoto al punto de partida: PRs de la demo cerrados, sus ramas borradas y la rama base
   * con el contenido de la plantilla (el `main` local recién creado). Cada paso pasa la guarda justo
   * antes, y los de git reescriben o borran solo si la referencia sigue donde la vio la guarda. La rama
   * base se reescribe al final para que todas las comprobaciones miren el mismo commit con marcador.
   */
  async resetRemote(repo: TerminalRepo): Promise<void> {
    const { octokit, settings } = this.api();
    const base = settings.baseBranch;
    const baseRef = `refs/heads/${base}`;

    const initial = await this.assertDemoRepo(repo);
    if (!initial.empty) {
      const { data: pulls } = await octokit.pulls.list({
        owner: settings.owner,
        repo: settings.name,
        state: 'all',
        per_page: 100,
        ...requestOptions(),
      });
      const demoPulls = pulls.filter((pull) => (pull.body ?? '').includes(PR_MARKER));

      for (const pull of demoPulls.filter((p) => p.state === 'open')) {
        await this.assertDemoRepo(repo);
        await octokit.pulls.update({
          owner: settings.owner,
          repo: settings.name,
          pull_number: pull.number,
          state: 'closed',
          ...requestOptions(),
        });
      }

      const branches = new Set(
        demoPulls
          .filter((pull) => pull.head?.repo?.full_name?.toLowerCase() === settings.repo.toLowerCase())
          .map((pull) => pull.head.ref)
          .filter((ref) => ref && ref !== base),
      );
      for (const branch of branches) {
        const ref = `refs/heads/${branch}`;
        const check = await this.assertDemoRepo(repo);
        if (!check.refs.has(ref)) continue;
        await this.remoteGit(repo, ['push', '--porcelain', lease(ref, check), 'origin', '--delete', ref]);
      }
    }

    const check = await this.assertDemoRepo(repo);
    await this.remoteGit(repo, ['push', '--porcelain', lease(baseRef, check), 'origin', `refs/heads/main:${baseRef}`]);
    await this.fetchBase(repo);
  }

  // ── Pull requests ──────────────────────────────────────────

  /** Crea el PR, o actualiza título y cuerpo si ya había uno abierto para la rama. */
  async openPull(input: { number?: number; branch: string; title: string; body: string }): Promise<GitHubPullRequest> {
    const { octokit, settings } = this.api();
    const common = { owner: settings.owner, repo: settings.name };

    let number = input.number;
    if (number) {
      const { data } = await octokit.pulls.get({ ...common, pull_number: number, ...requestOptions() });
      if (data.state !== 'open') number = undefined;
    }
    if (!number) {
      const { data: existing } = await octokit.pulls.list({
        ...common,
        state: 'open',
        head: `${settings.owner}:${input.branch}`,
        per_page: 10,
        ...requestOptions(),
      });
      number = existing.find((pull) => pull.head?.ref === input.branch)?.number;
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
    // Justo después del push, GitHub a veces aún no reconoce la rama (422): se reintenta un par de veces.
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

  /** Fusiona con un commit de merge. Con `sha`, solo si la rama sigue en el commit revisado. */
  async mergePull(number: number, input: { sha?: string; title: string }): Promise<string | undefined> {
    const { octokit, settings } = this.api();
    const { data } = await octokit.pulls.merge({
      owner: settings.owner,
      repo: settings.name,
      pull_number: number,
      merge_method: 'merge',
      commit_title: input.title,
      ...(input.sha ? { sha: input.sha } : {}),
      ...requestOptions(),
    });
    return data.sha;
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
