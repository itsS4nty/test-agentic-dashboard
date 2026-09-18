/**
 * Datos del proyecto de facturas: carga de los JSON, estado en el store y utilidades de importes.
 * Los JSON son la semilla; el estado vivo (facturas corregidas, hallazgos) vive en el store.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlatformApi } from '../../platform/contracts.ts';
import type {
  Catalog,
  CatalogProduct,
  Contract,
  ContractsFile,
  FacturasState,
  Invoice,
  InvoiceLine,
  InvoicesFile,
} from './types.ts';

export const PROJECT_ID = 'facturas';
export const STATE_KEY = 'facturas';
export const AGENT_ID = 'facturacion';

function readJson<T>(file: string): T {
  const path = fileURLToPath(new URL(`./data/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

let contractsCache: ContractsFile | undefined;

/** Contratos y catálogo: datos de referencia de solo lectura. `reload` vuelve a leer el fichero. */
export function contractsData(reload = false): ContractsFile {
  if (!contractsCache || reload) contractsCache = readJson<ContractsFile>('contracts.json');
  return contractsCache;
}

export function catalog(): Catalog {
  return contractsData().catalog;
}

export function contractFor(clientId: string): Contract | undefined {
  return contractsData().contracts.find((c) => c.clientId === clientId);
}

// ─────────────────────────────────────────────────────────────
// Estado en el store
// ─────────────────────────────────────────────────────────────

export function seedState(): FacturasState {
  const { invoices } = readJson<InvoicesFile>('invoices.json');
  return { invoices, findings: [], checkedInvoiceIds: [] };
}

/** Estado actual; si no hay (primer arranque o tras `store.clear()`), lo siembra desde los JSON. */
export function getState(platform: PlatformApi): FacturasState {
  let state = platform.store.getValue<FacturasState>(STATE_KEY);
  if (!state) {
    state = seedState();
    platform.store.setValue(STATE_KEY, state);
  }
  return state;
}

/** Guarda tras mutar y avisa a la consola. */
export function saveState(platform: PlatformApi, state: FacturasState): void {
  platform.store.setValue(STATE_KEY, state);
  platform.projects.changed(PROJECT_ID);
}

/** Reconstruye el estado desde los JSON (reset de la demo). */
export function resetState(platform: PlatformApi): FacturasState {
  contractsData(true);
  const state = seedState();
  platform.store.setValue(STATE_KEY, state);
  return state;
}

export function findInvoice(platform: PlatformApi, invoiceId: string): Invoice | undefined {
  return getState(platform).invoices.find((i) => i.id === invoiceId);
}

// ─────────────────────────────────────────────────────────────
// Importes
// ─────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const eurFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

/** 96.8 → "96,80 €" */
export function eur(n: number): string {
  return eurFormat.format(n);
}

export function lineBase(line: Pick<InvoiceLine, 'qty' | 'unitPrice'>): number {
  return round2(line.qty * line.unitPrice);
}

/** Totales calculados desde cantidad × precio (no desde los totales declarados). */
export function computeTotals(lines: Pick<InvoiceLine, 'qty' | 'unitPrice' | 'vatRate'>[]): {
  subtotal: number;
  vatTotal: number;
  total: number;
} {
  const bases = lines.map((l) => ({ base: lineBase(l), vatRate: l.vatRate }));
  const subtotal = round2(bases.reduce((s, l) => s + l.base, 0));
  const vatTotal = round2(bases.reduce((s, l) => s + (l.base * l.vatRate) / 100, 0));
  return { subtotal, vatTotal, total: round2(subtotal + vatTotal) };
}

/** Importe de una línea con IVA, en valor absoluto. */
export function withVat(base: number, vatRate: number): number {
  return round2(Math.abs(base) * (1 + vatRate / 100));
}

// ─────────────────────────────────────────────────────────────
// Descripciones
// ─────────────────────────────────────────────────────────────

export function productFor(sku: string, cat: Catalog = catalog()): CatalogProduct | undefined {
  return cat.products.find((p) => p.sku === sku);
}

export function statusLabel(invoice: Pick<Invoice, 'status'>): string {
  return invoice.status === 'issued' ? 'emitida' : 'borrador';
}

/** "BORR-2609-03 · Pan de Pueblo · Alcalá" */
export function describeInvoice(platform: PlatformApi, invoice: Invoice): string {
  return `${invoice.number} · ${platform.directory.describeScope({ clientId: invoice.clientId, siteId: invoice.siteId })}`;
}
