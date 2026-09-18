/**
 * Guion del modo simulado para el agente `facturacion`.
 * Secuencia: leer factura → leer contrato → registrar hallazgos → proponer corrección → resumen.
 * El análisis sale de los datos reales (misma factura, mismo contrato), no de textos fijos.
 */
import type { MockContext, MockScript, MockToolResult, MockTurn } from '../../platform/contracts.ts';
import { requiereCriterio } from './checks.ts';
import { catalog, computeTotals, contractFor, describeInvoice, eur, findInvoice, lineBase, round2, withVat } from './data.ts';
import type { Contract, Invoice } from './types.ts';

interface Issue {
  lineIndex: number;
  kind: 'discount' | 'concept';
  title: string;
  detail: string;
  amountImpact: number;
}

/** Palabras que delatan maquinaria de obrador, excluida del objeto del contrato. */
const WORKSHOP_WORDS = ['horno', 'cámara', 'amasadora', 'balanza', 'fermentación'];

function analyse(invoice: Invoice, contract: Contract): Issue[] {
  return requiereCriterio(invoice, { contract, catalog: catalog(), batch: [invoice] }).map((hit) => {
    const index = hit.lineIndex ?? 0;
    const line = invoice.lines[index];
    const amount = withVat(lineBase(line), line.vatRate);
    if (line.unitPrice < 0) {
      return {
        lineIndex: index,
        kind: 'discount',
        title: 'Descuento sin respaldo en el contrato',
        detail:
          `Línea ${index + 1} "${line.description}": ${eur(Math.abs(lineBase(line)))} de base, ${eur(amount)} con IVA. ` +
          `El contrato ${contract.number} no prevé descuentos y exige acuerdo por escrito firmado por ambas partes. ` +
          'La única justificación es la nota de la factura, que habla de un acuerdo telefónico que no consta por escrito. ' +
          'Puede tener sentido comercial, pero tal como está no tiene soporte.',
        amountImpact: amount,
      };
    }
    const mentions = WORKSHOP_WORDS.filter((w) => line.description.toLowerCase().includes(w));
    return {
      lineIndex: index,
      kind: 'concept',
      title: 'Concepto que no encaja con el servicio contratado',
      detail:
        `Línea ${index + 1} factura "${line.description}" con la referencia ${line.sku} ` +
        `(${line.qty} × ${eur(line.unitPrice)}, ${eur(amount)} con IVA). ` +
        (mentions.length > 0
          ? `Menciona ${mentions.join(', ')}: maquinaria de obrador que el contrato ${contract.number} excluye expresamente. `
          : `El texto no corresponde al servicio de esa referencia en el contrato ${contract.number}. `) +
        'Parece un trabajo que no corresponde a este contrato, facturado con la tarifa de visita técnica.',
      amountImpact: amount,
    };
  });
}

function lastResult(ctx: MockContext, name: string): MockToolResult | undefined {
  return [...ctx.allResults].reverse().find((r) => r.name === name);
}

function firstLine(text: string): string {
  return text.split('\n')[0];
}

function closing(where: string, issued: boolean, findings: MockToolResult[], correction: MockToolResult): string {
  const n = findings.length;
  const atStake = round2(findings.reduce((sum, f) => sum + Math.abs(Number(f.input?.amountImpact) || 0), 0));
  const head =
    `Resumen: he revisado ${where} (${issued ? 'emitida' : 'borrador'}) contra el contrato y he registrado ` +
    `${n} ${n === 1 ? 'hallazgo' : 'hallazgos'} con ${eur(atStake)} en juego.`;
  switch (correction.decision) {
    case 'escalate':
      return (
        `${head} No la he modificado: está emitida y la política ha escalado la rectificativa a una persona. ` +
        'Pendiente: que administración valide el hallazgo y decida si emite la rectificativa.'
      );
    case 'approve':
      return `${head} He propuesto corregir el borrador. Pendiente: aprobación humana; no se aplica hasta entonces.`;
    case 'shadow':
      return `${head} El dial está en modo sombra: la corrección ha quedado registrada pero no se ha aplicado.`;
    case 'deny':
      return `${head} La política ha bloqueado la corrección (${firstLine(correction.content)}). Pendiente: revisión manual.`;
    default:
      return correction.ok
        ? `${head} ${firstLine(correction.content)}`
        : `${head} La corrección no se ha podido aplicar: ${firstLine(correction.content)} Pendiente: revisión manual.`;
  }
}

export const facturacionMock: MockScript = (ctx): MockTurn => {
  const invoiceId = String(ctx.caseRecord.data?.invoiceId ?? '');

  const readInvoice = lastResult(ctx, 'facturas_get_invoice');
  if (!readInvoice) {
    return {
      text: 'Empiezo por leer la factura que han marcado las reglas.',
      toolCalls: [{ name: 'facturas_get_invoice', input: { invoiceId } }],
    };
  }
  const invoice = findInvoice(ctx.platform, invoiceId);
  if (!readInvoice.executed || !readInvoice.ok || !invoice) {
    return { text: `No he podido leer la factura ${invoiceId}: ${firstLine(readInvoice.content)} Queda pendiente de revisión manual.` };
  }
  const where = describeInvoice(ctx.platform, invoice);
  const issued = invoice.status === 'issued';

  const readContract = lastResult(ctx, 'facturas_get_contract');
  if (!readContract) {
    return {
      text:
        `${where} es ${issued ? 'una factura ya emitida' : 'un borrador sin emitir'}. ` +
        'Consulto el contrato del cliente para comparar conceptos, precios y condiciones.',
      toolCalls: [{ name: 'facturas_get_contract', input: { clientId: invoice.clientId } }],
    };
  }
  const contract = contractFor(invoice.clientId);
  if (!readContract.executed || !readContract.ok || !contract) {
    return { text: `No he podido leer el contrato de ${where}: ${firstLine(readContract.content)} Queda pendiente de revisión manual.` };
  }

  const findings = ctx.allResults.filter((r) => r.name === 'facturas_record_finding');
  const correction = lastResult(ctx, 'facturas_propose_correction');
  if (correction) return { text: closing(where, issued, findings, correction) };

  const issues = analyse(invoice, contract);
  if (issues.length === 0) {
    return { text: `He revisado ${where} contra el contrato ${contract.number} y no encuentro nada que corregir.` };
  }
  const atStake = round2(issues.reduce((sum, i) => sum + i.amountImpact, 0));

  if (findings.length === 0) {
    const reading = issues
      .map((i) =>
        i.kind === 'discount'
          ? `El descuento de la línea ${i.lineIndex + 1} no está previsto en el contrato, que exige acuerdo por escrito; solo lo respalda una nota en texto libre.`
          : `La línea ${i.lineIndex + 1} usa una referencia y un precio correctos, pero el concepto no encaja con el servicio contratado.`,
      )
      .join(' ');
    return {
      text: `${reading} Importe en juego: ${eur(atStake)} IVA incluido. Registro ${issues.length === 1 ? 'el hallazgo' : 'los hallazgos'} antes de proponer nada.`,
      toolCalls: issues.map((i) => ({
        name: 'facturas_record_finding',
        input: { invoiceId, title: i.title, detail: i.detail, amountImpact: i.amountImpact },
      })),
    };
  }

  const removed = new Set(issues.map((i) => i.lineIndex));
  const keep = invoice.lines
    .filter((_, index) => !removed.has(index))
    .map(({ description, sku, qty, unitPrice, vatRate }) => ({ description, sku, qty, unitPrice, vatRate }));
  const newTotal = computeTotals(keep).total;
  const lineList = [...removed].map((i) => i + 1).join(' y ');
  const what = issues.map((i) => i.title.toLowerCase()).join('; ');
  return {
    text: issued
      ? `${invoice.number} ya está emitida, así que no la voy a modificar. Solicito la rectificativa para que la decida una persona.`
      : `Es un borrador: propongo retirar la línea ${lineList}. El total pasaría de ${eur(invoice.total)} a ${eur(newTotal)}.`,
    toolCalls: [
      {
        name: 'facturas_propose_correction',
        input: {
          invoiceId,
          description: issued
            ? `Emitir rectificativa de ${invoice.number} que anule la línea ${lineList} (${what}). Total ${eur(invoice.total)} → ${eur(newTotal)}.`
            : `Retirar la línea ${lineList} del borrador (${what}).`,
          newLines: keep,
        },
      },
    ],
  };
};
