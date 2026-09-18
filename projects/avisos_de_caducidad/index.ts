/**
 * Proyecto avisos_de_caducidad: Avisos de caducidad. Generado por el agente creador de agentes.
 */
import type { ProjectModule } from '../../platform/contracts.ts';
import { tools } from './tools.ts';

const PROJECT = "avisos_de_caducidad";
const AGENT_ID = "avisos-de-caducidad";

export const avisosDeCaducidad: ProjectModule = {
  id: PROJECT,
  name: "Avisos de caducidad",
  description: "Revisa cada tarde el stock de productos frescos de cada tienda en el ERP, detecta los lotes que caducan en las próximas 24 horas y avisa al encargado de la tienda para que los ponga en oferta o los retire.",
  tools,
  rules: [],
  scenarios: [
    {
      id: "avisos_de_caducidad-probar",
      project: PROJECT,
      title: "Probar Avisos de caducidad",
      description: 'Abre un caso de prueba y se lo pasa al agente.',
      order: 200,
      run: async (platform) => {
        const record = platform.cases.create({ project: PROJECT, title: "Prueba: Avisos de caducidad", source: 'ticket', scope: {}, agentId: AGENT_ID });
        platform.runtime.enqueue({ agentId: AGENT_ID, caseId: record.id, task: "Caso de prueba. Revisa cada tarde el stock de productos frescos de cada tienda en el ERP, detecta los lotes que caducan en las próximas 24 horas y avisa al encargado de la tienda para que los ponga en oferta o los retire." });
        return { message: "Caso de prueba enviado a Avisos de caducidad.", caseIds: [record.id] };
      },
    },
  ],
};

export default avisosDeCaducidad;
