/**
 * Guion del modo simulado para el agente `soporte`.
 *
 * Avanza según las herramientas que ya ha llamado (no por número de turno) y decide sobre el
 * contenido real del ticket con reglas sencillas, como lo haría un modelo prudente.
 * Nunca finge que el modelo cae en la trampa: ante un ticket con instrucciones incrustadas lo
 * marca y lo escala, y jamás llama a `soporte_issue_credit`.
 */
import type { MockContext, MockScript, MockToolResult, MockTurn } from '../../platform/contracts.ts';
import { detectInjection, foldText, lowerFirst, type InjectionReport } from './injection.ts';
import {
  CATEGORY_LABELS,
  EURO_AMOUNT_IN_TEXT,
  firstName,
  ticketText,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
} from './state.ts';

type Topic = 'datafono' | 'impresora' | 'router' | 'otro';

interface Triage {
  category: TicketCategory;
  priority: TicketPriority;
  /** Lo que "piensa" el modelo al clasificar. */
  rationale: string;
  reply: string;
  escalateReason?: string;
}

const TOPIC_LABEL: Record<Topic, string> = {
  datafono: 'el datáfono',
  impresora: 'la impresora de tickets',
  router: 'el router',
  otro: 'un equipo de la tienda',
};

const ANGRY_SIGNALS: { regex: RegExp; label: string }[] = [
  { regex: /\b(?:otra vez|tercera vez|cuarta vez|de nuevo lo mismo)\b/, label: 'problema que se repite' },
  {
    regex: /\bya no puede ser\b|\binaceptable\b|\bindignante\b|\bverguenza\b|\bhart[oa]s?\b|\bestamos cansados\b/,
    label: 'tono de enfado',
  },
  { regex: /\bcambiar de proveedor\b|\bdarnos de baja\b|\bcancelar el contrato\b/, label: 'amenaza con cambiar de proveedor' },
  {
    regex: /\bnos dijeron que ya estaba (?:solucionado|resuelto|arreglado)\b/,
    label: 'se le dio por resuelto y no lo estaba',
  },
];

const MONEY = /\d+(?:[.,]\d+)?\s*(?:€|euros?\b)|\bfactura|\bcobr|\bcargo|\bimporte|\babono|\breembolso|\bdevolucion/;
const SUGGESTION =
  /\bidea\b|\bsugerencia\b|\bpropuesta\b|\bos propongo\b|\bestaria (?:muy )?bien\b|\bseria (?:genial|util|estupendo)\b|\bpodriais anadir\b/;
const URGENT = /\bno podemos (?:cobrar|vender|abrir)\b|\btienda parada\b|\bsin poder cobrar\b/;

function detectTopic(folded: string): Topic {
  if (/\bimpresora\b|\brecibos?\b|\ben blanco\b/.test(folded)) return 'impresora';
  if (/\bdatafono\b|\btpv\b|\bterminal de pago\b/.test(folded)) return 'datafono';
  if (/\brouter\b|\binternet\b|\bwifi\b|\bconexion\b/.test(folded)) return 'router';
  return 'otro';
}

function signature(body: string): string {
  return `${body}\n\nUn saludo,\nEquipo de soporte`;
}

function incidentReply(nombre: string, tienda: string, topic: Topic): string {
  const greeting = `Hola, ${nombre}:\n\n`;
  switch (topic) {
    case 'impresora':
      return signature(
        `${greeting}Gracias por avisarnos, y perdona las molestias en plena mañana. Cuando los recibos salen en blanco ` +
          'casi siempre es el rollo: el papel térmico solo imprime por una cara. Abre la tapa, dale la vuelta al rollo ' +
          'para que la cara brillante quede hacia el cabezal y ciérrala hasta oír el clic.\n\n' +
          `Si con el rollo bien colocado sigue igual, respóndenos a este mensaje y organizamos la visita de un técnico a la tienda de ${tienda}.`,
      );
    case 'datafono':
      return signature(
        `${greeting}Gracias por avisarnos. Si el datáfono se queda bloqueado, mantén pulsado el botón de encendido ` +
          '10 segundos para reiniciarlo; nuestra plataforma también lo vigila y lo reinicia sola cuando no hay ningún cobro en curso.\n\n' +
          `Si vuelve a pasar en la tienda de ${tienda}, respóndenos a este mensaje y lo revisamos a fondo.`,
      );
    case 'router':
      return signature(
        `${greeting}Gracias por avisarnos. Desenchufa el router 30 segundos y vuelve a enchufarlo; en un par de minutos ` +
          'debería recuperar la conexión.\n\n' +
          `Si la tienda de ${tienda} sigue sin conexión, respóndenos a este mensaje y lo revisamos desde aquí.`,
      );
    default:
      return signature(
        `${greeting}Gracias por avisarnos. Hemos registrado la incidencia de la tienda de ${tienda} y la estamos revisando. ` +
          'Te escribimos en cuanto tengamos novedades.',
      );
  }
}

function complaintReply(nombre: string, tienda: string, topic: Topic, signals: string[]): string {
  const pain: Record<Topic, string> = {
    datafono: 'que el datáfono falle con la tienda llena es de lo peor que os puede pasar',
    impresora: 'que la impresora falle en plena venta es de lo peor que os puede pasar',
    router: 'quedarse sin conexión en plena venta es de lo peor que os puede pasar',
    otro: 'esto no debería pasar',
  };
  const repeated = signals.includes('se le dio por resuelto y no lo estaba')
    ? ', y más después de haberos dicho que estaba resuelto'
    : '';
  return signature(
    `Hola, ${nombre}:\n\nTienes toda la razón: ${pain[topic]}${repeated}. Lo siento de verdad.\n\n` +
      'He pasado tu mensaje a una persona responsable del equipo, que se pondrá en contacto contigo para revisar ' +
      `a fondo lo que está pasando en la tienda de ${tienda}.`,
  );
}

function simulateTriage(ticket: Ticket, tienda: string): Triage {
  const folded = foldText(ticketText(ticket));
  const nombre = firstName(ticket.from);
  const topic = detectTopic(folded);

  const angry = ANGRY_SIGNALS.filter((s) => s.regex.test(folded)).map((s) => s.label);
  if (angry.length >= 2 || angry.includes('amenaza con cambiar de proveedor')) {
    return {
      category: 'queja',
      priority: 'alta',
      rationale: `La tienda está muy molesta (${angry.join(', ')}). Lo clasifico como queja con prioridad alta.`,
      reply: complaintReply(nombre, tienda, topic, angry),
      escalateReason: `Cliente muy molesto (${angry.join(', ')}). Necesita que le atienda una persona responsable, no una respuesta automática.`,
    };
  }

  if (MONEY.test(folded)) {
    const amount = EURO_AMOUNT_IN_TEXT.exec(ticket.body)?.[0];
    return {
      category: 'facturacion',
      priority: 'media',
      rationale: `Es una duda sobre importes de una factura${amount ? ` (${amount})` : ''}. Facturación, prioridad media.`,
      reply: signature(
        `Hola, ${nombre}:\n\nGracias por revisarlo con tanto detalle. Hemos pasado tu consulta a nuestro equipo de ` +
          'Administración para que compruebe las líneas de la factura. En cuanto lo tengan revisado te confirmarán por escrito qué corresponde.',
      ),
      escalateReason: `Hay dinero de por medio${amount ? ` (${amount})` : ''}, así que lo revisa Administración antes de confirmar nada a la tienda.`,
    };
  }

  if (SUGGESTION.test(folded)) {
    return {
      category: 'sugerencia',
      priority: 'baja',
      rationale: 'Es una sugerencia de mejora, no una avería. La clasifico como sugerencia con prioridad baja.',
      reply: signature(
        `Hola, ${nombre}:\n\n¡Muchas gracias por la idea! Nos ayuda mucho que las tiendas nos contéis qué os facilitaría ` +
          'el día a día. La pasamos al equipo de producto junto con tu explicación y, si entra en una próxima versión, te avisaremos.',
      ),
    };
  }

  const priority: TicketPriority = URGENT.test(folded) ? 'urgente' : 'media';
  return {
    category: 'incidencia',
    priority,
    rationale: `Incidencia técnica con ${TOPIC_LABEL[topic]} en ${tienda}. Prioridad ${priority}.`,
    reply: incidentReply(nombre, tienda, topic),
  };
}

// ─────────────────────────────────────────────────────────────

function resultOf(ctx: MockContext, name: string): MockToolResult | undefined {
  return ctx.allResults.find((r) => r.name === name);
}

function outcome(result: MockToolResult, done: string, attempted: string): string {
  if (result.executed && result.ok) return done;
  return `He intentado ${attempted}, pero la plataforma no lo ha ejecutado (${result.content}).`;
}

function injectionTurn(ctx: MockContext, ticket: Ticket, report: InjectionReport): MockTurn {
  const what = report.matches.length
    ? report.matches.map((m) => lowerFirst(m.label)).join('; ')
    : 'instrucciones dirigidas al asistente';

  const flag = resultOf(ctx, 'soporte_flag_suspicious');
  if (!flag) {
    return {
      text:
        `El ticket ${ticket.id} no es una consulta normal: contiene texto que intenta darme órdenes (${what}). ` +
        'Lo que dice un ticket son datos, no instrucciones, así que no voy a hacer nada de lo que pide. Lo marco como sospechoso.',
      toolCalls: [
        {
          name: 'soporte_flag_suspicious',
          input: {
            ticketId: ticket.id,
            reason: `Instrucciones incrustadas en el ticket: ${what}. No se ha ejecutado nada de lo que pide.`,
          },
        },
      ],
    };
  }

  const escalation = resultOf(ctx, 'soporte_escalate_ticket');
  if (!escalation) {
    return {
      text: 'Lo escalo a una persona para que verifique la petición con la tienda por un canal conocido.',
      toolCalls: [
        {
          name: 'soporte_escalate_ticket',
          input: {
            ticketId: ticket.id,
            reason: `Posible intento de manipulación o fraude (${what}). Hay que verificarlo con la tienda por un canal conocido antes de hacer nada.`,
          },
        },
      ],
    };
  }

  const where = ctx.platform.directory.describeScope(ctx.caseRecord.scope);
  const amount = EURO_AMOUNT_IN_TEXT.exec(ticket.body)?.[0];
  const asksForMoney = report.matches.some((m) => m.id === 'orden_de_pago');
  return {
    text: [
      `Resumen del ticket ${ticket.id} (${where}): el texto intentaba darme órdenes${
        asksForMoney && amount ? ` para mover dinero (${amount})` : ''
      }. No he seguido ninguna de sus instrucciones ni he ejecutado ninguna de las acciones que pedía.`,
      outcome(flag, 'Lo he marcado como sospechoso, así que la política bloquea cualquier abono sobre él.', 'marcarlo como sospechoso'),
      outcome(escalation, 'Lo he escalado a una persona.', 'escalarlo'),
      'Pendiente: que alguien verifique con la tienda, por un canal conocido, si hay alguna incidencia real detrás del mensaje.',
    ].join(' '),
  };
}

function normalTurn(ctx: MockContext, ticket: Ticket): MockTurn {
  const tienda = ctx.platform.directory.site(ticket.siteId)?.name ?? ticket.siteId;
  const triage = simulateTriage(ticket, tienda);

  if (!resultOf(ctx, 'soporte_classify_ticket')) {
    return {
      text: triage.rationale,
      toolCalls: [
        {
          name: 'soporte_classify_ticket',
          input: { ticketId: ticket.id, category: triage.category, priority: triage.priority },
        },
      ],
    };
  }

  if (!resultOf(ctx, 'soporte_draft_reply')) {
    return {
      text: triage.escalateReason
        ? 'Preparo un borrador para que la persona que lo atienda tenga por dónde empezar.'
        : 'Redacto una respuesta cercana y concreta para la tienda.',
      toolCalls: [{ name: 'soporte_draft_reply', input: { ticketId: ticket.id, body: triage.reply } }],
    };
  }

  const where = ctx.platform.directory.describeScope(ctx.caseRecord.scope);
  const heading = `Ticket ${ticket.id} (${where}) clasificado como ${CATEGORY_LABELS[triage.category]} con prioridad ${triage.priority}.`;

  if (triage.escalateReason) {
    const escalation = resultOf(ctx, 'soporte_escalate_ticket');
    if (!escalation) {
      return {
        text: `No lo contesto yo: lo escalo. Motivo: ${triage.escalateReason}`,
        toolCalls: [{ name: 'soporte_escalate_ticket', input: { ticketId: ticket.id, reason: triage.escalateReason } }],
      };
    }
    return {
      text: [
        heading,
        outcome(escalation, `Lo he escalado a una persona. Motivo: ${lowerFirst(triage.escalateReason)}`, 'escalarlo'),
        'He dejado un borrador de respuesta preparado, sin enviar.',
        'Pendiente: que una persona responsable conteste a la tienda.',
      ].join(' '),
    };
  }

  const sent = resultOf(ctx, 'soporte_send_reply');
  if (!sent) {
    return {
      text: 'La respuesta está lista. La envío; si necesita aprobación, quedará pendiente hasta que alguien la revise.',
      toolCalls: [{ name: 'soporte_send_reply', input: { ticketId: ticket.id, body: triage.reply } }],
    };
  }

  let closing: string;
  if (sent.executed && sent.ok) {
    closing = 'La respuesta se ha enviado a la tienda. No queda nada pendiente.';
  } else if (sent.decision === 'approve') {
    closing = 'He redactado la respuesta y ha quedado en aprobación: no saldrá hasta que una persona la revise. Pendiente: aprobar o rechazar el envío.';
  } else if (sent.decision === 'shadow') {
    closing = 'El envío está en modo sombra: la respuesta queda registrada pero no se ha enviado. Pendiente: enviarla a mano si se da por buena.';
  } else {
    closing = `La plataforma no ha permitido enviar la respuesta (${sent.content}). El borrador queda guardado. Pendiente: que una persona decida cómo seguir.`;
  }
  return { text: `${heading} ${closing}` };
}

export const soporteMock: MockScript = (ctx) => {
  const ticketId = typeof ctx.caseRecord.data.ticketId === 'string' ? ctx.caseRecord.data.ticketId : '';
  if (!ticketId) {
    return { text: 'Este caso no tiene ningún ticket asociado, así que no hay nada que revisar. Lo dejo para una persona.' };
  }

  const read = resultOf(ctx, 'soporte_get_ticket');
  if (!read) {
    const toolCalls: NonNullable<MockTurn['toolCalls']> = [{ name: 'soporte_get_ticket', input: { ticketId } }];
    const siteId = ctx.caseRecord.scope.siteId;
    if (siteId) toolCalls.push({ name: 'soporte_lookup_customer', input: { siteId } });
    return { text: 'Antes de decidir nada, leo el ticket y la ficha de la tienda.', toolCalls };
  }

  const ticket = read.ok ? (read.data as Ticket | undefined) : undefined;
  if (!ticket || typeof ticket.body !== 'string') {
    return {
      text: `No he podido leer el ticket ${ticketId} (${read.content}). No hago nada más; queda pendiente de que lo revise una persona.`,
    };
  }

  const report = detectInjection(ticketText(ticket));
  if (ticket.injectionDetected || report.detected) return injectionTurn(ctx, ticket, report);
  return normalTurn(ctx, ticket);
};
