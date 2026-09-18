/**
 * Proveedor Claude API (`@anthropic-ai/sdk`). Credenciales del entorno.
 * - reasoning: beta.messages con fallbacks de servidor, thinking adaptativo y effort del manifiesto.
 * - fast: messages.create sin thinking ni output_config.
 * Nunca temperature / top_p / top_k / budget_tokens.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmRequest, LlmResponse, ModelTier } from '../contracts.ts';
import { costUsd, type ModelsConfig } from '../models.ts';

export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Lo mínimo que comparten `Message` y `BetaMessage` para construir la respuesta. */
interface ApiMessage {
  content: unknown[];
  stop_reason: string | null;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

export function toLlmResponse(message: ApiMessage, models: ModelsConfig, tier: ModelTier, startedAt: number): LlmResponse {
  const inputTokens =
    message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
  const outputTokens = message.usage.output_tokens;
  return {
    // Tal cual: incluye bloques de thinking, que hay que reenviar en el turno siguiente.
    content: message.content as Anthropic.ContentBlockParam[],
    stopReason: message.stop_reason ?? 'end_turn',
    model: message.model,
    usage: { inputTokens, outputTokens },
    costUsd: costUsd(models, tier, inputTokens, outputTokens),
    latencyMs: Date.now() - startedAt,
  };
}

/** Traduce los errores del SDK (por clase, de más a menos específica) a un mensaje claro. */
export function explainApiError(err: unknown, providerName: string): Error {
  const detail = err instanceof Error ? err.message : String(err);
  let message: string;
  if (err instanceof Anthropic.AuthenticationError) message = `credenciales no válidas (401). Revisa la configuración del proveedor.`;
  else if (err instanceof Anthropic.PermissionDeniedError) message = `sin permiso para este modelo o recurso (403): ${detail}`;
  else if (err instanceof Anthropic.NotFoundError) message = `modelo o recurso no encontrado (404): ${detail}`;
  else if (err instanceof Anthropic.RateLimitError) message = `límite de peticiones alcanzado (429). Espera unos segundos y reintenta.`;
  else if (err instanceof Anthropic.BadRequestError) message = `petición rechazada (400): ${detail}`;
  else if (err instanceof Anthropic.InternalServerError) message = `error del servicio (${err.status}): ${detail}`;
  else if (err instanceof Anthropic.APIConnectionTimeoutError) message = `tiempo de espera agotado al llamar al modelo.`;
  else if (err instanceof Anthropic.APIConnectionError) message = `no se ha podido conectar: ${detail}`;
  else if (err instanceof Anthropic.APIError) message = `error ${err.status ?? ''} de la API: ${detail}`;
  else return err instanceof Error ? err : new Error(detail);
  return new Error(`${providerName}: ${message}`, { cause: err });
}

export function createAnthropicClient(models: ModelsConfig): LlmClient {
  const client = new Anthropic();
  const modelFor = (tier: ModelTier) => models.tiers[tier].anthropic;

  return {
    provider: 'anthropic',
    label: `Claude API · ${modelFor('reasoning')}`,
    modelFor,
    registerMock() {
      // Los guiones solo se usan en modo simulado.
    },

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const model = modelFor(request.tier);
      const startedAt = Date.now();
      try {
        if (request.tier === 'reasoning') {
          const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: request.messages as Anthropic.Beta.Messages.BetaMessageParam[],
            tools: request.tools as Anthropic.Beta.Messages.BetaTool[],
            thinking: { type: 'adaptive' },
            ...(request.effort ? { output_config: { effort: request.effort } } : {}),
            betas: [SERVER_FALLBACK_BETA],
            fallbacks: 'default',
          };
          const message = await client.beta.messages.create(params);
          return toLlmResponse(message, models, request.tier, startedAt);
        }

        const message = await client.messages.create({
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          tools: request.tools,
        });
        return toLlmResponse(message, models, request.tier, startedAt);
      } catch (err) {
        throw explainApiError(err, 'Claude API');
      }
    },
  };
}
