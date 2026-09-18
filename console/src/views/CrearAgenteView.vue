<script setup lang="ts">
/**
 * Crear agente: una persona describe el agente (qué hace, conexiones, contexto, modelo y
 * presupuesto) y el agente creador (IA) escribe manifiesto, prompt y herramientas en una rama
 * `agente/<id>` de este repositorio y abre un PR. Debajo, el seguimiento de cada solicitud.
 * Cuando un PR fusionado activa un agente, se recargan agentes, políticas y proyectos.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { api } from '../api.ts';
import { live } from '../live.ts';
import { catalog, loadAgents, loadPolicies } from '../components/catalog.ts';
import { Button, PageHeader, StatusDot } from '../ui/index.ts';
import AgentForm from './agentes/AgentForm.vue';
import AgentProposals from './agentes/AgentProposals.vue';
import { PLATAFORMA } from './agentes/presentation.ts';
import CaseLink from './project/CaseLink.vue';
import type { AgentRequestCreated, PlataformaSnapshot } from './project/types.ts';
import { useProjectSnapshot } from './project/useProjectSnapshot.ts';

onMounted(() => {
  void loadAgents();
});

const plataforma = useProjectSnapshot<PlataformaSnapshot>(PLATAFORMA);

const creating = ref(true);
const created = ref<AgentRequestCreated | null>(null);
const focusRequest = ref<string | null>(null);
const confirmation = ref<HTMLElement | null>(null);

/** Identificadores que un agente nuevo no puede repetir: agentes, proyectos y solicitudes en curso. */
const reservedIds = computed(() => {
  const ids = new Set<string>([PLATAFORMA]);
  for (const agent of catalog.agents) {
    ids.add(agent.id);
    ids.add(agent.project);
  }
  for (const project of live.status?.projects ?? []) ids.add(project.id);
  for (const request of plataforma.data.value?.requests ?? []) {
    if (request.agentId && request.status !== 'closed' && request.status !== 'failed') ids.add(request.agentId);
  }
  return [...ids];
});

function openForm() {
  created.value = null;
  creating.value = true;
}

async function onCreated(result: AgentRequestCreated) {
  creating.value = false;
  created.value = result;
  focusRequest.value = result.requestId;
  void plataforma.reload();
  await nextTick();
  confirmation.value?.focus();
}

/** Firma de lo fusionado y activado: si cambia, se recargan manifiestos, políticas y proyectos. */
const activationSignature = computed(() => {
  const snapshot = plataforma.data.value;
  if (!snapshot) return null;
  return [
    ...snapshot.prs.filter((p) => p.status === 'merged').map((p) => `${p.id}:${p.activation?.state ?? ''}`),
    ...snapshot.requests.filter((r) => r.status === 'merged' || r.status === 'active').map((r) => `${r.id}:${r.status}`),
  ]
    .sort()
    .join('|');
});

let seenSignature: string | null = null;
watch(activationSignature, (signature) => {
  if (signature === null) return;
  const changed = seenSignature === null ? signature !== '' : signature !== seenSignature;
  seenSignature = signature;
  if (!changed) return;
  void loadAgents(true);
  void loadPolicies(true);
  api
    .status()
    .then((status) => (live.status = status))
    .catch(() => undefined);
});
</script>

<template>
  <div class="page">
    <PageHeader
      title="Crear agente"
      description="Describe el agente. La IA escribe el código y abre un PR en este repositorio; fusionarlo lo aprueba una persona."
    >
      <template v-if="!creating" #actions>
        <Button variant="primary" @click="openForm">Nuevo agente</Button>
      </template>
    </PageHeader>

    <AgentForm v-if="creating" :reserved-ids="reservedIds" @cancel="creating = false" @created="onCreated" />

    <div v-else-if="created" ref="confirmation" class="created" role="status" tabindex="-1">
      <p class="created__text">
        <StatusDot status="success" label="Solicitud enviada." />
        <span class="created__message">{{ created.message }}</span>
      </p>
      <div class="created__actions">
        <CaseLink :case-id="created.caseId" label="Ver caso" />
        <Button variant="ghost" size="sm" @click="created = null">Cerrar</Button>
      </div>
    </div>

    <AgentProposals
      :snapshot="plataforma.data.value"
      :loading="plataforma.loading.value"
      :error="plataforma.error.value"
      :focus="focusRequest"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.created {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 10px 12px 10px 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  line-height: 20px;
  animation: fade-in 150ms var(--ease);
}
.created:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.created__text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  font-weight: 500;
}
.created__message {
  font-weight: 400;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.created__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
</style>
