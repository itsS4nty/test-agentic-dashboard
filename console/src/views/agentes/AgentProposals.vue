<script setup lang="ts">
/**
 * «Propuestas de agentes»: lo que el agente creador tiene entre manos. Dónde vive el repositorio
 * (GitHub o local) y su aviso; lista de solicitudes con su estado y detalle de la elegida con su PR.
 * Recibe el snapshot de `GET /api/projects/plataforma`; `focus` elige una solicitud desde fuera
 * (la que se acaba de crear).
 */
import { computed, ref, watch } from 'vue';
import { Badge, Card, StatusDot } from '../../ui/index.ts';
import EmptyState from '../project/EmptyState.vue';
import LoadState from '../project/LoadState.vue';
import { fmtDateTime } from '../project/format.ts';
import type { PlataformaSnapshot } from '../project/types.ts';
import ProposalDetail from './ProposalDetail.vue';
import { REQUEST_STATUS, pendingMerge, proposalsOf } from './presentation.ts';

const props = defineProps<{
  snapshot: PlataformaSnapshot | null;
  loading: boolean;
  error: string | null;
  focus?: string | null;
}>();

const proposals = computed(() => proposalsOf(props.snapshot?.requests ?? [], props.snapshot?.prs ?? []));

const selectedId = ref<string | null>(null);
watch(
  () => props.focus,
  (id) => {
    if (id) selectedId.value = id;
  },
  { immediate: true },
);

const selected = computed(
  () => proposals.value.find((p) => p.request.id === selectedId.value) ?? proposals.value[0] ?? null,
);
const selectedApproval = computed(() => (selected.value ? pendingMerge(selected.value) : undefined));

const baseBranch = computed(() => props.snapshot?.baseBranch || 'main');
const remote = computed(() => (props.snapshot?.mode === 'github' ? props.snapshot.remote : undefined));

const presentation = (status: string) =>
  REQUEST_STATUS[status as keyof typeof REQUEST_STATUS] ?? { status: 'neutral' as const, label: status };
</script>

<template>
  <section class="proposals" aria-labelledby="propuestas-titulo">
    <header class="proposals__header">
      <div class="proposals__heading">
        <h2 id="propuestas-titulo" class="proposals__title">Propuestas de agentes</h2>
        <p class="proposals__description">
          Cada propuesta es un PR contra <code>{{ baseBranch }}</code>; fusionarlo pide permiso a una persona.
        </p>
      </div>
      <div v-if="snapshot" class="proposals__repo">
        <a
          v-if="remote"
          class="remote"
          :href="remote.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="`Abrir ${remote.repo} en GitHub`"
        >
          <Badge variant="outline">GitHub · {{ remote.repo }}</Badge>
        </a>
        <Badge v-else title="Las ramas y los PR viven en el repositorio de la plataforma">Repositorio local</Badge>
      </div>
    </header>

    <LoadState :loading="loading" :error="error" :has-data="!!snapshot" what="las propuestas" />

    <p v-if="snapshot?.warning" class="notice" role="status">
      <StatusDot status="warning">{{ snapshot.warning }}</StatusDot>
    </p>

    <template v-if="snapshot">
      <EmptyState
        v-if="proposals.length === 0"
        compact
        title="Todavía no hay propuestas."
        hint="Pulsa «Crear agente» o lanza el ejemplo."
        :scenarios="['Crear un agente nuevo (ejemplo)']"
      />

      <div v-else class="layout">
        <Card class="list" title="Solicitudes" :padded="false">
          <template #actions>
            <span class="list__count">{{ proposals.length }}</span>
          </template>
          <ul class="list__items" aria-label="Solicitudes de agentes">
            <li v-for="p in proposals" :key="p.request.id">
              <button
                type="button"
                class="row"
                :class="{ 'is-selected': selected?.request.id === p.request.id }"
                :aria-current="selected?.request.id === p.request.id ? 'true' : undefined"
                @click="selectedId = p.request.id"
              >
                <span class="row__top">
                  <span class="row__id">{{ p.request.agentId || p.request.id }}</span>
                  <span class="row__date">{{ fmtDateTime(p.request.createdAt) }}</span>
                </span>
                <span class="row__title">{{ p.request.name }}</span>
                <span class="row__bottom">
                  <StatusDot :status="presentation(p.request.status).status" :label="presentation(p.request.status).label" />
                  <span v-if="p.pr?.github" class="row__pr">#{{ p.pr.github.number }}</span>
                  <span v-else-if="p.pr" class="row__pr">{{ p.pr.id }}</span>
                </span>
              </button>
            </li>
          </ul>
        </Card>

        <ProposalDetail
          v-if="selected"
          :key="selected.request.id"
          :proposal="selected"
          :base-branch="baseBranch"
          :approval="selectedApproval"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.proposals {
  container: proposals / inline-size;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.proposals__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
}
.proposals__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.proposals__title {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.01em;
}
.proposals__description {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.proposals__description code {
  font-size: var(--text-xs);
  color: var(--fg);
}
.proposals__repo {
  display: flex;
  min-width: 0;
}

.remote {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  border-radius: var(--radius-sm);
  text-decoration: none;
}
.remote :deep(.badge) {
  transition: border-color 150ms var(--ease);
}
.remote:hover :deep(.badge) {
  border-color: var(--fg-muted);
}
.remote:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.notice {
  padding: 10px 12px 10px 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

/* ── Lista + detalle ──────────────────────── */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@container proposals (min-width: 880px) {
  .layout {
    grid-template-columns: 272px minmax(0, 1fr);
  }
  .list {
    position: sticky;
    top: calc(var(--header-h) + var(--tabs-h) + 24px);
  }
}

.list__count {
  font-size: var(--text-sm);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}
.list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}
.list__items li + li {
  border-top: 1px solid var(--border);
}

.row {
  appearance: none;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
.row:hover {
  background: var(--bg-hover);
}
.row.is-selected {
  background: var(--bg-muted);
}
.row.is-selected::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--fg);
}
.row:focus-visible {
  z-index: 1;
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.row__top,
.row__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.row__id,
.row__pr {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__date {
  flex: none;
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
  white-space: nowrap;
}
.row:hover .row__id,
.row:hover .row__date,
.row:hover .row__pr,
.row.is-selected .row__id,
.row.is-selected .row__date,
.row.is-selected .row__pr {
  color: var(--fg-muted);
}
.row__title {
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 20px;
  text-wrap: pretty;
}
.row__bottom {
  font-size: var(--text-sm);
}
</style>
