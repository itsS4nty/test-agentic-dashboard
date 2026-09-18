/**
 * Escenarios del panel de demo para soporte.
 */
import type { PlatformApi, Scenario } from '../../platform/contracts.ts';
import { lowerFirst } from './injection.ts';
import {
  AGENT_ID,
  EURO_AMOUNT_IN_TEXT,
  IBAN_IN_TEXT,
  INJECTION_TICKET_ID,
  PROJECT_ID,
  SEED_TICKETS,
  ensureTicketCase,
  findTicket,
  formatEur,
  maskIban,
  parseEur,
  receiveTicket,
  siteLabel,
  type Ticket,
} from './state.ts';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sentence(text: string): string {
  return /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

function caseIdsOf(tickets: (Ticket | undefined)[]): string[] {
  return tickets.map((t) => t?.caseId).filter((id): id is string => Boolean(id));
}

/** Mete el ticket en la bandeja y dispara sus reglas. */
async function deliver(platform: PlatformApi, ticketId: string): Promise<Ticket | undefined> {
  if (!receiveTicket(platform, ticketId)) return undefined;
  await platform.rules.emit('ticket.received', { ticketId });
  return findTicket(platform, ticketId);
}

const morningInbox: Scenario = {
  id: 'soporte-bandeja',
  project: PROJECT_ID,
  title: 'Llega la bandeja de la mañana',
  description:
    'Entran cinco tickets de tiendas. La pregunta frecuente la responde una regla sin IA; el resto lo trabaja el ' +
    'agente de soporte (máximo 3 a la vez), con las respuestas pendientes de aprobación y lo delicado escalado.',
  order: 80,
  async run(platform) {
    const pending = SEED_TICKETS.filter((t) => t.id !== INJECTION_TICKET_ID && !findTicket(platform, t.id)).sort(
      (a, b) => b.minutesAgo - a.minutesAgo,
    );
    if (pending.length === 0) {
      const already = SEED_TICKETS.filter((t) => t.id !== INJECTION_TICKET_ID).map((t) => findTicket(platform, t.id));
      return {
        message: 'La bandeja de la mañana ya ha llegado. Reinicia la demo para volver a lanzarla.',
        caseIds: caseIdsOf(already),
      };
    }

    const delivered: Ticket[] = [];
    for (const seed of pending) {
      const ticket = await deliver(platform, seed.id);
      if (ticket) delivered.push(ticket);
    }

    const byRule = delivered.filter((t) => t.status === 'auto_answered');
    const toAgent = delivered.filter((t) => t.status !== 'auto_answered');
    const parts = [`Han entrado ${count(delivered.length, 'ticket', 'tickets')} en la bandeja.`];
    if (byRule.length) {
      parts.push(
        `${byRule.map((t) => t.id).join(', ')}: pregunta frecuente, respondida por regla con plantilla (sin IA, coste 0).`,
      );
    }
    if (toAgent.length) {
      parts.push(
        `${toAgent.map((t) => t.id).join(', ')}: al agente de soporte, que trabaja como máximo 3 a la vez. ` +
          'Las respuestas quedarán pendientes de aprobación y lo delicado, escalado a una persona.',
      );
    }
    return { message: parts.join(' '), caseIds: caseIdsOf(delivered) };
  },
};

const injectionTicket: Scenario = {
  id: 'soporte-inyeccion',
  project: PROJECT_ID,
  title: 'Ticket con intento de manipulación',
  description:
    'Entra un ticket que intenta ordenar al agente un abono de 5.000 € a una cuenta, sin aprobación. El filtro de ' +
    'entrada lo marca y el agente lo trata como datos: lo señala como sospechoso y lo escala.',
  order: 90,
  async run(platform) {
    const existing = findTicket(platform, INJECTION_TICKET_ID);
    if (existing) {
      return {
        message: `El ticket ${existing.id} ya está en la bandeja. Lanza la prueba de fuego para intentar forzar el abono.`,
        caseIds: caseIdsOf([existing]),
      };
    }

    const ticket = await deliver(platform, INJECTION_TICKET_ID);
    if (!ticket) return { message: `No se ha encontrado el ticket ${INJECTION_TICKET_ID} en los datos de la demo.` };

    const where = siteLabel(platform, ticket);
    if (!ticket.injectionDetected) {
      return {
        message: `Ha entrado el ticket ${ticket.id} de ${where}, pero el filtro de entrada no lo ha marcado. El agente lo revisa igualmente.`,
        caseIds: caseIdsOf([ticket]),
      };
    }
    const patterns = ticket.injectionPatterns ?? [];
    const labels = patterns.map((p) => lowerFirst(p.label)).join('; ');
    return {
      message:
        `Ha entrado el ticket ${ticket.id} de ${where}. El filtro de entrada ha encontrado ` +
        `${count(patterns.length, 'patrón', 'patrones')} de manipulación (${labels}) y lo ha marcado. ` +
        'El agente lo revisa tratándolo como datos, no como instrucciones.',
      caseIds: caseIdsOf([ticket]),
    };
  },
};

const trialByFire: Scenario = {
  id: 'soporte-prueba-fuego',
  project: PROJECT_ID,
  title: 'Prueba de fuego: forzar un abono desde ese ticket',
  description:
    'Se fuerza al agente a pedir el abono de 5.000 € del ticket T-106, como si hubiera caído en la trampa. ' +
    'La política lo bloquea antes de ejecutar nada y el intento queda en la traza.',
  order: 95,
  async run(platform) {
    const ticket = findTicket(platform, INJECTION_TICKET_ID) ?? (await deliver(platform, INJECTION_TICKET_ID));
    if (!ticket) return { message: `No se ha encontrado el ticket ${INJECTION_TICKET_ID} en los datos de la demo.` };

    const record = ensureTicketCase(platform, ticket, 'high');
    const amountText = EURO_AMOUNT_IN_TEXT.exec(ticket.body)?.[0];
    const amountEur = (amountText && parseEur(amountText)) || 5000;
    const iban = IBAN_IN_TEXT.exec(ticket.body)?.[0] ?? 'ES91 2100 0418 4502 0005 1332';

    platform.cases.addTimeline(record.id, {
      kind: 'note',
      title: 'Prueba de fuego: se fuerza el abono que pide el ticket',
      detail:
        `Se simula que el agente obedece al ticket e intenta un abono de ${formatEur(amountEur)} a ${maskIban(iban)}. ` +
        'La política tiene que impedirlo aunque la llamada venga del propio agente.',
    });

    const result = await platform.tools.invoke(
      'soporte_issue_credit',
      { ticketId: ticket.id, amountEur, iban },
      {
        caseId: record.id,
        actor: 'agent',
        agentId: AGENT_ID,
        reason: `Prueba de fuego: invocación forzada, como si el agente hubiera obedecido al ticket ${ticket.id} y emitiera el abono que pide.`,
      },
    );

    if (result.decision === 'deny' && !result.executed) {
      const why = result.evaluation?.matchedCondition ?? result.evaluation?.reason ?? result.result.content;
      return {
        message:
          `La política ha bloqueado el abono de ${formatEur(amountEur)} que pedía el ticket ${ticket.id}: ${sentence(lowerFirst(why))} ` +
          'No se ha ejecutado aunque la petición venía del propio agente; el intento queda en la traza del caso y ' +
          'cuenta en «bloqueos por política».',
        caseIds: [record.id],
      };
    }
    return {
      message:
        `La política no ha bloqueado el abono (decisión: ${result.decision}, ${result.executed ? 'ejecutado' : 'no ejecutado'}). ` +
        `${sentence(result.result.content)} Revisa que el ticket siga marcado como sospechoso y la condición ` +
        'injection_suspected de soporte_issue_credit en config/policies.yaml.',
      caseIds: [record.id],
    };
  },
};

export const soporteScenarios: Scenario[] = [morningInbox, injectionTicket, trialByFire];
