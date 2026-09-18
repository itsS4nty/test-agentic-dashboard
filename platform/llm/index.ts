/** Un `LlmClient` por proceso. Los SDK reales se cargan solo si se usan. */
import type { LlmClient, LlmProviderId, PlatformApi } from '../contracts.ts';
import type { ModelsConfig } from '../models.ts';
import { createMockClient } from './mock.ts';

const PROVIDERS: LlmProviderId[] = ['mock', 'anthropic', 'bedrock'];

/** `explicit` → LLM_PROVIDER → `anthropic` si hay ANTHROPIC_API_KEY → `mock`. */
export function resolveProvider(explicit?: LlmProviderId): LlmProviderId {
  const chosen = explicit ?? (process.env.LLM_PROVIDER?.trim() || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'));
  if (!PROVIDERS.includes(chosen as LlmProviderId)) {
    throw new Error(`Proveedor de IA no válido: "${chosen}". Usa mock, anthropic o bedrock.`);
  }
  return chosen as LlmProviderId;
}

export interface LlmClientOptions {
  provider: LlmProviderId;
  models: ModelsConfig;
  platform: PlatformApi;
  mockLatencyMs: number;
  fast: boolean;
}

export async function createLlmClient(opts: LlmClientOptions): Promise<LlmClient> {
  switch (opts.provider) {
    case 'anthropic': {
      const { createAnthropicClient } = await import('./anthropic.ts');
      return createAnthropicClient(opts.models);
    }
    case 'bedrock': {
      const { createBedrockClient } = await import('./bedrock.ts');
      return createBedrockClient(opts.models);
    }
    case 'mock':
      return createMockClient({ models: opts.models, platform: opts.platform, latencyMs: opts.mockLatencyMs, fast: opts.fast });
  }
}
