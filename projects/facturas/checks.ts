/**
 * Capa 1 · comprobaciones deterministas. Funciones puras: misma factura y contrato,
 * mismo resultado, sin IA y con coste 0.
 *
 * Cinco detectan errores concretos. La sexta, `requiere_criterio`, no decide nada: marca lo
 * que una regla no puede juzgar (textos libres, conceptos raros) para que lo revise el agente.
 */
import type { Catalog, Contract, Invoice } from './types.ts';
import { computeTotals, eur, lineBase, productFor, round2, withVat } from './data.ts';

export type CheckId =
  | 'precio_contrato'
  | 'iva_catalogo'
  | 'linea_duplicada'
  | 'total_descuadrado'
  | 'servicio_no_facturado'
  | 'requiere_criterio';

export interface CheckContext {
  contract: Contract | undefined;
  catalog: Catalog;
  /** Facturas del lote en revisión (para comprobaciones que cruzan facturas). */
  batch: Invoice[];
}

export interface CheckHit {
  check: CheckId;
  invoiceId: string;
  /** Distingue hallazgos de la misma comprobación en la misma factura. */
  key: string;
  /** Línea afectada (índice desde 0), si la hay. */
  lineIndex?: number;
  title: string;
  detail: string;
  /** Euros IVA incluido, en valor absoluto. */
  amountImpact: number;
}

export type InvoiceCheck = (invoice: Invoice, ctx: CheckContext) => CheckHit[];

const TOLERANCE = 0.009;

function vatForSku(sku: string, cat: Catalog): number | undefined {
  const product = productFor(sku, cat);
  if (!product) return undefined;
  return cat.categories.find((c) => c.id === product.category)?.vatRate;
}

/** precio_contrato — el precio unitario no coincide con la tarifa pactada. */
export const precioContrato: InvoiceCheck = (invoice, { contract }) => {
  if (!contract) return [];
  const hits: CheckHit[] = [];
  invoice.lines.forEach((line, index) => {
    const rate = contract.rates.find((r) => r.sku === line.sku);
    if (!rate || Math.abs(line.unitPrice - rate.unitPrice) <= TOLERANCE) return;
    const base = round2((line.unitPrice - rate.unitPrice) * line.qty);
    hits.push({
      check: 'precio_contrato',
      invoiceId: invoice.id,
      key: `l${index}`,
      title: `Precio distinto del contrato en ${line.sku}`,
      detail:
        `Línea ${index + 1} "${line.description}": ${line.qty} × ${eur(line.unitPrice)}; ` +
        `el contrato ${contract.number} fija ${eur(rate.unitPrice)}. ` +
        `Se ${base > 0 ? 'cobra de más' : 'deja de cobrar'} ${eur(withVat(base, line.vatRate))} IVA incluido.`,
      amountImpact: withVat(base, line.vatRate),
    });
  });
  return hits;
};

/** iva_catalogo — el tipo de IVA no es el de la categoría del producto en el catálogo. */
export const ivaCatalogo: InvoiceCheck = (invoice, { catalog }) => {
  const hits: CheckHit[] = [];
  invoice.lines.forEach((line, index) => {
    const expected = vatForSku(line.sku, catalog);
    if (expected === undefined || line.vatRate === expected) return;
    const base = lineBase(line);
    const impact = round2(Math.abs((base * (expected - line.vatRate)) / 100));
    hits.push({
      check: 'iva_catalogo',
      invoiceId: invoice.id,
      key: `l${index}`,
      title: `IVA del ${line.vatRate} % donde el catálogo dice ${expected} %`,
      detail:
        `Línea ${index + 1} "${line.description}" (base ${eur(base)}) lleva IVA del ${line.vatRate} %; ` +
        `su categoría en el catálogo tributa al ${expected} %. Diferencia de cuota: ${eur(impact)}.`,
      amountImpact: impact,
    });
  });
  return hits;
};

/** linea_duplicada — dos líneas idénticas (concepto, referencia, cantidad y precio). */
export const lineaDuplicada: InvoiceCheck = (invoice) => {
  const hits: CheckHit[] = [];
  const seen = new Map<string, number>();
  invoice.lines.forEach((line, index) => {
    const signature = [line.sku, line.description.trim().toLowerCase(), line.qty, line.unitPrice].join('|');
    const first = seen.get(signature);
    if (first === undefined) {
      seen.set(signature, index);
      return;
    }
    const impact = withVat(lineBase(line), line.vatRate);
    hits.push({
      check: 'linea_duplicada',
      invoiceId: invoice.id,
      key: `l${index}`,
      title: `Línea duplicada: ${line.sku}`,
      detail:
        `La línea ${index + 1} repite la línea ${first + 1} ("${line.description}", ${line.qty} × ${eur(line.unitPrice)}). ` +
        `Importe cobrado dos veces: ${eur(impact)} IVA incluido.`,
      amountImpact: impact,
    });
  });
  return hits;
};

/** total_descuadrado — los totales declarados no salen de cantidad × precio + IVA. */
export const totalDescuadrado: InvoiceCheck = (invoice) => {
  const computed = computeTotals(invoice.lines);
  const problems: string[] = [];
  invoice.lines.forEach((line, index) => {
    if (Math.abs(line.total - lineBase(line)) > TOLERANCE) {
      problems.push(`línea ${index + 1}: declara ${eur(line.total)} y ${line.qty} × ${eur(line.unitPrice)} = ${eur(lineBase(line))}`);
    }
  });
  if (Math.abs(invoice.subtotal - computed.subtotal) > TOLERANCE) {
    problems.push(`base imponible: declara ${eur(invoice.subtotal)} y suma ${eur(computed.subtotal)}`);
  }
  if (Math.abs(invoice.vatTotal - computed.vatTotal) > TOLERANCE) {
    problems.push(`IVA: declara ${eur(invoice.vatTotal)} y resulta ${eur(computed.vatTotal)}`);
  }
  if (Math.abs(invoice.total - computed.total) > TOLERANCE) {
    problems.push(`total: declara ${eur(invoice.total)} y debería ser ${eur(computed.total)}`);
  }
  if (problems.length === 0) return [];
  return [
    {
      check: 'total_descuadrado',
      invoiceId: invoice.id,
      key: 'totales',
      title: 'El total no cuadra con las líneas',
      detail: `Descuadre en ${problems.join('; ')}.`,
      amountImpact: round2(Math.abs(invoice.total - computed.total)),
    },
  ];
};

/** servicio_no_facturado — un servicio activo de la tienda no aparece en ninguna factura del lote. */
export const servicioNoFacturado: InvoiceCheck = (invoice, { contract, catalog, batch }) => {
  if (!contract || !invoice.recurring) return [];
  const siteInvoices = batch.filter((i) => i.clientId === invoice.clientId && i.siteId === invoice.siteId);
  const billedSkus = new Set(siteInvoices.flatMap((i) => i.lines.map((l) => l.sku)));
  const hits: CheckHit[] = [];
  for (const service of contract.activeServices) {
    if (!service.sites.includes(invoice.siteId) || billedSkus.has(service.sku)) continue;
    const rate = contract.rates.find((r) => r.sku === service.sku);
    const product = productFor(service.sku, catalog);
    const vatRate = vatForSku(service.sku, catalog) ?? 21;
    const impact = rate ? withVat(rate.unitPrice, vatRate) : 0;
    hits.push({
      check: 'servicio_no_facturado',
      invoiceId: invoice.id,
      key: service.sku,
      title: `Servicio activo sin facturar: ${product?.name ?? service.sku}`,
      detail:
        `El contrato ${contract.number} tiene activo "${product?.name ?? service.sku}" en esta tienda ` +
        `(${rate ? eur(rate.unitPrice) : 'sin tarifa'} + IVA al mes) y no aparece en ninguna factura del lote. ` +
        `Se dejan de cobrar ${eur(impact)} IVA incluido.`,
      amountImpact: impact,
    });
  }
  return hits;
};

/**
 * requiere_criterio — marca lo que una regla no puede decidir:
 * descuentos no previstos (su justificación es texto libre), conceptos cuyo texto no es el del
 * producto del catálogo, y productos sin precio pactado.
 */
export const requiereCriterio: InvoiceCheck = (invoice, { contract, catalog }) => {
  const hits: CheckHit[] = [];
  invoice.lines.forEach((line, index) => {
    const product = productFor(line.sku, catalog);
    let reason: string | undefined;
    if (line.unitPrice < 0) {
      reason =
        `Línea ${index + 1} "${line.description}" es un descuento de ${eur(Math.abs(lineBase(line)))} no previsto en el contrato` +
        (invoice.notes ? '; la justificación está en texto libre en las notas.' : '.');
    } else if (!product) {
      reason = `Línea ${index + 1} usa la referencia ${line.sku}, que no existe en el catálogo.`;
    } else if (contract && !contract.rates.some((r) => r.sku === line.sku)) {
      reason = `Línea ${index + 1} factura ${line.sku}, que no tiene precio pactado en el contrato ${contract.number}.`;
    } else if (!line.description.toLowerCase().startsWith(product.name.toLowerCase())) {
      reason =
        `Línea ${index + 1} factura ${line.sku} ("${product.name}") con el concepto "${line.description}": ` +
        `referencia y precio cuadran, pero el texto no es el del servicio contratado.`;
    }
    if (!reason) return;
    hits.push({
      check: 'requiere_criterio',
      invoiceId: invoice.id,
      key: `l${index}`,
      lineIndex: index,
      title: 'Requiere criterio',
      detail: reason,
      amountImpact: withVat(lineBase(line), line.vatRate),
    });
  });
  return hits;
};

/** Las cinco comprobaciones que generan hallazgos por regla, en el orden en que se aplican. */
export const DETERMINISTIC_CHECKS: { id: Exclude<CheckId, 'requiere_criterio'>; label: string; run: InvoiceCheck }[] = [
  { id: 'precio_contrato', label: 'Precio distinto del contrato', run: precioContrato },
  { id: 'iva_catalogo', label: 'IVA distinto del catálogo', run: ivaCatalogo },
  { id: 'linea_duplicada', label: 'Línea duplicada', run: lineaDuplicada },
  { id: 'total_descuadrado', label: 'Total que no cuadra', run: totalDescuadrado },
  { id: 'servicio_no_facturado', label: 'Servicio activo no facturado', run: servicioNoFacturado },
];

/** Aplica las cinco comprobaciones a una factura. */
export function runDeterministicChecks(invoice: Invoice, ctx: CheckContext): CheckHit[] {
  return DETERMINISTIC_CHECKS.flatMap((c) => c.run(invoice, ctx));
}

/** Id estable del hallazgo: repetir la revisión no duplica hallazgos. */
export function findingIdFor(hit: CheckHit): string {
  return `fnd-${hit.check}-${hit.invoiceId}-${hit.key}`;
}

export function checkLabel(id: string): string {
  if (id === 'requiere_criterio') return 'Requiere criterio';
  return DETERMINISTIC_CHECKS.find((c) => c.id === id)?.label ?? id;
}
