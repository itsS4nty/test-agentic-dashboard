/**
 * Manifiestos de agentes: agents/<id>/agent.yaml (snake_case) + prompt.md.
 * Añadir un agente es añadir esa carpeta; el runtime no cambia.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { AgentManifest, Effort, ManifestRegistry, ModelTier } from './contracts.ts';
import { errorMessage } from './util.ts';

const TIERS: ModelTier[] = ['reasoning', 'fast'];
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function toManifest(dirName: string, yamlText: string, prompt: string): AgentManifest {
  const raw = parse(yamlText) ?? {};
  const id = String(raw.id ?? dirName);
  if (!TIERS.includes(raw.tier)) throw new Error(`tier no válido: ${raw.tier} (reasoning | fast)`);
  if (raw.effort !== undefined && !EFFORTS.includes(raw.effort)) throw new Error(`effort no válido: ${raw.effort}`);

  return {
    id,
    name: String(raw.name ?? id),
    description: String(raw.description ?? ''),
    version: Number(raw.version ?? 1),
    project: String(raw.project ?? ''),
    tier: raw.tier,
    ...(raw.effort ? { effort: raw.effort as Effort } : {}),
    maxTurns: Number(raw.max_turns ?? 10),
    budget: {
      tokensPerCase: Number(raw.budget?.tokens_per_case ?? 80000),
      usdPerCase: Number(raw.budget?.usd_per_case ?? 0.6),
    },
    tools: (Array.isArray(raw.tools) ? raw.tools : []).map(String),
    ...(raw.owner ? { owner: String(raw.owner) } : {}),
    prompt,
    manifestPath: `agents/${dirName}/agent.yaml`,
    manifestYaml: yamlText,
  };
}

export function createManifestRegistry(rootDir: string): ManifestRegistry {
  const agentsDir = join(rootDir, 'agents');
  let manifests = new Map<string, AgentManifest>();

  function reload(): void {
    const next = new Map<string, AgentManifest>();
    const dirs = existsSync(agentsDir)
      ? readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
      : [];
    for (const dir of dirs) {
      const yamlPath = join(agentsDir, dir, 'agent.yaml');
      if (!existsSync(yamlPath)) continue;
      try {
        const promptPath = join(agentsDir, dir, 'prompt.md');
        const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
        if (!prompt) console.warn(`[manifiestos] agents/${dir} no tiene prompt.md`);
        const manifest = toManifest(dir, readFileSync(yamlPath, 'utf8'), prompt);
        next.set(manifest.id, manifest);
      } catch (err) {
        console.error(`[manifiestos] agents/${dir}/agent.yaml no es válido: ${errorMessage(err)}`);
      }
    }
    manifests = next;
  }

  reload();

  return {
    list: () => [...manifests.values()],
    get(id) {
      // Si alguien acaba de añadir la carpeta del agente, se recoge sin reiniciar.
      if (!manifests.has(id)) reload();
      return manifests.get(id);
    },
    reload,
  };
}
