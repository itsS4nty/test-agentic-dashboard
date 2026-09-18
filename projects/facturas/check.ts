/**
 * Comprobación del escenario de facturas (§ 6.3) en modo rápido y simulado, sin disco ni red.
 * Uso: npx tsx projects/facturas/check.ts
 */
import { fileURLToPath } from 'node:url';
import { createPlatform } from '../../platform/index.ts';
import { getState } from './data.ts';
import { facturas } from './index.ts';
import type { FacturasSnapshot } from './types.ts';

// Siempre en modo local: un .env con GITHUB_TOKEN no debe hacer que esta comprobación llame a GitHub.
process.env.DEMO_GITHUB = 'off';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const results: { ok: boolean; label: string; detail: string }[] = [];

function expect(label: string, ok: boolean, detail: string): void {
  results.push({ ok, label, detail });
}

const snap = (platform: Awaited<ReturnType<typeof createPlatform>>) => facturas.snapshot!(platform) as FacturasSnapshot;

const platform = await createPlatform({ rootDir, provider: 'mock', fast: true, inMemory: true });
try {
  await platform.projects.register(facturas);
  const seed = structuredClone(getState(platform).invoices);

  const outcome = await platform.projects.runScenario('facturas-lote');
  await platform.runtime.idle();
  console.log(`Escenario: ${outcome.message}`);

  let s = snap(platform);
  const cases = platform.cases.list({ project: 'facturas' });
  const batchCase = cases.find((c) => c.title.startsWith('Revisión automática del lote'));
  const ruleChecks = new Set(s.findings.filter((f) => f.layer === 'rule').map((f) => f.check));

  expect('30 facturas revisadas por reglas', s.stats.invoicesChecked === 30, `${s.stats.invoicesChecked}`);
  expect('≥ 5 hallazgos por regla', s.stats.ruleFindings >= 5, `${s.stats.ruleFindings}`);
  expect(
    'Un hallazgo de cada comprobación determinista',
    ['precio_contrato', 'iva_catalogo', 'linea_duplicada', 'total_descuadrado', 'servicio_no_facturado'].every((c) => ruleChecks.has(c)),
    [...ruleChecks].join(', '),
  );
  expect(
    'Caso del lote resuelto por regla con coste 0',
    batchCase?.status === 'resolved' && batchCase.resolvedBy === 'rule' && batchCase.costUsd === 0,
    `${batchCase?.status} · ${batchCase?.resolvedBy} · ${batchCase?.costUsd}`,
  );
  expect('≥ 2 hallazgos por IA', s.stats.llmFindings >= 2, `${s.stats.llmFindings}`);
  expect('Coste de reglas 0 y coste de IA > 0', s.stats.ruleCostUsd === 0 && s.stats.llmCostUsd > 0, `${s.stats.llmCostUsd} USD`);

  const pending = platform.approvals.list({ status: 'pending' }).filter((a) => a.project === 'facturas');
  const pendingInvoiceId = (pending[0]?.input as { invoiceId?: string } | undefined)?.invoiceId;
  const pendingInvoice = getState(platform).invoices.find((i) => i.id === pendingInvoiceId);
  expect(
    'Una aprobación pendiente de facturas_propose_correction sobre un borrador',
    pending.length === 1 && pending[0].tool === 'facturas_propose_correction' && pendingInvoice?.status === 'draft',
    `${pending.length} · ${pending[0]?.summary}`,
  );

  const escalated = cases.filter((c) => c.status === 'escalated');
  const escalatedInvoice = getState(platform).invoices.find((i) => i.id === escalated[0]?.data.invoiceId);
  expect(
    'Un caso escalado por factura emitida',
    escalated.length === 1 && escalatedInvoice?.status === 'issued',
    `${escalated.length} · ${escalated[0]?.title}`,
  );
  const seedIssued = seed.find((i) => i.id === escalatedInvoice?.id);
  expect(
    'La factura emitida no se ha modificado',
    JSON.stringify(seedIssued) === JSON.stringify(escalatedInvoice),
    `${escalatedInvoice?.number} total ${escalatedInvoice?.total}`,
  );

  if (pending[0] && pendingInvoice) {
    const before = pendingInvoice.total;
    const decided = await platform.approvals.decide(pending[0].id, 'approved', 'Comprobación');
    s = snap(platform);
    const after = getState(platform).invoices.find((i) => i.id === pendingInvoiceId)!;
    const draftCase = platform.cases.get(pending[0].caseId);
    expect('Aprobar ejecuta la corrección', decided.status === 'executed', `${decided.status} · ${decided.result?.content}`);
    expect('El borrador cambia de total', after.total !== before, `${before} → ${after.total}`);
    expect(
      'Los hallazgos de IA del borrador quedan corregidos',
      s.findings.filter((f) => f.invoiceId === pendingInvoiceId && f.layer === 'llm').every((f) => f.status === 'corrected'),
      s.findings.filter((f) => f.invoiceId === pendingInvoiceId).map((f) => f.status).join(', '),
    );
    expect('El caso del borrador queda resuelto por una persona', draftCase?.resolvedBy === 'human', `${draftCase?.status}`);
  }

  const casesBefore = platform.cases.list({ project: 'facturas' }).length;
  await platform.projects.runScenario('facturas-lote');
  await platform.runtime.idle();
  s = snap(platform);
  const newAgentCases = platform.cases.list({ project: 'facturas' }).length - casesBefore - 1;
  expect(
    'Repetir el lote no duplica hallazgos ni casos de agente',
    s.stats.ruleFindings === 5 && newAgentCases === 0,
    `hallazgos por regla ${s.stats.ruleFindings} · casos de agente nuevos ${newAgentCases}`,
  );

  await platform.reset();
  s = snap(platform);
  expect(
    'Reset reconstruye el estado desde los JSON',
    s.findings.length === 0 && JSON.stringify(getState(platform).invoices) === JSON.stringify(seed),
    `hallazgos ${s.findings.length}`,
  );
} catch (error) {
  expect('El escenario se ejecuta sin excepciones', false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await platform.shutdown();
}

for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLO'} ${r.label} — ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\nTodo correcto (${results.length} comprobaciones).` : `\n${failed} de ${results.length} comprobaciones fallan.`);
process.exitCode = failed === 0 ? 0 : 1;
