/**
 * Proyecto soporte: bandeja de tickets de las tiendas.
 * Reglas para lo repetitivo, un agente rápido para lo que pide criterio y una defensa en capas
 * frente a tickets que intentan manipularlo.
 */
import type { PlatformApi, ProjectModule } from '../../platform/contracts.ts';
import { soporteMock } from './mock.ts';
import { injectionSuspected } from './predicates.ts';
import { soporteRules } from './rules.ts';
import { soporteScenarios } from './scenarios.ts';
import { AGENT_ID, PROJECT_ID, emptyState, loadState, saveState, siteLabel } from './state.ts';
import { soporteTools } from './tools.ts';

function snapshot(platform: PlatformApi) {
  const tickets = [...loadState(platform).tickets]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((t) => ({
      id: t.id,
      from: t.from,
      siteId: t.siteId,
      clientId: t.clientId,
      siteLabel: siteLabel(platform, t),
      subject: t.subject,
      body: t.body,
      receivedAt: t.receivedAt,
      category: t.category,
      priority: t.priority,
      status: t.status,
      draftReply: t.draftReply,
      sentReply: t.sentReply,
      injectionDetected: t.injectionDetected,
      injectionPatterns: t.injectionPatterns?.map((p) => p.label),
      escalationReason: t.escalationReason,
      caseId: t.caseId,
    }));
  return { tickets };
}

export const soporte: ProjectModule = {
  id: PROJECT_ID,
  name: 'Soporte',
  description:
    'Bandeja de tickets de las tiendas: reglas para las preguntas frecuentes, un agente para lo que pide criterio ' +
    'y defensa en capas ante tickets que intentan manipularlo.',
  tools: soporteTools,
  rules: soporteRules,
  predicates: { injection_suspected: injectionSuspected },
  mocks: { [AGENT_ID]: soporteMock },
  scenarios: soporteScenarios,
  async init(platform) {
    loadState(platform);
  },
  async reset(platform) {
    saveState(platform, emptyState());
  },
  snapshot,
};
