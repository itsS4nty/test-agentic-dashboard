/**
 * Git y GitHub para el agente creador. Trabaja en ramas agente/<id> de ESTE repo, en copias de
 * trabajo (git worktree) bajo <dataDir>/worktrees. Sobre el remoto: solo sube ramas agente/*,
 * nunca force-push ni push a la rama base; PR y fusión por la API.
 */
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';
import { childEnv, redact, registerSecret } from '../bugs/redact.ts';

const run = promisify(execFile);

export async function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await run(
      'git',
      ['-c', 'user.name=Agente creador', '-c', 'user.email=creador@demo.local', ...args],
      { cwd, env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0', ...extraEnv }, maxBuffer: 20_000_000 },
    );
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(redact((e.stderr || e.message).trim()));
  }
}

export interface GitHubTarget {
  owner: string;
  repo: string;
  token: string;
}

/** GitHub si origin apunta a github.com, hay GITHUB_TOKEN y no está desactivado. */
export async function githubTarget(rootDir: string): Promise<GitHubTarget | null> {
  if (process.env.DEMO_GITHUB === 'off' || process.env.CREADOR_GITHUB === 'off') return null;
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const url = await git(rootDir, ['remote', 'get-url', 'origin']).catch(() => '');
  const m = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  registerSecret(token);
  return { owner: m[1], repo: m[2], token };
}

/** Cabecera de autenticación por variables de entorno de git: nunca en argumentos ni en la URL. */
export function authEnv(token: string): NodeJS.ProcessEnv {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: header,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
  };
}

export async function pushBranch(worktree: string, branch: string, target: GitHubTarget): Promise<void> {
  if (!branch.startsWith('agente/')) throw new Error(`Solo se suben ramas agente/*: ${branch}`);
  await git(worktree, ['push', 'origin', `${branch}:refs/heads/${branch}`], authEnv(target.token));
}

export function octokit(target: GitHubTarget): Octokit {
  return new Octokit({ auth: target.token, userAgent: 'agentes-demo' });
}

export function clean(text: string): string {
  return redact(text);
}
