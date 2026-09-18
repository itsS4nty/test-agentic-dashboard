<script setup lang="ts">
/**
 * Muestrario (ruta oculta `#muestrario`): todos los componentes de `ui/` en sus variantes, con datos
 * de ejemplo, para revisar el acabado en claro y en oscuro. El tema es el de toda la consola
 * (`useTheme()` de ui/theme.ts), así que se conserva al salir del muestrario.
 */
import { ref } from 'vue';
import type { AutonomyLevel } from '../../../platform/contracts.ts';
import { LEVEL_LABEL, LEVELS } from '../components/format.ts';
import Badge from './Badge.vue';
import Button from './Button.vue';
import Card from './Card.vue';
import CodeBlock from './CodeBlock.vue';
import EmptyState from './EmptyState.vue';
import KeyValue from './KeyValue.vue';
import PageHeader from './PageHeader.vue';
import RelativeTime from './RelativeTime.vue';
import SegmentedControl from './SegmentedControl.vue';
import Stat from './Stat.vue';
import StatGrid from './StatGrid.vue';
import StatusDot from './StatusDot.vue';
import Tabs from './Tabs.vue';
import ThemeSwitcher from './ThemeSwitcher.vue';
import Timeline from './Timeline.vue';
import TimelineItem from './TimelineItem.vue';
import { ACTOR_BADGE, CASE_STATUS, DEVICE_STATUS, decisionBadge } from './status.ts';
import type { BadgeVariant, ButtonVariant, KeyValueItem, SegmentedOption, Status, TabItem } from './types.ts';

// ── Datos de ejemplo ────────────────────────────────────
const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const BADGE_VARIANTS: BadgeVariant[] = ['neutral', 'inverted', 'outline', 'success', 'warning', 'danger'];
const STATUSES: { status: Status; label: string }[] = [
  { status: 'success', label: 'Resuelto' },
  { status: 'pending', label: 'En curso' },
  { status: 'warning', label: 'Pendiente de aprobación' },
  { status: 'danger', label: 'Escalado' },
  { status: 'neutral', label: 'Abierto' },
];

const loading = ref(false);
function simulateLoading() {
  loading.value = true;
  setTimeout(() => (loading.value = false), 1600);
}

const tabItems: TabItem[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'casos', label: 'Casos' },
  { id: 'aprobaciones', label: 'Aprobaciones', count: 2 },
  { id: 'dial', label: 'El dial' },
];
const tab = ref('casos');
const localTab = ref('traza');
const localTabs: TabItem[] = [
  { id: 'traza', label: 'Traza', count: 9 },
  { id: 'datos', label: 'Datos' },
  { id: 'aprobaciones', label: 'Aprobaciones', count: 1 },
];

const level = ref<AutonomyLevel>('approve');
const levelSm = ref<AutonomyLevel>('auto');
const levelOptions: SegmentedOption<AutonomyLevel>[] = LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] }));
const filter = ref('todo');
const filterOptions: SegmentedOption[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'reglas', label: 'Reglas' },
  { value: 'ia', label: 'IA' },
  { value: 'personas', label: 'Personas' },
  { value: 'bloqueos', label: 'Bloqueos', disabled: true },
];

const agentItems: KeyValueItem[] = [
  { label: 'Proyecto', value: 'Dispositivos' },
  { label: 'Modelo', value: 'reasoning', mono: true },
  { label: 'Esfuerzo', value: 'Medio' },
  { label: 'Turnos máx.', value: 12 },
  { label: 'Presupuesto', value: '0,50 US$' },
];
const approvalItems: KeyValueItem[] = [
  { label: 'Acción', value: 'dispositivo_request_field_visit', mono: true },
  { label: 'Ámbito', value: 'Pan de Pueblo · Gràcia · DAT-02' },
  { label: 'Propone', slot: 'actor' },
  { label: 'Riesgo', slot: 'risk' },
  { label: 'Caso', value: null },
];

const json = JSON.stringify(
  {
    siteId: 'pan-de-pueblo:gracia',
    deviceId: 'pan-de-pueblo:gracia:DAT-02',
    reason: 'El bloqueo vuelve tras tres reinicios en una hora.',
    urgency: 'high',
  },
  null,
  2,
);
const yaml = `id: dispositivos
name: Agente de dispositivos
model: reasoning
maxTurns: 12
budgetUsd: 0.5
tools:
  - dispositivo_get_site_status
  - dispositivo_restart_device
  - dispositivo_request_field_visit`;

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const t1 = secondsAgo(95);
const t2 = secondsAgo(80);
const t3 = secondsAgo(42);
const t4 = secondsAgo(12);
</script>

<template>
  <div class="showcase">
    <PageHeader title="Muestrario" description="Componentes base de la consola en todas sus variantes.">
      <template #actions>
        <!-- El tema es el de toda la consola (ui/theme.ts): este selector y el de la cabecera van a la par. -->
        <ThemeSwitcher labels />
      </template>
    </PageHeader>

    <!-- Button -->
    <section class="block" aria-labelledby="s-button">
      <h2 id="s-button" class="block__title">Button</h2>
      <div class="rows">
        <div v-for="size in ['md', 'sm'] as const" :key="size" class="row">
          <span class="row__label mono">{{ size }}</span>
          <Button v-for="variant in BUTTON_VARIANTS" :key="variant" :variant="variant" :size="size">
            {{ variant === 'danger' ? 'Confirmar reinicio' : variant === 'primary' ? 'Aprobar' : variant === 'ghost' ? 'Plegar' : 'Rechazar' }}
          </Button>
        </div>
        <div class="row">
          <span class="row__label mono">estados</span>
          <Button :loading="loading" size="sm" @click="simulateLoading">Lanzar</Button>
          <Button variant="primary" :loading="loading" @click="simulateLoading">Aprobar</Button>
          <Button disabled>Deshabilitado</Button>
          <Button aria-pressed="true">Director de demo</Button>
          <Button as="a" href="#muestrario" variant="ghost">Enlace</Button>
        </div>
      </div>
    </section>

    <!-- Badge + StatusDot -->
    <div class="split">
      <section class="block" aria-labelledby="s-badge">
        <h2 id="s-badge" class="block__title">Badge</h2>
        <div class="rows">
          <div class="row">
            <Badge v-for="variant in BADGE_VARIANTS" :key="variant" :variant="variant">{{ variant }}</Badge>
          </div>
          <div class="row">
            <Badge v-for="actor in Object.values(ACTOR_BADGE)" :key="actor.label" :variant="actor.variant">
              {{ actor.label }}
            </Badge>
            <Badge variant="outline">Dinero</Badge>
            <Badge mono variant="outline">v2.14.3</Badge>
          </div>
          <div class="row">
            <Badge
              v-for="decision in (['auto', 'approve', 'deny', 'escalate'] as const)"
              :key="decision"
              :variant="decisionBadge(decision).variant"
            >
              {{ decisionBadge(decision).label }}
            </Badge>
          </div>
        </div>
      </section>

      <section class="block" aria-labelledby="s-status">
        <h2 id="s-status" class="block__title">StatusDot</h2>
        <div class="rows">
          <div class="row">
            <StatusDot v-for="s in STATUSES" :key="s.status" :status="s.status" :label="s.label" />
          </div>
          <div class="row">
            <StatusDot
              v-for="(presentation, key) in DEVICE_STATUS"
              :key="key"
              :status="presentation.status"
              :label="presentation.label"
              muted
            />
          </div>
          <div class="row">
            <span class="row__label mono">sin texto</span>
            <StatusDot v-for="s in STATUSES" :key="s.status" :status="s.status" />
          </div>
        </div>
      </section>
    </div>

    <!-- StatGrid + Stat -->
    <section class="block" aria-labelledby="s-stats">
      <h2 id="s-stats" class="block__title">StatGrid · Stat</h2>
      <StatGrid :columns="6" label="Métricas">
        <Stat label="Casos" value="14" hint="3 abiertos" />
        <Stat label="Sin intervención humana" value="79 %" hint="11 de 14 resueltos" tone="success" />
        <Stat label="Aprobaciones pendientes" value="2" tone="warning" />
        <Stat label="Coste de IA" value="0,0412 US$" hint="4 llamadas" />
        <Stat label="Acciones de reglas / llamadas a IA" value="9 / 5" />
        <Stat label="Bloqueos por política" value="3" tone="danger" hint="1 hoy" />
      </StatGrid>
      <div class="split">
        <StatGrid :columns="3" size="sm">
          <Stat label="Reglas" value="0,00 US$" />
          <Stat label="IA" value="0,0180 US$" />
          <Stat label="Total" value="0,0180 US$" />
        </StatGrid>
        <StatGrid :columns="4" size="sm">
          <Stat label="Revisadas" value="24" />
          <Stat label="Reglas" value="3" />
          <Stat label="IA" value="2" />
          <Stat label="Impacto" value="39,60 €" />
        </StatGrid>
      </div>
    </section>

    <!-- Tabs + SegmentedControl -->
    <section class="block" aria-labelledby="s-tabs">
      <h2 id="s-tabs" class="block__title">Tabs · SegmentedControl · ThemeSwitcher</h2>
      <div class="tabs-demo">
        <Tabs v-model="tab" :items="tabItems" :href-for="() => '#muestrario'" aria-label="Ejemplo de navegación" />
      </div>
      <div class="tabs-demo">
        <Tabs v-model="localTab" :items="localTabs" aria-label="Ejemplo de pestañas locales" />
      </div>
      <div class="rows">
        <div class="row">
          <span class="row__label mono">md</span>
          <SegmentedControl v-model="level" :options="levelOptions" aria-label="Nivel de autonomía" />
        </div>
        <div class="row">
          <span class="row__label mono">sm</span>
          <SegmentedControl v-model="levelSm" :options="levelOptions" size="sm" aria-label="Nivel de autonomía" />
          <SegmentedControl v-model="filter" :options="filterOptions" size="sm" aria-label="Filtro de actividad" />
        </div>
        <div class="row">
          <span class="row__label mono">disabled</span>
          <SegmentedControl :model-value="'notify'" :options="levelOptions" size="sm" disabled aria-label="Nivel bloqueado" />
        </div>
        <div class="row">
          <span class="row__label mono">tema</span>
          <ThemeSwitcher />
          <ThemeSwitcher labels />
        </div>
      </div>
    </section>

    <!-- Card + KeyValue -->
    <div class="split">
      <Card title="Visita de técnico" description="Pan de Pueblo · Gràcia">
        <template #actions>
          <StatusDot status="warning" label="Pendiente" />
        </template>
        <div class="stack">
          <KeyValue :items="approvalItems">
            <template #actor><Badge variant="inverted">IA</Badge> Agente de dispositivos</template>
            <template #risk><Badge variant="outline">Acción física</Badge></template>
          </KeyValue>
          <p class="muted">El bloqueo vuelve tras tres reinicios en una hora.</p>
          <div class="row">
            <Button variant="primary">Aprobar</Button>
            <Button>Rechazar</Button>
          </div>
        </div>
      </Card>

      <Card title="Agente de dispositivos" description="Investiga incidencias que las reglas no resuelven.">
        <KeyValue :items="agentItems" layout="stacked" />
      </Card>
    </div>

    <Card title="Por proyecto" :padded="false">
      <template #actions>
        <Button size="sm" variant="ghost">Ver todo</Button>
      </template>
      <table class="table">
        <thead>
          <tr>
            <th>Proyecto</th>
            <th class="num">Casos</th>
            <th class="num">Resueltos</th>
            <th class="num">Coste</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Dispositivos</td>
            <td class="num">8</td>
            <td class="num">7</td>
            <td class="num">0,0120 US$</td>
          </tr>
          <tr>
            <td>Facturas</td>
            <td class="num">3</td>
            <td class="num">2</td>
            <td class="num">0,0210 US$</td>
          </tr>
        </tbody>
      </table>
    </Card>

    <!-- PageHeader -->
    <section class="block" aria-labelledby="s-header">
      <h2 id="s-header" class="block__title">PageHeader</h2>
      <div class="frame">
        <PageHeader title="Aprobaciones" description="Acciones que esperan a una persona.">
          <template #actions>
            <Button>Historial</Button>
            <Button variant="primary">Aprobar todas</Button>
          </template>
        </PageHeader>
      </div>
    </section>

    <!-- Timeline -->
    <div class="split">
      <Card title="Traza">
        <Timeline aria-label="Traza del caso">
          <TimelineItem :status="CASE_STATUS.open.status" title="Datáfono bloqueado" :time="t1">
            Panaderías Horno Real · Centro · DAT-01
          </TimelineItem>
          <TimelineItem status="neutral" title="Regla: reinicio remoto" :time="t2">
            <template #meta><Badge>Regla</Badge><span>0,00 US$</span></template>
          </TimelineItem>
          <TimelineItem status="warning" title="Política: pide permiso" :time="t3">
            <template #meta><Badge variant="warning">Pide permiso</Badge><span>El cliente exige aprobación</span></template>
          </TimelineItem>
          <TimelineItem status="pending" title="Agente investigando" :time="t4">
            <template #meta>
              <span class="mono">reasoning</span><span>1.240 tokens</span><span>0,0061 US$</span><span>1,8 s</span>
            </template>
          </TimelineItem>
          <TimelineItem status="danger" title="Acción bloqueada" time="09:41:07">
            <template #meta><Badge variant="danger">Bloquea</Badge></template>
            La instrucción viene del texto de un ticket.
          </TimelineItem>
        </Timeline>
      </Card>

      <div class="stack">
        <section class="block" aria-labelledby="s-code">
          <h2 id="s-code" class="block__title">CodeBlock</h2>
          <CodeBlock :code="json" />
          <CodeBlock :code="yaml" label="agents/dispositivos/agent.yaml" max-height="160px" />
        </section>
        <section class="block" aria-labelledby="s-rel">
          <h2 id="s-rel" class="block__title">RelativeTime</h2>
          <p class="row">
            <RelativeTime :at="t4" />
            <RelativeTime :at="t1" />
            <RelativeTime :at="secondsAgo(7200)" />
          </p>
        </section>
      </div>
    </div>

    <!-- EmptyState -->
    <section class="block" aria-labelledby="s-empty">
      <h2 id="s-empty" class="block__title">EmptyState</h2>
      <div class="split">
        <EmptyState title="La bandeja está vacía" description="Los tickets llegan al lanzar un escenario de soporte.">
          <template #action>
            <Button size="sm">Llega la bandeja de la mañana</Button>
          </template>
        </EmptyState>
        <div class="frame">
          <EmptyState compact title="Ninguna visita solicitada." description="La visita queda pendiente de aprobación.">
            <template #action>
              <Button size="sm">Bloqueo que vuelve tras reiniciar</Button>
            </template>
          </EmptyState>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.showcase {
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.block__title {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--fg-muted);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}
.row__label {
  width: 72px;
  font-size: var(--text-xs);
  color: var(--fg-subtle);
}
.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.frame {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.tabs-demo {
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

@media (max-width: 800px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
