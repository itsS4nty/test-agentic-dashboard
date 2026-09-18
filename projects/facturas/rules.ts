/**
 * Capa 1 · reglas del lote de facturas. Coste 0: ni una llamada a la IA.
 *
 * 1. `facturas.comprobaciones_deterministas`: aplica las cinco comprobaciones, guarda los hallazgos
 *    con `layer: 'rule'` y deja un caso "Revisión automática del lote" resuelto por regla.
 * 2. `facturas.derivar_criterio`: lo que las reglas no pueden juzgar abre un caso por factura
 *    y encola al agente de facturación.
 */
import type { PlatformApi, Rule } from '../../platform/contracts.ts';
import {
  DETERMINISTIC_CHECKS,
  type CheckContext,
  type CheckHit,
  checkLabel,
  findingIdFor,
  requiereCriterio,
  runDeterministicChecks,
} from './checks.ts';
import {
  AGENT_ID,
  PROJECT_ID,
  catalog,
  contractFor,
  describeInvoice,
  eur,
  getState,
  round2,
  saveState,
  statusLabel,
} from './data.ts';
import type { Finding, Invoice, InvoiceBatchPayload } from './types.ts';

const EVENT = 'invoice.batch_received';

function batchInvoices(platform: PlatformApi, invoiceIds: string[]): Invoice[] {
  const { invoices } = getState(platform);
  return invoiceIds.map((id) => invoices.find((i) => i.id === id)).filter((i): i is Invoice => Boolean(i));
}

function contextFor(invoice: Invoice, batch: Invoice[]): CheckContext {
  return { contract: contractFor(invoice.clientId), catalog: catalog(), batch };
}

export const deterministicChecksRule: Rule<InvoiceBatchPayload> = {
  id: 'facturas.comprobaciones_deterministas',
  project: PROJECT_ID,
  description:
    'Al recibir un lote de facturas comprueba precio contra contrato, IVA contra catálogo, líneas duplicadas, totales ' +
    'y servicios activos sin facturar. Registra cada hallazgo con coste 0 y cierra la revisión del lote por regla.',
  on: EVENT,
  handle: async (event, platform) => {
    const { batchId, invoiceIds } = event.payload;
    const state = getState(platform);
    const batch = batchInvoices(platform, invoiceIds);

    const caseRecord = platform.cases.create({
      project: PROJECT_ID,
      title: `Revisión automática del lote ${batchId}`,
      source: 'invoice',
      scope: {},
      severity: 'low',
      data: { batchId, invoiceIds },
    });
    platform.cases.addTimeline(caseRecord.id, {
      kind: 'rule',
      actor: 'rule',
      title: `Cinco comprobaciones deterministas sobre ${batch.length} facturas`,
      detail: DETERMINISTIC_CHECKS.map((c) => `${c.id} · ${c.label}`).join('\n'),
      data: { checks: DETERMINISTIC_CHECKS.map((c) => c.id) },
    });

    const hits: CheckHit[] = batch.flatMap((invoice) => runDeterministicChecks(invoice, contextFor(invoice, batch)));
    const findingIds: string[] = [];
    for (const hit of hits) {
      const invoice = batch.find((i) => i.id === hit.invoiceId)!;
      const id = findingIdFor(hit);
      const already = state.findings.some((f) => f.id === id);
      if (!already) {
        const finding: Finding = {
          id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          layer: 'rule',
          check: hit.check,
          title: hit.title,
          detail: hit.detail,
          amountImpact: hit.amountImpact,
          status: 'open',
          caseId: caseRecord.id,
          createdAt: new Date().toISOString(),
        };
        state.findings.push(finding);
      }
      findingIds.push(id);
      platform.cases.addTimeline(caseRecord.id, {
        kind: 'rule',
        actor: 'rule',
        title: `${checkLabel(hit.check)} · ${invoice.number} · ${eur(hit.amountImpact)}`,
        detail: `${describeInvoice(platform, invoice)} (${statusLabel(invoice)}). ${hit.detail}${already ? ' Ya estaba registrado.' : ''}`,
        data: { findingId: id, invoiceId: invoice.id, check: hit.check, amountImpact: hit.amountImpact },
      });
    }

    const flagged = batch.filter((invoice) => requiereCriterio(invoice, contextFor(invoice, batch)).length > 0);
    const impact = round2(hits.reduce((sum, h) => sum + h.amountImpact, 0));
    state.checkedInvoiceIds = [...new Set([...state.checkedInvoiceIds, ...batch.map((i) => i.id)])];
    state.lastBatch = {
      batchId,
      receivedAt: event.at,
      caseId: caseRecord.id,
      invoiceIds: batch.map((i) => i.id),
      ruleFindingIds: findingIds,
      judgmentCaseIds: [],
    };
    saveState(platform, state);

    const byCheck = DETERMINISTIC_CHECKS.map((c) => `${c.label}: ${hits.filter((h) => h.check === c.id).length}`);
    const summary =
      `${batch.length} facturas revisadas por reglas, coste 0. ` +
      `${hits.length} ${hits.length === 1 ? 'hallazgo' : 'hallazgos'} con ${eur(impact)} de impacto (${byCheck.join('; ')}). ` +
      `${flagged.length} ${flagged.length === 1 ? 'factura requiere' : 'facturas requieren'} criterio y ` +
      `${flagged.length === 1 ? 'pasa' : 'pasan'} al agente de facturación: ${flagged.map((i) => i.number).join(', ') || 'ninguna'}.`;
    platform.cases.update(caseRecord.id, {
      severity: hits.length > 0 ? 'medium' : 'low',
      data: { batchId, invoiceIds, findings: hits.length, impactEur: impact, flaggedInvoiceIds: flagged.map((i) => i.id) },
    });
    platform.cases.resolve(caseRecord.id, 'rule', summary);
  },
};

export const judgmentRule: Rule<InvoiceBatchPayload> = {
  id: 'facturas.derivar_criterio',
  project: PROJECT_ID,
  description:
    'Las facturas con descuentos no previstos, conceptos que no coinciden con el catálogo o productos sin precio pactado ' +
    'no se pueden decidir con una regla: abre un caso por factura y lo encola al agente de facturación.',
  on: EVENT,
  handle: async (event, platform) => {
    const { batchId, invoiceIds } = event.payload;
    const batch = batchInvoices(platform, invoiceIds);
    const judgmentCaseIds: string[] = [];
    const lines: string[] = [];

    for (const invoice of batch) {
      const hits = requiereCriterio(invoice, contextFor(invoice, batch));
      if (hits.length === 0) continue;

      const open = platform.cases.findOpen((c) => c.project === PROJECT_ID && c.data?.invoiceId === invoice.id);
      if (open) {
        lines.push(`${invoice.number}: ya tiene un caso abierto (${open.id}), no se repite.`);
        continue;
      }

      const where = describeInvoice(platform, invoice);
      const reasons = hits.map((h) => h.detail);
      const caseRecord = platform.cases.create({
        project: PROJECT_ID,
        title: `Revisar con criterio ${invoice.number}`,
        source: 'invoice',
        scope: { clientId: invoice.clientId, siteId: invoice.siteId },
        severity: invoice.status === 'issued' ? 'high' : 'medium',
        data: {
          batchId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          invoiceStatus: invoice.status,
          reasons,
          amountAtStakeEur: round2(hits.reduce((sum, h) => sum + h.amountImpact, 0)),
        },
      });
      platform.cases.addTimeline(caseRecord.id, {
        kind: 'rule',
        actor: 'rule',
        title: 'Las reglas no pueden decidir esta factura: requiere criterio',
        detail: reasons.join('\n'),
        data: { check: 'requiere_criterio', invoiceId: invoice.id },
      });
      platform.runtime.enqueue({
        agentId: AGENT_ID,
        caseId: caseRecord.id,
        task:
          `Revisa con criterio la factura ${where} (id ${invoice.id}, ${statusLabel(invoice)}). ` +
          `Las comprobaciones deterministas la han marcado por:\n${reasons.map((r) => `- ${r}`).join('\n')}\n` +
          'Compárala con el contrato, decide si hay un error, cuantifica el impacto en euros IVA incluido, registra cada ' +
          'hallazgo y, si procede, propone la corrección.',
      });
      judgmentCaseIds.push(caseRecord.id);
      lines.push(`${invoice.number} (${statusLabel(invoice)}) → caso ${caseRecord.id}`);
    }

    const state = getState(platform);
    if (state.lastBatch?.batchId === batchId) {
      state.lastBatch.judgmentCaseIds = judgmentCaseIds;
      if (lines.length > 0) {
        platform.cases.addTimeline(state.lastBatch.caseId, {
          kind: 'rule',
          actor: 'rule',
          title: `${judgmentCaseIds.length} ${judgmentCaseIds.length === 1 ? 'factura derivada' : 'facturas derivadas'} al agente de facturación`,
          detail: lines.join('\n'),
          data: { judgmentCaseIds },
        });
      }
    }
    saveState(platform, state);
  },
};

export const facturasRules: Rule[] = [deterministicChecksRule, judgmentRule];
