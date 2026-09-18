/**
 * Proyecto de facturas: detección de errores en el lote mensual.
 * Capa 1 (reglas, coste 0) para lo repetitivo; el agente `facturacion` solo para lo que requiere criterio.
 */
import type { PlatformApi, ProjectModule, Scenario } from '../../platform/contracts.ts';
import { AGENT_ID, PROJECT_ID, findInvoice, getState, resetState, round2 } from './data.ts';
import { facturacionMock } from './mock.ts';
import { facturasRules } from './rules.ts';
import { facturasTools } from './tools.ts';
import type { FacturasSnapshot, InvoiceBatchPayload } from './types.ts';

const BATCH_ID = 'LOTE-2026-09';

const loteScenario: Scenario = {
  id: 'facturas-lote',
  project: PROJECT_ID,
  title: 'Revisar el lote de facturas de septiembre',
  description:
    'Llegan las 30 facturas de septiembre, emitidas y borradores. Las reglas detectan con coste 0 precios, IVA, ' +
    'duplicados, totales y servicios sin facturar; el agente revisa solo las que requieren criterio.',
  order: 70,
  run: async (platform) => {
    const invoiceIds = getState(platform).invoices.map((i) => i.id);
    await platform.rules.emit<InvoiceBatchPayload>('invoice.batch_received', { batchId: BATCH_ID, invoiceIds });
    const batch = getState(platform).lastBatch;
    if (!batch || batch.batchId !== BATCH_ID) {
      return { message: `Lote ${BATCH_ID} enviado, pero las reglas no han dejado resultado. Revisa la consola del servidor.` };
    }
    const judgment = batch.judgmentCaseIds.length;
    return {
      message:
        `Lote ${BATCH_ID} recibido: ${invoiceIds.length} facturas. Las reglas han registrado ` +
        `${batch.ruleFindingIds.length} hallazgos con coste 0 y ` +
        (judgment === 0
          ? 'no han derivado ninguna factura nueva al agente.'
          : `han derivado ${judgment} ${judgment === 1 ? 'factura' : 'facturas'} al agente de facturación.`),
      caseIds: [batch.caseId, ...batch.judgmentCaseIds],
    };
  },
};

function snapshot(platform: PlatformApi): FacturasSnapshot {
  const state = getState(platform);
  const countFor = (invoiceId: string) => state.findings.filter((f) => f.invoiceId === invoiceId).length;
  const ruleFindings = state.findings.filter((f) => f.layer === 'rule');
  const llmFindings = state.findings.filter((f) => f.layer === 'llm');
  const sum = (list: { amountImpact: number }[]) => round2(list.reduce((s, f) => s + f.amountImpact, 0));
  const llmCostUsd = platform.cases.list({ project: PROJECT_ID }).reduce((s, c) => s + c.costUsd, 0);

  return {
    invoices: state.invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      clientId: inv.clientId,
      clientName: platform.directory.client(inv.clientId)?.name ?? inv.clientId,
      siteId: inv.siteId,
      siteName: platform.directory.site(inv.siteId)?.name ?? inv.siteId,
      date: inv.date,
      status: inv.status,
      total: inv.total,
      findings: countFor(inv.id),
    })),
    findings: state.findings.map(({ id, invoiceId, invoiceNumber, layer, check, title, detail, amountImpact, status, caseId }) => ({
      id,
      invoiceId,
      invoiceNumber,
      layer,
      check,
      title,
      detail,
      amountImpact,
      status,
      caseId,
    })),
    stats: {
      invoicesChecked: state.checkedInvoiceIds.length,
      ruleFindings: ruleFindings.length,
      llmFindings: llmFindings.length,
      ruleCostUsd: 0,
      llmCostUsd: Math.round(llmCostUsd * 1e6) / 1e6,
      ruleImpactEur: sum(ruleFindings),
      llmImpactEur: sum(llmFindings),
    },
  };
}

export const facturas: ProjectModule = {
  id: PROJECT_ID,
  name: 'Facturas',
  description: 'Detección de errores en las facturas del mes: reglas deterministas con coste 0 y un agente para lo que requiere criterio.',
  tools: facturasTools,
  rules: facturasRules,
  predicates: {
    /** La factura del input (o la del caso) ya está emitida. */
    invoice_issued: ({ input, caseId, platform }) => {
      const invoiceId = input?.invoiceId ?? platform.cases.get(caseId)?.data?.invoiceId;
      return typeof invoiceId === 'string' && findInvoice(platform, invoiceId)?.status === 'issued';
    },
  },
  mocks: { [AGENT_ID]: facturacionMock },
  scenarios: [loteScenario],
  init: async (platform) => {
    getState(platform);
  },
  reset: async (platform) => {
    resetState(platform);
  },
  snapshot,
};
