/**
 * Predicados de política del proyecto soporte.
 */
import type { PolicyPredicate } from '../../platform/contracts.ts';
import { detectInjection } from './injection.ts';
import { findSeed, findTicket, ticketText } from './state.ts';

function looksInjected(platform: Parameters<PolicyPredicate>[0]['platform'], ticketId: unknown): boolean {
  const ticket = findTicket(platform, ticketId);
  if (ticket) return ticket.injectionDetected === true || detectInjection(ticketText(ticket)).detected;
  // Un ticket que aún no ha pasado por la bandeja se evalúa igual, directamente sobre su texto.
  const seed = findSeed(ticketId);
  return seed ? detectInjection(ticketText(seed)).detected : false;
}

/**
 * `injection_suspected`: el ticket del input, o el ticket del caso, está marcado como intento de
 * manipulación (por el filtro de entrada o por el agente). Se recalcula sobre el texto por si
 * el filtro no hubiera llegado a ejecutarse.
 */
export const injectionSuspected: PolicyPredicate = ({ input, caseId, platform }) => {
  const inputTicketId = input && typeof input === 'object' ? (input as { ticketId?: unknown }).ticketId : undefined;
  if (inputTicketId !== undefined && looksInjected(platform, inputTicketId)) return true;

  const record = platform.cases.get(caseId);
  if (!record) return false;
  if (record.data.injectionDetected === true) return true;
  return record.data.ticketId !== undefined && looksInjected(platform, record.data.ticketId);
};
