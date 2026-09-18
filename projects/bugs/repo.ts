/**
 * Mini-repositorio real de `terminal-pagos` en `<dataDir>/repos/terminal-pagos`.
 *
 * Todo pasa por git y node de verdad, siempre con `execFile` (sin shell). El repositorio
 * tiene un único directorio de trabajo, así que las operaciones se serializan con
 * `exclusive()` y cualquier operación sobre una rama vuelve a dejar `main` al terminar.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PlatformApi } from '../../platform/contracts.ts';
import { childEnv, redact } from './redact.ts';
import { COMPONENT, type TestSummary } from './state.ts';

const TEMPLATE_DIR = fileURLToPath(new URL('./template/', import.meta.url));

/** Comando de tests tal y como se enseña al modelo y en la consola. */
export const TEST_COMMAND = 'node --import tsx --test test/*.test.ts';

const GIT_CONFIG = [
  '-c', 'user.name=Agente de código',
  '-c', 'user.email=agente@demo.local',
  '-c', 'commit.gpgsign=false',
];

/**
 * Cargador de tsx resuelto desde este proyecto: los tests funcionan aunque `dataDir`
 * no cuelgue de la raíz. Si no se puede resolver, se usa el nombre del paquete.
 */
const TSX_LOADER = (() => {
  try {
    return import.meta.resolve('tsx');
  } catch {
    return 'tsx';
  }
})();

const TEST_TIMEOUT_MS = 60_000;
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

export interface TestRun extends TestSummary {
  /** Nombres de los tests que fallan. */
  failures: string[];
}

export interface RepoFile {
  path: string;
  lines: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitRun extends ExecResult {
  args: string[];
}

/** Ejecuciones de git tal cual, antes de limpiar secretos. Solo para comprobaciones (github-check.ts). */
let gitObserver: ((run: GitRun) => void) | undefined;
export function setGitObserver(observer: ((run: GitRun) => void) | undefined): void {
  gitObserver = observer;
}

function exec(
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout?: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env: options.env, timeout: options.timeout, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        // Con código de salida numérico el proceso llegó a ejecutarse y su salida ya lo explica;
        // si no (git o node no encontrados, proceso matado), se añade el mensaje del error.
        const exited = typeof error.code === 'number';
        const killed = error.killed
          ? `\nProceso detenido: ha superado el tiempo máximo de ${Math.round((options.timeout ?? 0) / 1000)} s.`
          : '';
        resolve({
          code: exited ? (error.code as number) : 1,
          stdout: stdout ?? '',
          stderr: `${stderr || (exited ? '' : error.message)}${killed}`,
        });
      },
    );
  });
}

const toPosix = (p: string) => p.split(path.sep).join('/');
const countLines = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

export class TerminalRepo {
  readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'repos', COMPONENT);
  }

  /** Ejecuta la tarea en exclusiva: nunca hay dos operaciones a la vez sobre el repositorio. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Ejecuta git en el repositorio. El entorno va sin secretos salvo lo que se pase en `env` (la
   * cabecera de autenticación de GitHub, que nunca va en los argumentos), y la salida se devuelve
   * ya limpia de secretos.
   */
  async git(
    args: string[],
    options: { allowFailure?: boolean; env?: NodeJS.ProcessEnv; timeout?: number } = {},
  ): Promise<ExecResult> {
    // Salvaguarda: sin un .git propio no se ejecuta nada (salvo init), para no tocar nunca
    // un repositorio padre. GIT_CEILING_DIRECTORIES impide además subir de directorio.
    const command = args.find((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-c') ?? args[0];
    if (command !== 'init' && !existsSync(path.join(this.dir, '.git'))) {
      throw new Error(`No hay repositorio git en ${this.dir}`);
    }
    const fullArgs = [...GIT_CONFIG, ...args];
    const raw = await exec('git', fullArgs, {
      cwd: this.dir,
      env: childEnv({ GIT_CEILING_DIRECTORIES: path.dirname(this.dir), GIT_TERMINAL_PROMPT: '0', ...options.env }),
      timeout: options.timeout,
    });
    gitObserver?.({ ...raw, args: fullArgs });
    const result: ExecResult = { code: raw.code, stdout: redact(raw.stdout), stderr: redact(raw.stderr) };
    if (result.code !== 0 && !options.allowFailure) {
      throw new Error(`git ${command}: ${(result.stderr || result.stdout).trim()}`);
    }
    return result;
  }

  /** Copia la plantilla desde cero y hace el commit inicial en `main`. */
  async recreate(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(path.dirname(this.dir), { recursive: true });
    await cp(TEMPLATE_DIR, this.dir, { recursive: true });
    const version = await this.readVersion();
    await this.git(['init', '-q', '-b', 'main']);
    await this.git(['add', '-A']);
    await this.git(['commit', '-q', '-m', `${COMPONENT} ${version}`]);
  }

  async isReady(): Promise<boolean> {
    if (!existsSync(path.join(this.dir, '.git'))) return false;
    const result = await this.git(['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { allowFailure: true });
    return result.code === 0;
  }

  async branches(): Promise<string[]> {
    const { stdout } = await this.git(['branch', '--format=%(refname:short)']);
    const names = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    return ['main', ...names.filter((name) => name !== 'main').sort()];
  }

  async branchExists(branch: string): Promise<boolean> {
    const result = await this.git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
    return result.code === 0;
  }

  async checkoutMain(): Promise<void> {
    await this.git(['checkout', '-q', '-f', 'main']);
  }

  /** Pone la rama en el directorio de trabajo, ejecuta la tarea y vuelve siempre a `main`. */
  async onBranch<T>(branch: string, task: () => Promise<T>): Promise<T> {
    if (branch === 'main') return task();
    await this.git(['checkout', '-q', '-f', branch]);
    try {
      return await task();
    } catch (error) {
      // Deja la rama como estaba: sin cambios a medio escribir.
      await this.git(['reset', '-q', '--hard'], { allowFailure: true });
      await this.git(['clean', '-fdq'], { allowFailure: true });
      throw error;
    } finally {
      await this.checkoutMain();
    }
  }

  async diff(branch: string): Promise<string> {
    const { stdout } = await this.git(['diff', `main...${branch}`]);
    return stdout;
  }

  async headCommit(): Promise<string> {
    const { stdout } = await this.git(['rev-parse', '--short', 'HEAD']);
    return stdout.trim();
  }

  /** SHA completo de una referencia (rama, `HEAD`…). */
  async sha(ref: string): Promise<string> {
    const { stdout } = await this.git(['rev-parse', '--verify', `${ref}^{commit}`]);
    return stdout.trim();
  }

  /** Apunta `origin` a la URL indicada (sin credenciales: la autenticación va por entorno). */
  async setRemote(url: string): Promise<void> {
    const current = await this.git(['remote', 'get-url', 'origin'], { allowFailure: true });
    if (current.code !== 0) await this.git(['remote', 'add', 'origin', url]);
    else if (current.stdout.trim() !== url) await this.git(['remote', 'set-url', 'origin', url]);
  }

  async removeRemote(): Promise<void> {
    await this.git(['remote', 'remove', 'origin'], { allowFailure: true });
  }

  /** Ruta absoluta dentro del repositorio. Lanza si sale de él o apunta a `.git`. */
  resolve(relativePath: unknown): string {
    const clean = typeof relativePath === 'string' ? relativePath.trim() : '';
    if (!clean) throw new Error('Ruta vacía');
    const absolute = path.resolve(this.dir, clean);
    const relative = path.relative(this.dir, absolute);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Ruta fuera del repositorio: ${clean}`);
    }
    if (IGNORED_DIRS.has(relative.split(path.sep)[0])) {
      throw new Error(`Ruta no permitida: ${clean}`);
    }
    return absolute;
  }

  /** Ruta relativa normalizada (con `/`) de una ruta ya validada. */
  relative(relativePath: unknown): string {
    return toPosix(path.relative(this.dir, this.resolve(relativePath)));
  }

  async listFiles(): Promise<RepoFile[]> {
    const files: RepoFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          files.push({ path: toPosix(path.relative(this.dir, full)), lines: countLines(await readFile(full, 'utf8')) });
        }
      }
    };
    await walk(this.dir);
    return files;
  }

  async readText(relativePath: unknown): Promise<string> {
    const absolute = this.resolve(relativePath);
    try {
      return await readFile(absolute, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new Error(`No existe el fichero: ${String(relativePath)}`);
      if (code === 'EISDIR') throw new Error(`Es un directorio, no un fichero: ${String(relativePath)}`);
      throw error;
    }
  }

  async writeFiles(files: { path: string; content: string }[]): Promise<void> {
    for (const file of files) {
      const absolute = this.resolve(file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content, 'utf8');
    }
  }

  async search(query: string, limit = 60): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
    const needle = query.toLowerCase();
    const matches: SearchMatch[] = [];
    for (const file of await this.listFiles()) {
      const lines = (await readFile(path.join(this.dir, file.path), 'utf8')).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        if (matches.length >= limit) return { matches, truncated: true };
        matches.push({ path: file.path, line: i + 1, text: lines[i].trim() });
      }
    }
    return { matches, truncated: false };
  }

  async readVersion(): Promise<string> {
    const pkg = JSON.parse(await readFile(path.join(this.dir, 'package.json'), 'utf8')) as { version?: string };
    if (!pkg.version) throw new Error('package.json no tiene versión');
    return pkg.version;
  }

  /** Cambia solo el campo `version` de package.json, respetando el formato. */
  async writeVersion(version: string): Promise<void> {
    const file = path.join(this.dir, 'package.json');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`), 'utf8');
  }

  /** Ejecuta los tests sobre lo que haya en el directorio de trabajo. */
  async runTests(): Promise<TestRun> {
    // Sin secretos en el entorno: el código de los tests lo escribe un agente.
    const env = childEnv({ NO_COLOR: '1' });
    delete env.FORCE_COLOR;
    delete env.NODE_TEST_CONTEXT;
    const result = await exec(
      process.execPath,
      ['--import', TSX_LOADER, '--test', '--test-reporter=spec', 'test/*.test.ts'],
      { cwd: this.dir, env, timeout: TEST_TIMEOUT_MS },
    );
    const raw = `${result.stdout}\n${result.stderr}`;
    const passed = readCount(raw, 'pass') ?? 0;
    const failed = readCount(raw, 'fail') ?? (result.code === 0 ? 0 : 1);
    return { passed, failed, output: this.cleanOutput(raw), failures: readFailures(raw) };
  }

  /** Rutas relativas al repositorio y sin las líneas internas de node en las trazas. */
  private cleanOutput(raw: string): string {
    return redact(raw)
      .split(pathToFileURL(this.dir).href).join('.')
      .split(this.dir).join('.')
      .split('\n')
      .filter((line) => !/^\s+at .*(node:internal|node_modules)/.test(line))
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 8000);
  }
}

function readCount(output: string, label: string): number | undefined {
  const match = new RegExp(`^[ℹ#] ${label} (\\d+)\\s*$`, 'm').exec(output);
  return match ? Number(match[1]) : undefined;
}

function readFailures(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    const match = /^\s*✖ (.+) \([\d.]+m?s\)\s*$/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names];
}

const repos = new Map<string, TerminalRepo>();

export function repoFor(platform: PlatformApi): TerminalRepo {
  let repo = repos.get(platform.dataDir);
  if (!repo) {
    repo = new TerminalRepo(platform.dataDir);
    repos.set(platform.dataDir, repo);
  }
  return repo;
}

/** Ruta del repositorio para la consola: relativa a la raíz del proyecto si cuelga de ella. */
export function displayPath(platform: PlatformApi): string {
  const dir = repoFor(platform).dir;
  const relative = path.relative(platform.rootDir, dir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? toPosix(relative) : dir;
}
