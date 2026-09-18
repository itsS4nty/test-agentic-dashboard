/**
 * Arranque de la plataforma. Quien arranca registra después los proyectos:
 *   for (const p of allProjects) await platform.projects.register(p)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CreatePlatformOptions, PlatformApi } from './contracts.ts';
import { createApprovalService } from './approvals.ts';
import { createCaseService } from './cases.ts';
import { createDirectory } from './directory.ts';
import { createEventBus } from './events.ts';
import { createLlmClient, resolveProvider } from './llm/index.ts';
import { createManifestRegistry } from './manifests.ts';
import { computeMetrics } from './metrics.ts';
import { loadModelsConfig } from './models.ts';
import { createNotificationService } from './notifications.ts';
import { createPolicyEngine } from './policy.ts';
import { createProjectRegistry } from './projects.ts';
import { createRuleEngine } from './rules.ts';
import { createRuntime } from './runtime.ts';
import { createStore } from './store.ts';
import { createToolRegistry } from './tools.ts';
import { errorMessage, nowIso } from './util.ts';

type PlatformAssembly = { -readonly [K in keyof PlatformApi]: PlatformApi[K] };

function loadEnv(rootDir: string): void {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[plataforma] No se ha podido leer ${envPath}: ${errorMessage(err)}`);
  }
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Un caso restaurado en `running` quedó a medias al parar el proceso y ninguna ejecución lo va a
 * retomar: se marca `failed` con una entrada de error, igual que una excepción del runtime.
 */
function failInterruptedRuns(platform: PlatformApi): void {
  for (const record of platform.cases.list({ status: 'running' })) {
    platform.cases.addTimeline(record.id, {
      kind: 'error',
      title: 'Ejecución interrumpida: el servidor se paró mientras el agente trabajaba',
      detail: 'Nadie va a retomar esta ejecución. Vuelve a lanzar el escenario o reinicia la demo.',
      actor: 'agent',
      agentId: record.agentId,
    });
    platform.cases.update(record.id, { status: 'failed' });
  }
}

export async function createPlatform(opts: CreatePlatformOptions): Promise<PlatformApi> {
  const rootDir = resolve(opts.rootDir);
  const dataDir = resolve(opts.dataDir ?? join(rootDir, 'data'));
  loadEnv(rootDir);

  const provider = resolveProvider(opts.provider);
  const fast = opts.fast ?? false;
  const inMemory = opts.inMemory ?? false;
  const mockLatencyMs = opts.mockLatencyMs ?? envNumber('MOCK_LATENCY_MS') ?? 700;
  const models = loadModelsConfig(rootDir);
  if (!inMemory) mkdirSync(dataDir, { recursive: true });

  // Los servicios reciben la plataforma y leen sus dependencias en el momento de usarlas.
  const platform = { rootDir, dataDir, startedAt: nowIso(), fast } as PlatformAssembly;
  platform.events = createEventBus();
  platform.store = createStore({ filePath: inMemory ? undefined : join(dataDir, 'state.json') });
  platform.directory = createDirectory(rootDir);
  platform.notifications = createNotificationService(platform);
  platform.cases = createCaseService(platform);
  platform.tools = createToolRegistry(platform);
  platform.policy = createPolicyEngine(platform);
  platform.approvals = createApprovalService(platform);
  platform.rules = createRuleEngine(platform);
  platform.manifests = createManifestRegistry(rootDir);
  platform.llm = await createLlmClient({ provider, models, platform, mockLatencyMs, fast });
  platform.runtime = createRuntime(platform);
  platform.projects = createProjectRegistry(platform);
  platform.metrics = () => computeMetrics(platform);
  if (!inMemory) failInterruptedRuns(platform);

  platform.reset = async () => {
    platform.store.clear();
    platform.policy.reset();
    for (const project of platform.projects.list()) {
      try {
        await project.reset?.(platform);
      } catch (err) {
        console.error(`[plataforma] Error al reiniciar el proyecto ${project.id}:`, err);
      }
    }
    platform.events.emit({ type: 'reset' });
  };

  platform.shutdown = async () => {
    for (const project of platform.projects.list()) {
      try {
        project.stop?.();
      } catch (err) {
        console.error(`[plataforma] Error al parar el proyecto ${project.id}:`, err);
      }
    }
    await platform.store.flush();
  };

  return platform;
}
