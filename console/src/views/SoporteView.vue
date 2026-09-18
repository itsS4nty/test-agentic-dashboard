<script setup lang="ts">
/**
 * Soporte. Cifras de la bandeja, aviso cuando un ticket intenta dar órdenes al agente, y la bandeja
 * como lista tipo correo con el ticket elegido en un panel de detalle: mensaje, borrador o respuesta
 * enviada y, en el ticket sospechoso, lo que la política bloqueó.
 */
import { computed, nextTick, ref } from 'vue';
import type { TimelineEntry } from '../../../platform/contracts.ts';
import { fullTime } from '../components/format.ts';
import { live } from '../live.ts';
import { Badge, Button, Card, KeyValue, Stat, StatGrid, StatusDot, type StatTone, type Status } from '../ui/index.ts';
import CaseLink from './project/CaseLink.vue';
import EmptyState from './project/EmptyState.vue';
import LoadState from './project/LoadState.vue';
import ProjectHeader from './project/ProjectHeader.vue';
import { useSiteNames } from './project/directory.ts';
import { fmtDateTime, fmtTime, pendingApprovalsFor, plural } from './project/format.ts';
import type { SoporteSnapshot, Ticket, TicketStatus } from './project/types.ts';
import { useProjectSnapshot } from './project/useProjectSnapshot.ts';

const { data, loading, error } = useProjectSnapshot<SoporteSnapshot>('soporte');
const siteNames = useSiteNames();

const STATUS: Record<TicketStatus, { label: string; status: Status }> = {
  new: { label: 'Nuevo', status: 'neutral' },
  triaged: { label: 'Clasificado', status: 'neutral' },
  answered: { label: 'Respondido', status: 'success' },
  auto_answered: { label: 'Respondido por regla', status: 'success' },
  escalated: { label: 'Escalado', status: 'danger' },
};

const CATEGORY_LABEL: Record<string, string> = {
  incidencia: 'Incidencia técnica',
  facturacion: 'Facturación',
  consulta: 'Consulta',
  sugerencia: 'Sugerencia',
  queja: 'Queja',
  otro: 'Otro',
};

const PRIORITY_WORDS: { label: string; words: string[] }[] = [
  { label: 'Alta', words: ['alta', 'high', 'urgente', 'urgent', 'critica', 'crítica', 'critical'] },
  { label: 'Media', words: ['media', 'medium', 'normal'] },
  { label: 'Baja', words: ['baja', 'low'] },
];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function categoryLabel(category?: string): string | null {
  if (!category) return null;
  return CATEGORY_LABEL[category.trim().toLowerCase()] ?? capitalize(category);
}

function priorityLabel(priority?: string): string | null {
  if (!priority) return null;
  const key = priority.trim().toLowerCase();
  return PRIORITY_WORDS.find((p) => p.words.includes(key))?.label ?? capitalize(priority);
}

/** "09:41" con la fecha completa en title. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

const tickets = computed(() =>
  [...(data.value?.tickets ?? [])].sort(
    (a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id),
  ),
);
const injected = computed(() => tickets.value.filter((t) => t.injectionDetected));

/** Tickets cuya respuesta espera a que una persona apruebe el envío. */
const pendingReplies = computed(
  () =>
    new Set(
      pendingApprovalsFor('soporte_send_reply', () => true).map((a) => String((a.input as { ticketId?: unknown }).ticketId)),
    ),
);

type ReplyKey = 'sent' | 'pending' | 'draft';

function replyState(t: Ticket): ReplyKey | null {
  if (t.sentReply) return 'sent';
  if (pendingReplies.value.has(t.id)) return 'pending';
  if (t.draftReply) return 'draft';
  return null;
}

interface Row {
  ticket: Ticket;
  status: { label: string; status: Status };
  /** Estado resumido para la bandeja: un clasificado con envío por aprobar pasa a ámbar. */
  inbox: { label: string; status: Status };
  category: string | null;
  priority: string | null;
  reply: ReplyKey | null;
  site: string;
}

const rows = computed<Row[]>(() =>
  tickets.value.map((t) => {
    const status = STATUS[t.status] ?? { label: t.status, status: 'neutral' as Status };
    const reply = replyState(t);
    let inbox = status;
    if (t.status === 'triaged' && reply === 'pending') inbox = { label: 'Envío por aprobar', status: 'warning' };
    else if (t.status === 'triaged' && reply === 'draft') inbox = { label: 'Borrador listo', status: 'neutral' };
    return {
      ticket: t,
      status,
      inbox,
      category: categoryLabel(t.category),
      priority: priorityLabel(t.priority),
      reply,
      site: siteNames.value[t.siteId] ?? t.siteId,
    };
  }),
);

/** Nombre accesible de una fila de la bandeja: las piezas visuales van separadas por comas. */
function mailLabel(row: Row): string {
  return [
    row.ticket.subject,
    `de ${row.ticket.from}`,
    row.site,
    row.inbox.label,
    row.ticket.injectionDetected ? 'inyección detectada' : null,
    row.category,
    row.priority ? `prioridad ${row.priority.toLowerCase()}` : null,
    `recibido a las ${shortTime(row.ticket.receivedAt)}`,
  ]
    .filter(Boolean)
    .join(', ');
}

const selectedId = ref<string | null>(null);
/** Sin selección explícita se abre el ticket con inyección, si lo hay: es lo que hay que ver primero. */
const selectedRow = computed(
  () =>
    rows.value.find((r) => r.ticket.id === selectedId.value) ??
    rows.value.find((r) => r.ticket.injectionDetected) ??
    rows.value[0] ??
    null,
);

/** Acciones que la política bloqueó o escaló en el caso del ticket seleccionado. */
const blockedActions = computed<TimelineEntry[]>(() => {
  const caseId = selectedRow.value?.ticket.caseId;
  if (!caseId) return [];
  return (live.cases[caseId]?.timeline ?? []).filter(
    (e) => e.kind === 'policy' && (e.decision === 'deny' || e.decision === 'escalate'),
  );
});

interface StatCell {
  label: string;
  value: number;
  hint?: string;
  tone?: StatTone;
}

const stats = computed<StatCell[]>(() => {
  const all = tickets.value;
  const count = (status: TicketStatus) => all.filter((t) => t.status === status).length;
  return [
    { label: 'Tickets', value: all.length, hint: `${count('new')} sin tratar` },
    { label: 'Resueltos por regla', value: count('auto_answered'), hint: 'Coste 0' },
    { label: 'Clasificados por IA', value: all.filter((t) => t.category).length },
    {
      label: 'Envíos por aprobar',
      value: pendingReplies.value.size,
      tone: pendingReplies.value.size > 0 ? 'warning' : 'default',
      hint: 'Ninguna respuesta sale sola',
    },
    { label: 'Escalados', value: count('escalated'), hint: 'A una persona' },
    {
      label: 'Con inyección',
      value: injected.value.length,
      tone: injected.value.length > 0 ? 'danger' : 'default',
      hint: 'Tratados como dato',
    },
  ];
});

const detailItems = computed(() => {
  const row = selectedRow.value;
  if (!row) return [];
  return [
    { label: 'Estado', slot: 'estado' },
    { label: 'Categoría', slot: 'categoria' },
    { label: 'Prioridad', slot: 'prioridad' },
    { label: 'Ticket', value: row.ticket.id, mono: true },
  ];
});

// ── Selección: el detalle se lleva a la vista si no se ve (pantallas estrechas) ──
const detail = ref<{ $el: HTMLElement } | null>(null);

function showDetail(focus: boolean) {
  void nextTick(() => {
    const el = detail.value?.$el;
    if (!el) return;
    // La cabecera y las pestañas son fijas: por encima de su alto, el detalle queda tapado.
    const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const { top } = el.getBoundingClientRect();
    const visible = top >= offset - 16 && top <= window.innerHeight - 160;
    if (!visible) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    }
    if (focus) el.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
  });
}

function select(id: string) {
  selectedId.value = id;
  showDetail(false);
}

function selectFirstInjected() {
  const first = injected.value[0];
  if (!first) return;
  selectedId.value = first.id;
  showDetail(true);
}
</script>

<template>
  <section class="support-view">
    <ProjectHeader
      antetitulo="Proyecto · Soporte"
      title="Soporte"
      description="Una regla responde las preguntas frecuentes. Enviar una respuesta del agente pide permiso."
    />

    <LoadState :loading="loading" :error="error" :has-data="!!data" what="la bandeja" />

    <template v-if="data">
      <EmptyState
        v-if="tickets.length === 0"
        title="La bandeja está vacía."
        :scenarios="['Llega la bandeja de la mañana', 'Ticket con intento de manipulación']"
      />

      <template v-else>
        <div v-if="injected.length" class="injection" role="alert">
          <p class="injection__text">
            <strong class="injection__title">Inyección detectada</strong>
            <span class="injection__detail">
              {{ plural(injected.length, 'ticket intenta', 'tickets intentan') }} dar órdenes al agente
              (<span class="mono">{{ injected.map((t) => t.id).join(', ') }}</span>). Se trata como dato.
            </span>
          </p>
          <Button size="sm" @click="selectFirstInjected">Ver ticket</Button>
        </div>

        <StatGrid :columns="6" label="Cifras de soporte">
          <Stat v-for="s in stats" :key="s.label" :label="s.label" :value="s.value" :hint="s.hint" :tone="s.tone" />
        </StatGrid>

        <div class="inbox">
          <Card title="Bandeja" :padded="false" class="inbox__list">
            <template #actions>
              <span class="count" :aria-label="plural(tickets.length, 'ticket', 'tickets')">{{ tickets.length }}</span>
            </template>
            <ul class="mails" aria-label="Tickets">
              <li v-for="row in rows" :key="row.ticket.id" class="mails__item">
                <button
                  type="button"
                  class="mail"
                  :class="{ 'mail--selected': selectedRow?.ticket.id === row.ticket.id }"
                  :aria-current="selectedRow?.ticket.id === row.ticket.id ? 'true' : undefined"
                  :aria-label="mailLabel(row)"
                  @click="select(row.ticket.id)"
                >
                  <span class="mail__top">
                    <span class="mail__from">{{ row.ticket.from }}</span>
                    <time class="mail__time" :datetime="row.ticket.receivedAt" :title="fullTime(row.ticket.receivedAt)">
                      {{ shortTime(row.ticket.receivedAt) }}
                    </time>
                  </span>
                  <span class="mail__subject">{{ row.ticket.subject }}</span>
                  <span class="mail__site">{{ row.site }}</span>
                  <span class="mail__tags">
                    <StatusDot :status="row.inbox.status" :label="row.inbox.label" class="mail__status" />
                    <Badge v-if="row.ticket.injectionDetected" variant="danger" label="Inyección detectada" />
                    <Badge v-if="row.category" :label="row.category" />
                    <Badge v-if="row.priority" variant="outline" :title="`Prioridad ${row.priority.toLowerCase()}`">
                      <span class="sr-only">Prioridad </span>{{ row.priority }}
                    </Badge>
                  </span>
                </button>
              </li>
            </ul>
          </Card>

          <Card v-if="selectedRow" ref="detail" as="article" class="detail" :aria-labelledby="`ticket-${selectedRow.ticket.id}`">
            <template #header>
              <h2 :id="`ticket-${selectedRow.ticket.id}`" class="detail__subject" tabindex="-1" data-detail-heading>
                {{ selectedRow.ticket.subject }}
              </h2>
              <p class="detail__from">{{ selectedRow.ticket.from }}</p>
              <p class="detail__meta">
                {{ selectedRow.site }}&nbsp;·
                <time :datetime="selectedRow.ticket.receivedAt" :title="fullTime(selectedRow.ticket.receivedAt)">{{
                  fmtDateTime(selectedRow.ticket.receivedAt)
                }}</time>
              </p>
            </template>
            <template v-if="selectedRow.ticket.caseId" #actions>
              <CaseLink :case-id="selectedRow.ticket.caseId" label="Ver caso" />
            </template>

            <div class="detail__body">
              <KeyValue layout="stacked" :items="detailItems">
                <template #estado>
                  <StatusDot :status="selectedRow.status.status" :label="selectedRow.status.label" />
                </template>
                <template #categoria>
                  <Badge v-if="selectedRow.category" :label="selectedRow.category" />
                  <span v-else class="subtle">Sin clasificar</span>
                </template>
                <template #prioridad>
                  <Badge v-if="selectedRow.priority" variant="outline" :label="selectedRow.priority" />
                  <span v-else class="subtle">Sin asignar</span>
                </template>
              </KeyValue>

              <section v-if="selectedRow.ticket.injectionDetected" class="block" aria-labelledby="blocked-title">
                <div class="block__head">
                  <Badge variant="danger" label="Inyección detectada" />
                  <span class="block__note">Sus instrucciones no se obedecen; el ticket se escala.</span>
                </div>
                <div class="blocked">
                  <h3 id="blocked-title" class="blocked__title">Bloqueado por la política</h3>
                  <ul v-if="blockedActions.length" class="blocked__list">
                    <li v-for="e in blockedActions" :key="e.id" class="blocked__item">
                      <div class="blocked__row">
                        <span class="mono blocked__tool">{{ e.tool ?? e.title }}</span>
                        <span class="sr-only">: </span>
                        <Badge variant="danger" :label="e.decision === 'deny' ? 'Denegado' : 'Escalado'" />
                        <span class="sr-only">, </span>
                        <span class="blocked__exec">{{ e.executed ? 'Ejecutado' : 'No ejecutado' }}</span>
                        <time class="blocked__time" :datetime="e.at" :title="fullTime(e.at)">{{ fmtTime(e.at) }}</time>
                      </div>
                      <p class="blocked__detail">{{ e.detail ?? e.title }}</p>
                    </li>
                  </ul>
                  <EmptyState
                    v-else
                    compact
                    title="Aún nadie ha intentado ejecutar nada desde este ticket."
                    :scenarios="['Prueba de fuego: forzar un abono desde ese ticket']"
                    hint="La acción quedará denegada y visible en la traza."
                  />
                </div>
              </section>

              <section class="block" aria-labelledby="message-title">
                <h3 id="message-title" class="block__title">
                  Mensaje recibido
                  <Badge :variant="selectedRow.ticket.injectionDetected ? 'danger' : 'outline'" label="Dato no confiable" />
                </h3>
                <div class="text-box">{{ selectedRow.ticket.body }}</div>
              </section>

              <section v-if="selectedRow.ticket.sentReply" class="block" aria-labelledby="reply-title">
                <h3 id="reply-title" class="block__title">
                  Respuesta enviada
                  <StatusDot status="success" label="Enviada" class="block__status" />
                </h3>
                <div class="text-box">{{ selectedRow.ticket.sentReply }}</div>
              </section>
              <section v-else-if="selectedRow.ticket.draftReply" class="block" aria-labelledby="reply-title">
                <h3 id="reply-title" class="block__title">
                  Borrador del agente
                  <StatusDot
                    v-if="selectedRow.reply === 'pending'"
                    status="warning"
                    label="Envío pendiente de aprobación"
                    class="block__status"
                  />
                </h3>
                <div class="text-box text-box--draft">{{ selectedRow.ticket.draftReply }}</div>
                <p v-if="selectedRow.reply === 'pending'" class="block__foot">
                  <a href="#aprobaciones">Ir a Aprobaciones</a>
                </p>
              </section>
              <p v-else class="no-reply">Sin respuesta todavía.</p>
            </div>
          </Card>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.support-view {
  container: support / inline-size;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

/* ── Aviso de inyección ────────────────────── */
.injection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 8px 8px 8px 16px;
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  line-height: 20px;
}
.injection__text {
  flex: 1 1 320px;
  min-width: 0;
  color: var(--fg);
}
.injection__title {
  margin-right: 8px;
  font-weight: 600;
  color: var(--danger);
}
.injection__detail .mono {
  font-size: var(--text-xs);
}

/* ── Bandeja + detalle ─────────────────────── */
.inbox {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
@container support (min-width: 760px) {
  .inbox {
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  }
}

.count {
  font-size: var(--text-sm);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}

.mails {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mails__item + .mails__item {
  border-top: 1px solid var(--border);
}
.mails__item:last-child .mail {
  border-radius: 0 0 calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px);
}

.mail {
  appearance: none;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: 100%;
  margin: 0;
  padding: 12px 16px;
  border: 0;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms var(--ease);
}
.mail:hover {
  background: var(--bg-hover);
}
.mail--selected,
.mail--selected:hover {
  background: var(--bg-muted);
}
/* Sobre el gris de hover y selección, las etiquetas neutras toman el fondo de página para no fundirse con la fila. */
.mail:hover :deep(.badge--neutral),
.mail--selected :deep(.badge--neutral) {
  background: var(--bg);
}
/* Filete de 2px a la izquierda de la fila elegida. */
.mail--selected::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--fg);
}
.mail:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.mail__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.mail__from {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.mail__time {
  flex: none;
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}
.mail__subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
}
.mail__site {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.mail__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 8px;
  min-width: 0;
}
.mail__status {
  margin-right: 4px;
  font-size: var(--text-sm);
}

/* ── Detalle ───────────────────────────────── */
.detail {
  scroll-margin-top: calc(var(--header-h) + var(--tabs-h) + 16px);
}
.detail__subject {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
  color: var(--fg);
  text-wrap: balance;
}
.detail__subject:focus-visible {
  border-radius: var(--radius-sm);
}
.detail__from {
  margin-top: 2px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.detail__meta {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}

.detail__body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-top: 4px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.block__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}
.block__note {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.block__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
}
.block__status {
  font-weight: 400;
  color: var(--fg-muted);
}
.block__foot {
  font-size: var(--text-sm);
  line-height: 20px;
}

.text-box {
  padding: 12px 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--text-base);
  line-height: 22px;
  color: var(--fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.text-box--draft {
  background: var(--bg);
  border-style: dashed;
  border-color: var(--border-strong);
}

.no-reply {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-subtle);
}

/* Acciones bloqueadas */
.blocked {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.blocked__title {
  padding: 8px 16px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
}
.blocked > :deep(.empty) {
  padding: 12px 16px;
}
.blocked__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.blocked__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
}
.blocked__item + .blocked__item {
  border-top: 1px solid var(--border);
}
.blocked__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: var(--text-sm);
  line-height: 20px;
}
.blocked__tool {
  font-size: var(--text-xs);
  color: var(--fg);
}
.blocked__exec {
  font-weight: 500;
  color: var(--fg);
}
.blocked__time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}
.blocked__detail {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
</style>
