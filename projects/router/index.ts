/**
 * Proyecto router: router. Generado por el agente creador de agentes.
 */
import type { ProjectModule } from '../../platform/contracts.ts';
import { tools } from './tools.ts';

const PROJECT = "router";
const AGENT_ID = "router";

export const router: ProjectModule = {
  id: PROJECT,
  name: "router",
  description: "Revisar router cada mañana",
  tools,
  rules: [],
  scenarios: [
    {
      id: "router-probar",
      project: PROJECT,
      title: "Probar router",
      description: 'Abre un caso de prueba y se lo pasa al agente.',
      order: 200,
      run: async (platform) => {
        const record = platform.cases.create({ project: PROJECT, title: "Prueba: router", source: 'ticket', scope: {}, agentId: AGENT_ID });
        platform.runtime.enqueue({ agentId: AGENT_ID, caseId: record.id, task: "Caso de prueba. Revisar router cada mañana" });
        return { message: "Caso de prueba enviado a router.", caseIds: [record.id] };
      },
    },
  ],
};

export default router;
