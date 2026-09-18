<script setup lang="ts">
/**
 * Facturas (docs/DESIGN.md § 6). Cifras de la revisión (reglas frente a IA), tabla de hallazgos
 * con su capa, impacto, estado y caso, y tabla de facturas del lote.
 */
import { computed, ref } from 'vue';
import Badge from '../ui/Badge.vue';
import Card from '../ui/Card.vue';
import PageHeader from '../ui/PageHeader.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Stat from '../ui/Stat.vue';
import StatGrid from '../ui/StatGrid.vue';
import StatusDot from '../ui/StatusDot.vue';
import type { BadgeVariant, SegmentedOption, Status } from '../ui/types.ts';
import CaseLink from './project/CaseLink.vue';
import EmptyState from './project/EmptyState.vue';
import LoadState from './project/LoadState.vue';
import { fmtDate, fmtEur, fmtEurSigned, fmtUsd, plural } from './project/format.ts';
import type {
  FacturasSnapshot,
  FacturasStats,
  Finding,
  FindingLayer,
  FindingStatus,
  InvoiceRow,
  InvoiceStatus,
} from './project/types.ts';
import { useProjectSnapshot } from './project/useProjectSnapshot.ts';

const { data, loading, error } = useProjectSnapshot<FacturasSnapshot>('facturas');

const LAYER: Record<FindingLayer, { label: string; variant: BadgeVariant }> = {
  rule: { label: 'Regla', variant: 'neutral' },
  llm: { label: 'IA', variant: 'inverted' },
};

const FINDING_STATUS: Record<FindingStatus, { label: string; status: Status }> = {
  open: { label: 'Abierto', status: 'neutral' },
  corrected: { label: 'Corregido', status: 'success' },
  dismissed: { label: 'Descartado', status: 'neutral' },
};

const INVOICE_STATUS: Record<InvoiceStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Borrador', variant: 'outline' },
  issued: { label: 'Emitida', variant: 'neutral' },
};

const EMPTY_STATS: FacturasStats = {
  invoicesChecked: 0,
  ruleFindings: 0,
  llmFindings: 0,
  ruleCostUsd: 0,
  llmCostUsd: 0,
};

const stats = computed(() => data.value?.stats ?? EMPTY_STATS);
const findings = computed(() => data.value?.findings ?? []);
const invoices = computed(() =>
  [...(data.value?.invoices ?? [])].sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true })),
);
const invoiceById = computed(() => new Map<string, InvoiceRow>(invoices.value.map((inv) => [inv.id, inv])));

const byLayer = (layer: FindingLayer) => findings.value.filter((f) => f.layer === layer);
const impactOf = (list: Finding[]) => list.reduce((sum, f) => sum + f.amountImpact, 0);

const ruleImpact = computed(() => impactOf(byLayer('rule')));
const llmImpact = computed(() => impactOf(byLayer('llm')));
const totalImpact = computed(() => impactOf(findings.value));
const costPerRuleFinding = computed(() =>
  stats.value.ruleFindings > 0 ? stats.value.ruleCostUsd / stats.value.ruleFindings : 0,
);
const costPerLlmFinding = computed(() =>
  stats.value.llmFindings > 0 ? stats.value.llmCostUsd / stats.value.llmFindings : 0,
);

const reviewed = computed(() => stats.value.invoicesChecked > 0 || findings.value.length > 0);
const openFindings = computed(() => findings.value.filter((f) => f.status === 'open').length);
const invoicesWithFindings = computed(() => invoices.value.filter((inv) => inv.findings > 0));

// ── Hallazgos ───────────────────────────────

type LayerFilter = 'all' | FindingLayer;
const layerFilter = ref<LayerFilter>('all');

const layerOptions = computed<SegmentedOption<LayerFilter>[]>(() => [
  { value: 'all', label: `Todos ${findings.value.length}` },
  { value: 'rule', label: `Reglas ${byLayer('rule').length}` },
  { value: 'llm', label: `IA ${byLayer('llm').length}` },
]);

const visibleFindings = computed(() =>
  findings.value
    .filter((f) => layerFilter.value === 'all' || f.layer === layerFilter.value)
    .sort(
      (a, b) =>
        a.invoiceNumber.localeCompare(b.invoiceNumber, 'es', { numeric: true }) ||
        (a.layer === b.layer ? 0 : a.layer === 'rule' ? -1 : 1),
    ),
);

const visibleImpact = computed(() => impactOf(visibleFindings.value));

// ── Facturas ────────────────────────────────

type InvoiceFilter = 'all' | 'findings';
const invoiceFilter = ref<InvoiceFilter>('all');

const invoiceOptions = computed<SegmentedOption<InvoiceFilter>[]>(() => [
  { value: 'all', label: `Todas ${invoices.value.length}` },
  { value: 'findings', label: `Con hallazgos ${invoicesWithFindings.value.length}` },
]);

const visibleInvoices = computed(() =>
  invoiceFilter.value === 'findings' ? invoicesWithFindings.value : invoices.value,
);
</script>

<template>
  <section class="facturas">
    <PageHeader
      title="Revisión de facturas"
      description="Las reglas revisan cada factura sin coste; la IA solo mira lo que exige criterio."
    />

    <LoadState :loading="loading" :error="error" :has-data="!!data" what="las facturas" />

    <template v-if="data">
      <EmptyState
        v-if="!reviewed"
        title="Todavía no se ha revisado ningún lote."
        :scenarios="['Revisar el lote de facturas de septiembre']"
        hint="Primero pasan las reglas; lo dudoso va al agente de facturación."
      />

      <template v-else>
        <StatGrid :columns="4" label="Resultado de la revisión">
          <Stat
            label="Facturas revisadas"
            :value="stats.invoicesChecked"
            :hint="`${invoicesWithFindings.length} con hallazgos`"
          />
          <Stat
            label="Hallazgos por reglas"
            :value="stats.ruleFindings"
            :hint="`Coste ${fmtUsd(stats.ruleCostUsd)} · ${fmtEur(ruleImpact)}`"
            :title="`Coste por hallazgo: ${fmtUsd(costPerRuleFinding)}`"
          />
          <Stat
            label="Hallazgos por IA"
            :value="stats.llmFindings"
            :hint="`Coste ${fmtUsd(stats.llmCostUsd)} · ${fmtEur(llmImpact)}`"
            :title="`Coste por hallazgo: ${fmtUsd(costPerLlmFinding)}`"
          />
          <Stat
            label="Impacto detectado"
            :value="fmtEur(totalImpact)"
            :hint="plural(openFindings, 'hallazgo abierto', 'hallazgos abiertos')"
          />
        </StatGrid>

        <Card title="Hallazgos" :padded="false">
          <template #actions>
            <SegmentedControl
              v-model="layerFilter"
              :options="layerOptions"
              size="sm"
              aria-label="Filtrar hallazgos por capa"
            />
          </template>

          <div class="scroll" role="region" aria-label="Tabla de hallazgos" tabindex="0">
            <table class="table findings">
              <thead>
                <tr>
                  <th scope="col">Factura</th>
                  <th scope="col">Capa</th>
                  <th scope="col">Hallazgo</th>
                  <th scope="col" class="num">Impacto</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Caso</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in visibleFindings" :key="f.id">
                  <td class="cell-invoice">
                    <span class="invoice-number">{{ f.invoiceNumber }}</span>
                    <span v-if="invoiceById.get(f.invoiceId)" class="cell-sub">
                      {{ invoiceById.get(f.invoiceId)?.clientName }}
                    </span>
                  </td>
                  <td>
                    <Badge :variant="LAYER[f.layer].variant" :label="LAYER[f.layer].label" />
                  </td>
                  <td class="cell-finding">
                    <span class="finding-title">{{ f.title }}</span>
                    <span class="finding-detail" :title="f.detail">{{ f.detail }}</span>
                    <span class="sr-only">Comprobación {{ f.check }}</span>
                  </td>
                  <td class="num nowrap">{{ fmtEurSigned(f.amountImpact) }}</td>
                  <td class="nowrap">
                    <StatusDot
                      :status="FINDING_STATUS[f.status]?.status ?? 'neutral'"
                      :label="FINDING_STATUS[f.status]?.label ?? f.status"
                      :muted="f.status === 'dismissed'"
                    />
                  </td>
                  <td class="nowrap"><CaseLink :case-id="f.caseId" /></td>
                </tr>
                <tr v-if="!visibleFindings.length">
                  <td colspan="6" class="cell-empty">No hay hallazgos en esta capa.</td>
                </tr>
              </tbody>
              <tfoot v-if="visibleFindings.length">
                <tr>
                  <th scope="row" colspan="3">Impacto</th>
                  <td class="num nowrap">{{ fmtEur(visibleImpact) }}</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </template>

      <Card v-if="invoices.length" title="Facturas" :padded="false">
        <template #actions>
          <SegmentedControl
            v-if="reviewed"
            v-model="invoiceFilter"
            :options="invoiceOptions"
            size="sm"
            aria-label="Filtrar facturas"
          />
          <span v-else class="count">{{ plural(invoices.length, 'factura', 'facturas') }}</span>
        </template>

        <div class="scroll" role="region" aria-label="Tabla de facturas del lote" tabindex="0">
          <table class="table invoices">
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Cliente</th>
                <th scope="col">Fecha</th>
                <th scope="col">Estado</th>
                <th scope="col" class="num">Total</th>
                <th scope="col" class="num">Hallazgos</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in visibleInvoices" :key="inv.id">
                <td class="nowrap"><span class="invoice-number">{{ inv.number }}</span></td>
                <td>{{ inv.clientName }}</td>
                <td class="nowrap tabular">{{ fmtDate(inv.date) }}</td>
                <td>
                  <Badge
                    :variant="INVOICE_STATUS[inv.status]?.variant ?? 'neutral'"
                    :label="INVOICE_STATUS[inv.status]?.label ?? inv.status"
                  />
                </td>
                <td class="num nowrap">{{ fmtEur(inv.total) }}</td>
                <td class="num">
                  <span :class="inv.findings > 0 ? 'findings-count' : 'findings-none'">{{ inv.findings }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>
  </section>
</template>

<style scoped>
.facturas {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.count {
  font-size: var(--text-sm);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}

/* ── Tablas ───────────────────────────────── */
.scroll {
  overflow-x: auto;
}
.scroll:focus-visible {
  outline-offset: -2px;
}
.findings {
  min-width: 800px;
}
/* Filas de varias líneas: todo alineado con la primera (factura, capa, título, importe…). */
.findings tbody td {
  vertical-align: top;
  line-height: 20px;
}
.invoices {
  min-width: 640px;
}
.nowrap {
  white-space: nowrap;
}
.tabular {
  font-variant-numeric: tabular-nums;
}

.invoice-number {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cell-invoice {
  white-space: nowrap;
}
.cell-invoice,
.cell-finding {
  line-height: 20px;
}
.cell-invoice .invoice-number,
.cell-sub,
.finding-title {
  display: block;
}
.cell-sub {
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-subtle);
}

.cell-finding {
  width: 100%;
  min-width: 280px;
}
.finding-title {
  font-weight: 500;
  color: var(--fg);
}
.finding-detail {
  display: -webkit-box;
  max-width: 80ch;
  margin-top: 2px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-muted);
}

.cell-empty {
  padding-block: 24px;
  text-align: center;
  color: var(--fg-muted);
}

table.table tfoot th,
table.table tfoot td {
  padding: 11px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
  font-weight: 600;
  text-align: left;
  color: var(--fg);
}
table.table tfoot td.num {
  text-align: right;
}

.findings-count {
  font-weight: 600;
  color: var(--fg);
}
.findings-none {
  color: var(--fg-subtle);
}
</style>
