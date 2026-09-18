/**
 * Proveedor Claude en Amazon Bedrock (cliente Mantle, API de Messages).
 * Mismos parámetros que la Claude API pero SIN betas ni fallbacks (no existen en Bedrock).
 * Credenciales: cadena estándar de AWS.
 */
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { LlmClient, LlmRequest, LlmResponse, ModelTier } from '../contracts.ts';
import type { ModelsConfig } from '../models.ts';
import { explainApiError, toLlmResponse } from './anthropic.ts';

export function createBedrockClient(models: ModelsConfig): LlmClient {
  const awsRegion = models.bedrock.region ?? process.env.AWS_REGION;
  const client = new AnthropicBedrockMantle({ awsRegion });
  const modelFor = (tier: ModelTier) => models.tiers[tier].bedrock;

  return {
    provider: 'bedrock',
    label: `Amazon Bedrock · ${modelFor('reasoning')}`,
    modelFor,
    registerMock() {
      // Los guiones solo se usan en modo simulado.
    },

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const model = modelFor(request.tier);
      const startedAt = Date.now();
      try {
        const message = await client.messages.create({
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          tools: request.tools,
          ...(request.tier === 'reasoning'
            ? {
                thinking: { type: 'adaptive' as const },
                ...(request.effort ? { output_config: { effort: request.effort } } : {}),
              }
            : {}),
        });
        return toLlmResponse(message, models, request.tier, startedAt);
      } catch (err) {
        throw explainApiError(err, `Amazon Bedrock (${awsRegion ?? 'sin región'})`);
      }
    },
  };
}
