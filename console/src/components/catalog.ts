/**
 * Catálogo compartido de datos casi estáticos: políticas (con el directorio de
 * clientes), manifiestos de agentes y reglas. Se carga una vez y se mantiene al
 * día con los eventos de `live`.
 */
import { reactive, watch } from 'vue';
import type {
  ActionPolicy,
  AgentManifest,
  AutonomyLevel,
  Client,
  PolicyConfig,
  RiskClass,
  Scope,
} from '../../../platform/contracts.ts';
import { api, type PoliciesInfo, type RuleInfo } from '../api.ts';
import { live } from '../live.ts';
import { errorMessage } from './format.ts';

export const catalog = reactive({
  policies: null as PoliciesInfo | null,
  policiesError: '',
  agents: [] as AgentManifest[],
  agentsError: '',
  rules: [] as RuleInfo[],
});

let policiesRequest: Promise<void> | undefined;
let agentsRequest: Promise<void> | undefined;

export function loadPolicies(force = false): Promise<void> {
  if (policiesRequest && !force) return policiesRequest;
  policiesRequest = api
    .policies()
    .then((info) => {
      catalog.policies = info;
      catalog.policiesError = '';
    })
    .catch((err) => {
      catalog.policiesError = errorMessage(err);
      policiesRequest = undefined;
    });
  return policiesRequest;
}

export function loadAgents(force = false): Promise<void> {
  if (agentsRequest && !force) return agentsRequest;
  agentsRequest = Promise.all([api.agents(), api.rules()])
    .then(([agents, rules]) => {
      catalog.agents = agents;
      catalog.rules = rules;
      catalog.agentsError = '';
    })
    .catch((err) => {
      catalog.agentsError = errorMessage(err);
      agentsRequest = undefined;
    });
  return agentsRequest;
}

export function setPolicyConfig(config: PolicyConfig) {
  if (catalog.policies) catalog.policies.config = config;
}

watch(
  () => live.policy,
  (config) => {
    if (config) setPolicyConfig(config);
  },
);

watch(
  () => live.resetCount,
  () => {
    if (catalog.policies) void loadPolicies(true);
  },
);

watch(
  () => live.connected,
  (connected) => {
    if (!connected) return;
    void loadPolicies(true);
    if (!catalog.agents.length) void loadAgents(true);
  },
);

// ── Directorio ──────────────────────────────────────────

export function clients(): Client[] {
  return catalog.policies?.clients ?? [];
}

export function clientName(clientId: string | undefined): string {
  if (!clientId) return '';
  return clients().find((c) => c.id === clientId)?.name ?? clientId;
}

function findSite(siteId: string) {
  for (const client of clients()) {
    const site = client.sites.find((s) => s.id === siteId);
    if (site) return { client, site };
  }
  return undefined;
}

/** "Panaderías Horno Real · Centro · DAT-01"; sin ámbito, "Global". */
export function describeScope(scope: Scope | undefined): string {
  if (!scope) return 'Global';
  const parts: string[] = [];
  const found = scope.siteId ? findSite(scope.siteId) : undefined;
  const clientId = scope.clientId ?? found?.client.id;
  if (clientId) parts.push(clientName(clientId));
  if (scope.siteId) parts.push(found?.site.name ?? scope.siteId);
  if (scope.deviceId) parts.push(scope.deviceId.split(':').pop() ?? scope.deviceId);
  return parts.length ? parts.join(' · ') : 'Global';
}

// ── Proyectos y agentes ─────────────────────────────────

const PROJECT_LABEL: Record<string, string> = {
  dispositivo: 'Dispositivos',
  bugs: 'Código',
  facturas: 'Facturas',
  soporte: 'Soporte',
};

export function projectName(projectId: string | undefined): string {
  if (!projectId) return '';
  return PROJECT_LABEL[projectId] ?? live.status?.projects.find((p) => p.id === projectId)?.name ?? projectId;
}

/** Orden de proyectos: el de registro en el servidor, con los conocidos como respaldo. */
export function projectOrder(): string[] {
  const fromServer = live.status?.projects.map((p) => p.id) ?? [];
  return [...new Set([...fromServer, ...Object.keys(PROJECT_LABEL)])];
}

export function agentName(agentId: string | undefined): string {
  if (!agentId) return 'IA';
  return catalog.agents.find((a) => a.id === agentId)?.name ?? agentId;
}

// ── Políticas ───────────────────────────────────────────

export function actionPolicy(action: string): ActionPolicy | undefined {
  return catalog.policies?.config.actions.find((a) => a.action === action);
}

export function actionRisk(action: string): RiskClass | undefined {
  return catalog.policies?.actions.find((a) => a.name === action)?.risk;
}

/** Techo por defecto de una acción, aunque no esté en policies.yaml. */
export function defaultLevel(action: string): { level: AutonomyLevel; configured: boolean } {
  const policy = actionPolicy(action);
  if (policy) return { level: policy.level, configured: true };
  return { level: actionRisk(action) === 'read' ? 'auto' : 'approve', configured: false };
}
