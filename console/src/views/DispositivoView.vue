<script setup lang="ts">
/**
 * Dispositivos en tienda. Cifras de la red, una tabla de tiendas por cliente (datáfono, impresora
 * y router con su estado y versión, reinicios de la última hora y casos abiertos) y, debajo, los
 * avisos a tienda y las visitas de técnico.
 */
import { computed } from 'vue';
import type { Case } from '../../../platform/contracts.ts';
import { fullTime, useNow } from '../components/format.ts';
import { Button, Card, CASE_STATUS, DEVICE_STATUS, Stat, StatGrid, StatusDot, type StatTone } from '../ui/index.ts';
import CaseLink from './project/CaseLink.vue';
import EmptyState from './project/EmptyState.vue';
import LoadState from './project/LoadState.vue';
import ProjectHeader from './project/ProjectHeader.vue';
import { fmtDateTime, fmtTime, openCasesOf, plural } from './project/format.ts';
import type {
  DeviceStatus,
  DeviceType,
  DispositivoDevice,
  DispositivoSite,
  DispositivoSnapshot,
} from './project/types.ts';
import { useProjectSnapshot } from './project/useProjectSnapshot.ts';

const { data, loading, error } = useProjectSnapshot<DispositivoSnapshot>('dispositivo');

const RECENT = 8;

/** Versión de firmware de datáfono con el fallo de timeout y la que lo corrige. */
const AFFECTED_VERSION = '2.14.2';
const FIXED_VERSION = '2.14.3';

const DEVICE_COLUMNS: { type: DeviceType; label: string }[] = [
  { type: 'datafono', label: 'Datáfono' },
  { type: 'impresora', label: 'Impresora' },
  { type: 'router', label: 'Router' },
];

const QUIET_SCENARIOS = ['Datáfono bloqueado', 'Ola de bloqueos tras la versión 2.14.2'];

const sites = computed(() => data.value?.sites ?? []);
const devices = computed(() => sites.value.flatMap((s) => s.devices));

/** Incidencia = no operativo y no está ya reiniciándose (eso se arregla solo en segundos). */
const isIncident = (d: DispositivoDevice) => d.status !== 'ok' && d.status !== 'restarting';

interface ClientGroup {
  id: string;
  name: string;
  sites: DispositivoSite[];
  issues: number;
}

const groups = computed<ClientGroup[]>(() => {
  const snap = data.value;
  if (!snap) return [];
  const byClient = snap.clients.map((c) => ({
    id: c.id,
    name: c.name,
    sites: snap.sites.filter((s) => s.clientId === c.id),
  }));
  const orphans = snap.sites.filter((s) => !snap.clients.some((c) => c.id === s.clientId));
  if (orphans.length) byClient.push({ id: '_otras', name: 'Otras tiendas', sites: orphans });
  return byClient
    .filter((g) => g.sites.length > 0)
    .map((g) => ({
      ...g,
      issues: g.sites.reduce((n, s) => n + s.devices.filter(isIncident).length, 0),
    }));
});

const countStatus = (status: DeviceStatus) => devices.value.filter((d) => d.status === status).length;

interface StatCell {
  label: string;
  value: number;
  hint?: string;
  tone?: StatTone;
}

/** Cifras de la red. «Datáfonos en 2.14.2» queda en rojo mientras quede alguno. */
const stats = computed<StatCell[]>(() => {
  const all = devices.value;
  const datafonos = all.filter((d) => d.type === 'datafono');
  const affected = datafonos.filter((d) => d.softwareVersion === AFFECTED_VERSION).length;
  const fixed = datafonos.filter((d) => d.softwareVersion === FIXED_VERSION).length;
  const incidents = all.filter(isIncident).length;
  const incidentParts = (
    [
      [countStatus('locked'), 'bloqueados', 'bloqueado'],
      [countStatus('offline'), 'sin conexión', 'sin conexión'],
      [countStatus('paper_out'), 'sin papel', 'sin papel'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, many, one]) => `${n} ${n === 1 ? one : many}`);

  return [
    { label: 'Tiendas', value: sites.value.length, hint: plural(all.length, 'dispositivo', 'dispositivos') },
    {
      label: 'Con incidencia',
      value: incidents,
      tone: incidents > 0 ? 'danger' : 'default',
      hint: incidentParts.length ? incidentParts.join(' · ') : 'Todo operativo',
    },
    { label: 'Reiniciando', value: countStatus('restarting'), hint: 'Vuelven solos en segundos' },
    { label: 'Cobros en curso', value: all.filter((d) => d.transactionInFlight).length, hint: 'Impiden reiniciar' },
    {
      label: `Datáfonos en ${AFFECTED_VERSION}`,
      value: affected,
      tone: affected > 0 ? 'danger' : 'default',
      hint: 'Fallo tras timeout de cobro',
    },
    {
      label: `Datáfonos en ${FIXED_VERSION}`,
      value: fixed,
      tone: fixed > 0 ? 'success' : 'default',
      hint: fixed > 0 ? 'Con el arreglo' : 'Pendiente del arreglo',
    },
  ];
});

const openCases = computed(() => openCasesOf('dispositivo'));

/** Casos abiertos de la tienda: por ámbito o, en una ola, por la lista de tiendas afectadas. */
function casesForSite(site: DispositivoSite): Case[] {
  return openCases.value
    .filter((c) => {
      if (c.scope?.siteId === site.id) return true;
      const affected = c.data?.sites;
      return Array.isArray(affected) && affected.includes(site.id);
    })
    .slice(0, 3);
}

const devicesOf = (site: DispositivoSite, type: DeviceType) => site.devices.filter((d) => d.type === type);

function versionTone(d: DispositivoDevice): 'fixed' | 'plain' {
  return d.type === 'datafono' && d.softwareVersion === FIXED_VERSION ? 'fixed' : 'plain';
}

function deviceTitle(d: DispositivoDevice): string {
  const parts = [`${d.label} · ${d.model}`];
  if (d.type === 'datafono' && d.softwareVersion === AFFECTED_VERSION) {
    parts.push(`Versión ${AFFECTED_VERSION}: no se recupera tras un timeout de cobro`);
  } else if (d.type === 'datafono' && d.softwareVersion === FIXED_VERSION) {
    parts.push(`Versión ${FIXED_VERSION}: incluye el arreglo del agente de código`);
  } else {
    parts.push(`Versión ${d.softwareVersion}`);
  }
  parts.push(plural(d.restartsLastHour, 'reinicio en la última hora', 'reinicios en la última hora'));
  if (d.lastRestartAt) parts.push(`Último reinicio a las ${fmtTime(d.lastRestartAt)}`);
  if (d.transactionInFlight) parts.push('Cobro en curso: no se puede reiniciar');
  return parts.join('\n');
}

// ── Reinicios de la tienda en la última hora ──
const restartsOf = (site: DispositivoSite) => site.devices.reduce((n, d) => n + d.restartsLastHour, 0);
const maxRestartsOf = (site: DispositivoSite) => Math.max(0, ...site.devices.map((d) => d.restartsLastHour));

function restartsTitle(site: DispositivoSite): string {
  const withRestarts = site.devices.filter((d) => d.restartsLastHour > 0);
  if (!withRestarts.length) return 'Sin reinicios en la última hora';
  return withRestarts.map((d) => `${d.label}: ${d.restartsLastHour} reinicio${d.restartsLastHour === 1 ? '' : 's'}/h`).join('\n');
}

// ── Horario ──
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const now = useNow();
/** Minuto del día: cambia una vez por minuto, así la tabla no se repinta con cada segundo del reloj. */
const minuteOfDay = computed(() => {
  const date = new Date(now.value);
  return date.getHours() * 60 + date.getMinutes();
});
function isOpenNow(site: DispositivoSite): boolean {
  return minuteOfDay.value >= toMinutes(site.open) && minuteOfDay.value < toMinutes(site.close);
}

// ── Avisos y visitas ──
const siteById = computed(() => new Map(sites.value.map((s) => [s.id, s])));

function siteLabel(siteId: string): string {
  const s = siteById.value.get(siteId);
  return s ? `${s.clientName} · ${s.name}` : siteId;
}

function siteParts(siteId: string): { name: string; client?: string } {
  const s = siteById.value.get(siteId);
  return s ? { name: s.name, client: s.clientName } : { name: siteId };
}

function deviceLabel(deviceId: string): string {
  return deviceId.includes(':') ? deviceId.slice(deviceId.indexOf(':') + 1) : deviceId;
}

const notices = computed(() =>
  [...(data.value?.storeNotices ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT),
);
const fieldTickets = computed(() =>
  [...(data.value?.fieldTickets ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT),
);

const allQuiet = computed(
  () =>
    devices.value.every((d) => d.status === 'ok' && d.restartsLastHour === 0) &&
    notices.value.length === 0 &&
    fieldTickets.value.length === 0 &&
    openCases.value.length === 0,
);

function openDirector(scenario: string) {
  window.dispatchEvent(new CustomEvent('abrir-director', { detail: scenario }));
}
</script>

<template>
  <section class="devices-view">
    <ProjectHeader
      antetitulo="Proyecto · Dispositivos"
      title="Dispositivos en tienda"
      description="Datáfono, impresora y router de cada tienda. Una regla reinicia lo que se bloquea."
    >
      <template v-if="data" #aside>
        <span
          class="ambient"
          :title="`Actividad de fondo ${data.ambient ? 'activa' : 'desactivada'}. Se cambia desde el director de demo.`"
        >
          <StatusDot
            :status="data.ambient ? 'pending' : 'neutral'"
            muted
            :label="data.ambient ? 'Actividad de fondo activa' : 'Actividad de fondo desactivada'"
          />
        </span>
      </template>
    </ProjectHeader>

    <LoadState :loading="loading" :error="error" :has-data="!!data" what="el estado de los dispositivos" />

    <template v-if="data">
      <EmptyState
        v-if="sites.length === 0"
        title="El simulador no tiene tiendas."
        :scenarios="['Datáfono bloqueado']"
        hint="Las tiendas salen de config/clients.yaml."
      />

      <template v-else>
        <StatGrid :columns="6" label="Cifras de los dispositivos">
          <Stat v-for="s in stats" :key="s.label" :label="s.label" :value="s.value" :hint="s.hint" :tone="s.tone" />
        </StatGrid>

        <div v-if="allQuiet" class="quiet" role="status">
          <StatusDot status="success" label="Todos los dispositivos están operativos y sin actividad reciente." />
          <div class="quiet__actions">
            <Button
              v-for="scenario in QUIET_SCENARIOS"
              :key="scenario"
              size="sm"
              :title="`Abrir «${scenario}» en el director de demo`"
              @click="openDirector(scenario)"
            >
              {{ scenario }}
            </Button>
          </div>
        </div>

        <Card
          v-for="g in groups"
          :key="g.id"
          :title="g.name"
          :description="plural(g.sites.length, 'tienda', 'tiendas')"
          :padded="false"
        >
          <template #actions>
            <StatusDot
              v-if="g.issues > 0"
              status="danger"
              :label="plural(g.issues, 'incidencia', 'incidencias')"
              class="group-state"
            />
            <StatusDot v-else status="success" muted label="Sin incidencias" class="group-state" />
          </template>

          <table class="table sites">
            <caption class="sr-only">Tiendas de {{ g.name }}</caption>
            <colgroup>
              <col class="col-site" />
              <col class="col-hours" />
              <col v-for="col in DEVICE_COLUMNS" :key="col.type" class="col-device" />
              <col class="col-restarts" />
              <col class="col-cases" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Tienda</th>
                <th scope="col">Horario</th>
                <th v-for="col in DEVICE_COLUMNS" :key="col.type" scope="col">{{ col.label }}</th>
                <th scope="col" class="num" title="Reinicios en la última hora">Reinicios/h</th>
                <th scope="col">Caso</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in g.sites" :key="s.id">
                <td class="site">
                  <span class="site__name">{{ s.name }}</span>
                  <span class="site__city">{{ s.city }}</span>
                </td>

                <td class="hours">
                  <span class="hours__range num">{{ s.open }}–{{ s.close }}</span>
                  <span class="hours__now">{{ isOpenNow(s) ? 'Abierta' : 'Cerrada' }}</span>
                </td>

                <td v-for="col in DEVICE_COLUMNS" :key="col.type" class="device-cell">
                  <div v-for="d in devicesOf(s, col.type)" :key="d.id" class="device" :title="deviceTitle(d)">
                    <StatusDot :status="DEVICE_STATUS[d.status].status" :label="DEVICE_STATUS[d.status].label" />
                    <span class="device__meta mono" :class="`device__meta--${versionTone(d)}`">
                      <span class="sr-only">{{ d.label }}, versión </span>{{ d.softwareVersion }}
                    </span>
                    <span v-if="d.transactionInFlight" class="device__flag">Cobro en curso</span>
                  </div>
                  <span v-if="devicesOf(s, col.type).length === 0" class="empty-cell" aria-label="Sin aparato">—</span>
                </td>

                <td
                  class="num restarts"
                  :class="{
                    'restarts--some': restartsOf(s) > 0,
                    'restarts--many': maxRestartsOf(s) >= 3,
                  }"
                  :title="restartsTitle(s)"
                >
                  {{ restartsOf(s) }}
                </td>

                <td class="cases-cell">
                  <ul v-if="casesForSite(s).length" class="cases">
                    <li v-for="c in casesForSite(s)" :key="c.id" class="case">
                      <StatusDot :status="CASE_STATUS[c.status].status">
                        <a
                          v-if="c.status === 'waiting_approval'"
                          class="case__approve"
                          href="#aprobaciones"
                          title="Decidir en Aprobaciones"
                        >{{ CASE_STATUS[c.status].label }}</a>
                        <template v-else>{{ CASE_STATUS[c.status].label }}</template>
                      </StatusDot>
                      <span class="case__link">
                        <CaseLink :case-id="c.id" label="Ver caso" :title="`Abrir el caso: ${c.title}`" />
                      </span>
                    </li>
                  </ul>
                  <span v-else class="empty-cell" aria-label="Sin casos abiertos">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </Card>

        <div class="activity">
          <Card title="Avisos a tienda" :padded="false">
            <template #actions>
              <span class="count" :aria-label="plural(data.storeNotices.length, 'aviso', 'avisos')">
                {{ data.storeNotices.length }}
              </span>
            </template>
            <ol v-if="notices.length" class="feed">
              <li v-for="(n, i) in notices" :key="`${n.at}-${i}`" class="feed__item">
                <div class="feed__head">
                  <p class="feed__title">
                    {{ siteParts(n.siteId).name }}
                    <span v-if="siteParts(n.siteId).client" class="feed__context">{{ siteParts(n.siteId).client }}</span>
                  </p>
                  <time class="feed__time" :datetime="n.at" :title="fullTime(n.at)">{{ fmtTime(n.at) }}</time>
                </div>
                <p class="feed__body">{{ n.message }}</p>
              </li>
            </ol>
            <div v-else class="feed__empty">
              <EmptyState compact title="Sin avisos todavía." :scenarios="['Impresora sin papel']" />
            </div>
          </Card>

          <Card title="Visitas de técnico" :padded="false">
            <template #actions>
              <span class="count" :aria-label="plural(data.fieldTickets.length, 'visita', 'visitas')">
                {{ data.fieldTickets.length }}
              </span>
            </template>
            <ol v-if="fieldTickets.length" class="feed">
              <li v-for="t in fieldTickets" :key="t.id" class="feed__item">
                <div class="feed__head">
                  <p class="feed__title">{{ t.summary }}</p>
                  <time class="feed__time" :datetime="t.at" :title="fullTime(t.at)">{{ fmtDateTime(t.at) }}</time>
                </div>
                <p class="feed__meta">
                  <span class="mono">{{ t.id }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ siteLabel(t.siteId) }}</span>
                  <template v-if="t.deviceId">
                    <span aria-hidden="true">·</span>
                    <span class="mono">{{ deviceLabel(t.deviceId) }}</span>
                  </template>
                </p>
              </li>
            </ol>
            <div v-else class="feed__empty">
              <EmptyState
                compact
                title="Ninguna visita solicitada."
                :scenarios="['Bloqueo que vuelve tras reiniciar']"
                hint="La visita queda pendiente de aprobación."
              />
            </div>
          </Card>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.devices-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

/* ── Cabecera ──────────────────────────────── */
.ambient {
  display: inline-flex;
  font-size: var(--text-sm);
}

/* ── Todo en calma ─────────────────────────── */
.quiet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 12px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}
.quiet__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── Tabla de tiendas ──────────────────────── */
.group-state {
  font-size: var(--text-sm);
  white-space: nowrap;
}

/* Anchos fijos: las columnas quedan alineadas entre las tarjetas de todos los clientes. */
.sites {
  table-layout: fixed;
  min-width: 800px;
}
.col-site {
  width: 13%;
}
.col-hours {
  width: 13%;
}
.col-device {
  width: 14%;
}
.col-restarts {
  width: 11%;
}
.col-cases {
  width: 21%;
}
.sites td {
  vertical-align: top;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.site__name,
.site__city,
.hours__range,
.hours__now {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site__name {
  font-weight: 500;
  color: var(--fg);
}
.site__city,
.hours__now {
  font-size: var(--text-xs);
  color: var(--fg-muted);
}
.hours__range {
  color: var(--fg);
}

.device + .device {
  margin-top: 8px;
}
.device {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* La línea gris queda alineada con el texto del estado, no con el punto. */
.device__meta,
.device__flag {
  padding-left: 16px;
  font-size: var(--text-xs);
  line-height: 16px;
}
.device__meta {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--fg-muted);
}
.device__meta--fixed {
  color: var(--success);
}
.device__flag {
  margin-top: 2px;
  color: var(--warning);
  font-weight: 500;
}

.restarts {
  color: var(--fg-subtle);
}
.restarts--some {
  color: var(--fg);
  font-weight: 500;
}
.restarts--many {
  color: var(--danger);
  font-weight: 600;
}

.cases {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.case {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.case__link {
  padding-left: 16px;
  font-size: var(--text-xs);
  line-height: 20px;
}
.case__approve:focus-visible {
  border-radius: var(--radius-sm);
}

.empty-cell {
  color: var(--fg-subtle);
}

/* ── Avisos y visitas ──────────────────────── */
.activity {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 24px;
  align-items: stretch;
}

.count {
  font-size: var(--text-sm);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}

.feed {
  margin: 0;
  padding: 0;
  list-style: none;
}
.feed__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.feed__item:last-child {
  border-bottom: 0;
}
.feed__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}
.feed__title {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.feed__context {
  margin-left: 4px;
  font-weight: 400;
  color: var(--fg-muted);
}
.feed__time {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
  white-space: nowrap;
}
.feed__body {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.feed__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--fg-muted);
}
.feed__meta .mono {
  font-size: var(--text-xs);
}
.feed__empty {
  padding: 16px;
}
</style>
