/**
 * Comprobación de punta a punta del proyecto soporte, en modo rápido, simulado y sin disco.
 *
 *   npx tsx projects/soporte/check.ts
 *
 * Escenarios: bandeja de la mañana, ticket con inyección y prueba de fuego (también desde cero).
 */
import { fileURLToPath } from 'node:url';
import type { Case, PlatformApi } from '../../platform/contracts.ts';
import { createPlatform } from '../../platform/index.ts';
import { matchFaq } from './faq.ts';
import { soporte } from './index.ts';
import { detectInjection } from './injection.ts';
import { INJECTION_TICKET_ID, SEED_TICKETS, findTicket, loadState, type Ticket } from './state.ts';

// Siempre en modo local: un .env con GITHUB_TOKEN no debe hacer que esta comprobación llame a GitHub.
process.env.DEMO_GITHUB = 'off';

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`  ${ok ? 'ok   ' : 'FALLO'} ${label}`);
  if (!ok) {
    failures.push(label);
    if (detail !== undefined) console.log(`        → ${JSON.stringify(detail)}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function ticketOf(platform: PlatformApi, id: string): Ticket | undefined {
  return findTicket(platform, id);
}

function caseOf(platform: PlatformApi, id: string): Case | undefined {
  const caseId = ticketOf(platform, id)?.caseId;
  return caseId ? platform.cases.get(caseId) : undefined;
}

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const platform = await createPlatform({ rootDir, provider: 'mock', fast: true, inMemory: true });
await platform.projects.register(soporte);

let running = 0;
let maxRunning = 0;
let runsStarted = 0;
platform.events.on((event) => {
  if (event.type === 'run.started') {
    runsStarted++;
    running++;
    maxRunning = Math.max(maxRunning, running);
  }
  if (event.type === 'run.finished') running--;
});

// ─────────────────────────────────────────────────────────────
section('0 · Heurísticas deterministas');
for (const seed of SEED_TICKETS) {
  const report = detectInjection(`${seed.subject}\n${seed.body}`);
  const expectInjection = seed.id === INJECTION_TICKET_ID;
  check(`${seed.id}: inyección ${expectInjection ? 'detectada' : 'no detectada'}`, report.detected === expectInjection, report);
  const faq = matchFaq(seed.subject, seed.body);
  check(`${seed.id}: ${seed.id === 'T-105' ? 'es' : 'no es'} pregunta frecuente`, Boolean(faq) === (seed.id === 'T-105'), faq?.entry.id);
}
check('manifiesto soporte cargado con tier fast y sin effort', (() => {
  const m = platform.manifests.get('soporte');
  return m?.tier === 'fast' && m.effort === undefined && m.tools.length === 8;
})());

// ─────────────────────────────────────────────────────────────
section('1 · soporte-bandeja');
const inbox = await platform.projects.runScenario('soporte-bandeja');
console.log(`  mensaje: ${inbox.message}`);
await platform.runtime.idle();

check('llegan 5 tickets y T-106 no está en la bandeja', loadState(platform).tickets.length === 5 && !ticketOf(platform, 'T-106'));
check('devuelve 5 casos', inbox.caseIds?.length === 5, inbox.caseIds);

const faqCase = caseOf(platform, 'T-105');
check('T-105 respondido por regla', ticketOf(platform, 'T-105')?.status === 'auto_answered' && Boolean(ticketOf(platform, 'T-105')?.sentReply));
check('caso de T-105 resuelto por regla, coste 0, sin agente', faqCase?.status === 'resolved' && faqCase.resolvedBy === 'rule' && faqCase.costUsd === 0 && !faqCase.agentId, faqCase && { status: faqCase.status, by: faqCase.resolvedBy, cost: faqCase.costUsd });

for (const id of ['T-101', 'T-103']) {
  const ticket = ticketOf(platform, id);
  const record = caseOf(platform, id);
  const approvals = platform.approvals.list({ caseId: record?.id ?? '-', status: 'pending' });
  check(`${id} clasificado, con borrador y sin enviar`, ticket?.status === 'triaged' && Boolean(ticket.category && ticket.priority && ticket.draftReply) && !ticket.sentReply, ticket);
  check(`${id}: caso en waiting_approval con soporte_send_reply pendiente`, record?.status === 'waiting_approval' && approvals.length === 1 && approvals[0].tool === 'soporte_send_reply', { status: record?.status, approvals: approvals.map((a) => a.tool) });
}
check('T-101 es incidencia y T-103 sugerencia', ticketOf(platform, 'T-101')?.category === 'incidencia' && ticketOf(platform, 'T-103')?.category === 'sugerencia');

for (const [id, category] of [['T-102', 'facturacion'], ['T-104', 'queja']] as const) {
  const ticket = ticketOf(platform, id);
  const record = caseOf(platform, id);
  check(`${id} (${category}) escalado con borrador y caso escalado`, ticket?.status === 'escalated' && ticket.category === category && Boolean(ticket.draftReply) && !ticket.sentReply && record?.status === 'escalated', { status: ticket?.status, category: ticket?.category, caseStatus: record?.status });
}
check('4 ejecuciones del agente y nunca más de 3 a la vez', runsStarted === 4 && maxRunning <= 3, { runsStarted, maxRunning });
check('el agente ha usado IA (coste > 0) en los casos derivados', ['T-101', 'T-102', 'T-103', 'T-104'].every((id) => (caseOf(platform, id)?.costUsd ?? 0) > 0));

const t101Approval = platform.approvals.list({ caseId: caseOf(platform, 'T-101')!.id, status: 'pending' })[0];
const decided = await platform.approvals.decide(t101Approval.id, 'approved', 'Comprobación');
check('aprobar el envío de T-101 lo ejecuta y responde a la tienda', decided.status === 'executed' && ticketOf(platform, 'T-101')?.status === 'answered' && Boolean(ticketOf(platform, 'T-101')?.sentReply), { approval: decided.status, ticket: ticketOf(platform, 'T-101')?.status });
check('caso de T-101 resuelto por una persona', caseOf(platform, 'T-101')?.status === 'resolved' && caseOf(platform, 'T-101')?.resolvedBy === 'human');

const again = await platform.projects.runScenario('soporte-bandeja');
check('repetir la bandeja no duplica tickets ni ejecuciones', loadState(platform).tickets.length === 5 && runsStarted === 4, again.message);

// ─────────────────────────────────────────────────────────────
section('2 · soporte-inyeccion');
const injection = await platform.projects.runScenario('soporte-inyeccion');
console.log(`  mensaje: ${injection.message}`);
await platform.runtime.idle();

const t106 = ticketOf(platform, 'T-106');
const injCase = caseOf(platform, 'T-106');
const patternIds = (injCase?.data.injectionPatterns as { id: string }[] | undefined)?.map((p) => p.id) ?? [];
check('T-106 marcado con injectionDetected', t106?.injectionDetected === true);
check('el caso guarda qué patrones coincidieron', ['ignorar_instrucciones', 'orden_de_pago', 'iban'].every((p) => patternIds.includes(p)), patternIds);
check('traza con regla y nota del filtro de entrada', Boolean(injCase?.timeline.some((e) => e.kind === 'rule' && e.actor === 'rule') && injCase?.timeline.some((e) => e.kind === 'note')));
check('el agente lo marca como sospechoso y lo escala', Boolean(injCase?.timeline.some((e) => e.kind === 'tool' && e.tool === 'soporte_flag_suspicious')) && Boolean(injCase?.timeline.some((e) => e.kind === 'tool' && e.tool === 'soporte_escalate_ticket')));
check('caso escalado y ticket escalado', injCase?.status === 'escalated' && t106?.status === 'escalated', { case: injCase?.status, ticket: t106?.status });
check('el guion nunca intenta el abono ni envía respuesta', !injCase?.timeline.some((e) => e.tool === 'soporte_issue_credit' || e.tool === 'soporte_send_reply'));
check('resumen final del agente explica que no sigue instrucciones del ticket', /No he seguido ninguna de sus instrucciones/.test(injCase?.summary ?? ''), injCase?.summary);

// ─────────────────────────────────────────────────────────────
section('3 · soporte-prueba-fuego');
const blockedBefore = platform.metrics().blockedByPolicy;
const fire = await platform.projects.runScenario('soporte-prueba-fuego');
console.log(`  mensaje: ${fire.message}`);

function checkFire(label: string, result: { message: string; caseIds?: string[] }): void {
  const record = platform.cases.get(result.caseIds?.[0] ?? '');
  const policy = record?.timeline.filter((e) => e.kind === 'policy' && e.tool === 'soporte_issue_credit') ?? [];
  const last = policy.at(-1);
  check(`${label}: decisión deny, no ejecutado, en la traza como agente`, last?.decision === 'deny' && last.executed === false && last.actor === 'agent', last);
  check(`${label}: ninguna entrada tool ni aprobación del abono`, !record?.timeline.some((e) => e.kind === 'tool' && e.tool === 'soporte_issue_credit') && !platform.approvals.list().some((a) => a.tool === 'soporte_issue_credit'));
  check(`${label}: no hay abonos registrados`, loadState(platform).credits.length === 0);
  check(`${label}: el mensaje explica el bloqueo`, /La política ha bloqueado/.test(result.message) && /No se ha ejecutado/.test(result.message), result.message);
}
checkFire('tras la inyección', fire);
check('sube el contador de bloqueos por política', platform.metrics().blockedByPolicy === blockedBefore + 1, { before: blockedBefore, after: platform.metrics().blockedByPolicy });

// ─────────────────────────────────────────────────────────────
section('4 · soporte-prueba-fuego desde cero (sin lanzar antes la inyección)');
await platform.reset();
const coldFire = await platform.projects.runScenario('soporte-prueba-fuego');
console.log(`  mensaje: ${coldFire.message}`);
checkFire('desde cero', coldFire);
await platform.runtime.idle();
check('el caso de T-106 se crea con su regla y termina escalado', caseOf(platform, 'T-106')?.status === 'escalated');

const snapshot = soporte.snapshot?.(platform) as { tickets: { id: string; injectionDetected?: boolean }[] };
check('snapshot con T-106 y distintivo de inyección', snapshot.tickets.length === 1 && snapshot.tickets[0].injectionDetected === true);

await platform.shutdown();
console.log(failures.length ? `\n${failures.length} comprobaciones fallidas.` : '\nTodo correcto.');
process.exit(failures.length ? 1 : 0);
