/** config/models.yaml: los agentes piden un tier; aquí se resuelve el modelo y la tarifa. */
import { join } from 'node:path';
import type { LlmProviderId, ModelTier } from './contracts.ts';
import { readYamlFile } from './util.ts';

export interface TierConfig {
  anthropic: string;
  bedrock: string;
  /** USD por millón de tokens. */
  pricing: { input: number; output: number };
}

export interface ModelsConfig {
  tiers: Record<ModelTier, TierConfig>;
  bedrock: { region?: string };
}

export function loadModelsConfig(rootDir: string): ModelsConfig {
  const path = join(rootDir, 'config', 'models.yaml');
  const raw = readYamlFile(path) ?? {};
  const tier = (name: ModelTier): TierConfig => {
    const t = raw.tiers?.[name];
    if (!t?.anthropic || !t?.bedrock) throw new Error(`${path}: falta el tier "${name}" con anthropic y bedrock`);
    return {
      anthropic: String(t.anthropic),
      bedrock: String(t.bedrock),
      pricing: { input: Number(t.pricing?.input ?? 0), output: Number(t.pricing?.output ?? 0) },
    };
  };
  return {
    tiers: { reasoning: tier('reasoning'), fast: tier('fast') },
    bedrock: { region: raw.bedrock?.region ? String(raw.bedrock.region) : undefined },
  };
}

/** El modo simulado usa los IDs de la API de Anthropic para que las etiquetas sean realistas. */
export function modelIdFor(models: ModelsConfig, provider: LlmProviderId, tier: ModelTier): string {
  return provider === 'bedrock' ? models.tiers[tier].bedrock : models.tiers[tier].anthropic;
}

export function costUsd(models: ModelsConfig, tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const { pricing } = models.tiers[tier];
  return (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
}
