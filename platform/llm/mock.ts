/**
 * Proveedor simulado: sin red. Ejecuta el guion registrado para cada agente y estima
 * tokens y coste como si fuera real, para que la consola cuente la misma historia.
 */
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  MockScript,
  MockToolResult,
  MockTurn,
  PlatformApi,
} from '../contracts.ts';
import { costUsd, type ModelsConfig } from '../models.ts';
import { sleep } from '../util.ts';

export interface MockLlmClient extends LlmClient {
  /** El runtime lo llama tras cada tanda de herramientas (§ 4.12). */
  recordToolResults(caseId: string, results: MockToolResult[]): void;
}

export interface MockOptions {
  models: ModelsConfig;
  platform: PlatformApi;
  latencyMs: number;
  fast: boolean;
}

export function createMockClient({ models, platform, latencyMs, fast }: MockOptions): MockLlmClient {
  const scripts = new Map<string, MockScript>();
  /** caseId → tandas de resultados de la ejecución en curso. */
  const batches = new Map<string, MockToolResult[][]>();

  return {
    provider: 'mock',
    label: 'Simulado · sin IA real',
    modelFor: (tier) => models.tiers[tier].anthropic,

    registerMock(agentId, script) {
      scripts.set(agentId, script);
    },

    recordToolResults(caseId, results) {
      const list = batches.get(caseId) ?? [];
      list.push(results);
      batches.set(caseId, list);
    },

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const startedAt = Date.now();
      if (request.turn === 0) batches.set(request.caseId, []);

      const delay = fast ? 0 : latencyMs;
      if (delay > 0) await sleep(delay);

      const caseRecord = platform.cases.get(request.caseId);
      if (!caseRecord) throw new Error(`Modo simulado: caso no encontrado ${request.caseId}`);

      const script = scripts.get(request.agentId);
      let turn: MockTurn;
      if (!script) {
        turn = { text: 'Modo simulado: este agente no tiene guion.' };
      } else {
        const history = batches.get(request.caseId) ?? [];
        turn = await script({
          agentId: request.agentId,
          caseRecord,
          turn: request.turn,
          task: request.task,
          lastResults: request.turn > 0 ? (history.at(-1) ?? []) : [],
          allResults: history.flat(),
          platform,
        });
      }

      const calls = turn.toolCalls ?? [];
      const content: Anthropic.ContentBlockParam[] = [];
      if (turn.text) content.push({ type: 'text', text: turn.text });
      for (const call of calls) {
        content.push({
          type: 'tool_use',
          id: `toolu_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          name: call.name,
          input: call.input ?? {},
        });
      }
      if (content.length === 0) content.push({ type: 'text', text: 'Fin del guion simulado.' });

      const inputChars = request.system.length + JSON.stringify(request.messages).length + JSON.stringify(request.tools).length;
      const outputChars = JSON.stringify(content).length;
      const inputTokens = Math.ceil(inputChars / 4);
      const outputTokens = Math.ceil(outputChars / 4) + 40;

      return {
        content,
        stopReason: calls.length > 0 ? 'tool_use' : 'end_turn',
        model: `${models.tiers[request.tier].anthropic} (simulado)`,
        usage: { inputTokens, outputTokens },
        costUsd: costUsd(models, request.tier, inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
