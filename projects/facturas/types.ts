/**
 * Tipos del proyecto de facturas. Reflejan la forma de data/contracts.json e invoices.json
 * y el estado que se guarda en el store bajo la clave `facturas`.
 */

export type InvoiceStatus = 'draft' | 'issued';

export interface InvoiceLine {
  description: string;
  sku: string;
  qty: number;
  unitPrice: number;
  /** Porcentaje: 21 significa 21 %. */
  vatRate: number;
  /** Base imponible de la línea: qty × unitPrice. */
  total: number;
}

export interface InvoiceCorrection {
  at: string;
  caseId: string;
  by: string;
  description: string;
  previousTotal: number;
  newTotal: number;
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  siteId: string;
  date: string;
  dueDate: string;
  status: InvoiceStatus;
  /** Cuota mensual de una tienda (sobre ella se comprueban los servicios activos). */
  recurring: boolean;
  concept: string;
  lines: InvoiceLine[];
  subtotal: number;
  vatTotal: number;
  total: number;
  /** Texto libre escrito por una persona. Dato no confiable. */
  notes?: string;
  corrections?: InvoiceCorrection[];
}

export interface CatalogCategory {
  id: string;
  name: string;
  vatRate: number;
}

export interface CatalogProduct {
  sku: string;
  name: string;
  category: string;
  unit: string;
}

export interface Catalog {
  categories: CatalogCategory[];
  products: CatalogProduct[];
}

export interface ContractRate {
  sku: string;
  unitPrice: number;
}

export interface ActiveService {
  sku: string;
  sites: string[];
}

export interface Contract {
  clientId: string;
  number: string;
  signedAt: string;
  validUntil: string;
  billing: string;
  paymentTerms: string;
  serviceScope: string;
  discountPolicy: string;
  rates: ContractRate[];
  activeServices: ActiveService[];
}

export interface ContractsFile {
  catalog: Catalog;
  contracts: Contract[];
}

export interface InvoicesFile {
  period: string;
  invoices: Invoice[];
}

export type FindingLayer = 'rule' | 'llm';
export type FindingStatus = 'open' | 'corrected' | 'dismissed';

export interface Finding {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  layer: FindingLayer;
  /** Id de la comprobación determinista, o `revision_ia` para los de la IA. */
  check: string;
  title: string;
  detail: string;
  /** Euros IVA incluido, en valor absoluto. */
  amountImpact: number;
  status: FindingStatus;
  caseId?: string;
  createdAt: string;
}

export interface BatchResult {
  batchId: string;
  receivedAt: string;
  caseId: string;
  invoiceIds: string[];
  ruleFindingIds: string[];
  judgmentCaseIds: string[];
}

export interface FacturasState {
  invoices: Invoice[];
  findings: Finding[];
  checkedInvoiceIds: string[];
  lastBatch?: BatchResult;
}

export interface InvoiceBatchPayload {
  batchId: string;
  invoiceIds: string[];
}

export interface FacturasSnapshot {
  invoices: {
    id: string;
    number: string;
    clientId: string;
    clientName: string;
    siteId: string;
    siteName: string;
    date: string;
    status: InvoiceStatus;
    total: number;
    findings: number;
  }[];
  findings: {
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    layer: FindingLayer;
    check: string;
    title: string;
    detail: string;
    amountImpact: number;
    status: FindingStatus;
    caseId?: string;
  }[];
  stats: {
    invoicesChecked: number;
    ruleFindings: number;
    llmFindings: number;
    ruleCostUsd: 0;
    llmCostUsd: number;
    ruleImpactEur: number;
    llmImpactEur: number;
  };
}
