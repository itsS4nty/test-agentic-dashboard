/**
 * Estado del proyecto de código: versión publicada, ramas y pull requests.
 * Vive en el store con la clave `bugs` y es lo que pinta la vista "Código".
 */
import type { PlatformApi } from '../../platform/contracts.ts';

export const PROJECT_ID = 'bugs';
export const AGENT_ID = 'bugs';
export const COMPONENT = 'terminal-pagos';

const STATE_KEY = 'bugs';

export interface TestSummary {
  passed: number;
  failed: number;
  output: string;
}

/**
 * Resultado de la CI del repositorio para el último commit del PR. `none` es lo normal en la demo:
 * no añade ninguna CI, así que el commit no tiene comprobaciones. Nunca es `failure` por no haberlas.
 */
export type CiStatus = 'none' | 'pending' | 'success' | 'failure';

/** Datos del PR en GitHub (solo en modo GitHub). */
export interface GitHubPullRequest {
  number: number;
  url: string;
  ci: CiStatus;
}

export interface PullRequest {
  id: string;
  title: string;
  branch: string;
  /** `closed`: cerrado sin fusionar (desde GitHub). */
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  mergedAt?: string;
  closedAt?: string;
  caseId: string;
  description: string;
  diff: string;
  testsBefore: TestSummary;
  testsAfter: TestSummary;
  /** Commit de la rama que se revisó al abrir el PR; en GitHub solo se fusiona ese. */
  headSha?: string;
  github?: GitHubPullRequest;
}

export interface BugsState {
  version: string;
  branches: string[];
  prs: PullRequest[];
  /**
   * Repositorio de GitHub (`owner/nombre`) con el que se inicializó el repositorio local. Sin valor,
   * el repositorio local salió de la plantilla sin remoto (modo local).
   */
  boundRepo?: string;
  /**
   * Número del siguiente PR. Los identificadores no se reutilizan aunque se vacíe la lista al cambiar
   * de modo: una aprobación antigua de «PR-1» nunca debe fusionar otro PR con el mismo nombre.
   */
  nextPr?: number;
}

export function hasState(platform: PlatformApi): boolean {
  return platform.store.getValue<BugsState>(STATE_KEY) !== undefined;
}

export function getState(platform: PlatformApi): BugsState {
  return platform.store.getValue<BugsState>(STATE_KEY) ?? { version: '2.14.2', branches: ['main'], prs: [] };
}

/** Guarda el estado y avisa a la consola. */
export function saveState(platform: PlatformApi, patch: Partial<BugsState>): BugsState {
  const next: BugsState = { ...getState(platform), ...patch };
  platform.store.setValue(STATE_KEY, next);
  platform.projects.changed(PROJECT_ID);
  return next;
}

/** 2.14.2 → 2.14.3 */
export function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new Error(`Versión no reconocida: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** Recorta texto largo para el modelo o la traza. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (recortado, ${text.length - max} caracteres más)`;
}
