import { httpTool, webhookTool } from '../../platform/connectors.ts';
import type { ToolDefinition } from '../../platform/contracts.ts';

export const tools: ToolDefinition[] = [
  httpTool({
    name: 'avisos_de_caducidad_consultar_stock_fresco',
    project: 'avisos_de_caducidad',
    description:
      'Devuelve el stock de productos frescos (pan, bollería y pastelería) de una tienda en el ERP, con el detalle de lotes, unidades y fecha de caducidad de cada lote. Úsala siempre antes de decidir qué lotes caducan en las próximas 24 horas. Solo lee datos.',
    risk: 'read',
    method: 'GET',
    baseUrlEnv: 'AVISOS_DE_CADUCIDAD_ERP_TIENDAS_URL',
    tokenEnv: 'AVISOS_DE_CADUCIDAD_ERP_TIENDAS_TOKEN',
    path: '/tiendas/{tiendaId}/stock',
    inputSchema: {
      type: 'object',
      properties: {
        tiendaId: {
          type: 'string',
          description: 'Identificador de la tienda cuyo stock se quiere consultar.',
        },
        categoria: {
          type: 'string',
          description:
            'Categoría de producto fresco para filtrar el stock, por ejemplo "pan", "bolleria" o "pasteleria". Si se omite, se devuelve todo el stock.',
        },
        caducaAntesDe: {
          type: 'string',
          description:
            'Fecha límite de caducidad en formato ISO (AAAA-MM-DD) para limitar el stock devuelto a los lotes que caducan antes de esa fecha.',
        },
      },
      required: ['tiendaId'],
    },
  }),
  webhookTool({
    name: 'avisos_de_caducidad_avisar_al_encargado',
    project: 'avisos_de_caducidad',
    description:
      'Envía al canal de avisos de tiendas un aviso para el encargado con los lotes de producto fresco que hay que retirar, poner al 50 % o vigilar. Envía un único aviso por tienda y revisión. Escribe hacia fuera: la acción pasa por aprobación humana, así que al llamarla queda propuesta, no enviada.',
    risk: 'write_external',
    urlEnv: 'AVISOS_DE_CADUCIDAD_AVISOS_TIENDA_WEBHOOK_URL',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'Texto completo del aviso en español: tienda, lotes a retirar por estar caducados, lotes que caducan hoy (al 50 %), lotes que caducan mañana para vigilar, con producto, lote, unidades y fecha de caducidad, y el total de unidades afectadas.',
        },
      },
      required: ['message'],
    },
  }),
];
