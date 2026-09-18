import type { ToolDefinition } from '../../platform/contracts.ts';

/**
 * Proyecto "router".
 *
 * La solicitud SOL-001 no define ninguna conexión ni operación, y la plataforma no ha
 * fijado ningún nombre de herramienta para este proyecto. Por eso la lista se publica
 * vacía: el agente trabaja solo con el contexto que recibe en cada caso.
 *
 * Cuando se decidan las integraciones (por ejemplo, leer el estado del router o avisar
 * a un canal de chat), se añaden aquí con httpTool/webhookTool de platform/connectors.ts,
 * con los nombres, riesgos y variables de entorno que fije la plataforma, y se declaran
 * también en agents/router/agent.yaml.
 */
export const tools: ToolDefinition[] = [];
