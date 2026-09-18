<script setup lang="ts">
/**
 * Código (docs/DESIGN.md § 6). Cabecera con el componente, dónde vive el repositorio (GitHub o local)
 * y la versión desplegada; lista de pull requests y detalle del elegido: estado, rama, caso, enlace a
 * GitHub, descripción, tests antes → después y diff. Los tests que validan el arreglo son los que
 * ejecuta el agente antes de abrir el PR; la CI del repositorio solo sale si la hay (`ci` ≠ `none`).
 * El agente no fusiona: el PR lo fusiona una persona a mano en GitHub y, al detectarlo, pasa a fusionado.
 */
import { computed, ref } from 'vue';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Card from '../ui/Card.vue';
import CodeBlock from '../ui/CodeBlock.vue';
import KeyValue from '../ui/KeyValue.vue';
import PageHeader from '../ui/PageHeader.vue';
import StatusDot from '../ui/StatusDot.vue';
import type { BadgeVariant, KeyValueItem, Status } from '../ui/types.ts';
import CaseLink from './project/CaseLink.vue';
import DiffBlock from './project/DiffBlock.vue';
import EmptyState from './project/EmptyState.vue';
import LoadState from './project/LoadState.vue';
import TestsCard from './project/TestsCard.vue';
import { fmtDateTime } from './project/format.ts';
import type { BugsSnapshot, CiStatus, PullRequest, TestRun } from './project/types.ts';
import { useProjectSnapshot } from './project/useProjectSnapshot.ts';

const { data, loading, error } = useProjectSnapshot<BugsSnapshot>('bugs');

const prs = computed(() => [...(data.value?.prs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

const selectedId = ref<string | null>(null);
const selected = computed<PullRequest | null>(
  () => prs.value.find((p) => p.id === selectedId.value) ?? prs.value[0] ?? null,
);

const lastMerged = computed(() =>
  prs.value
    .filter((p) => p.status === 'merged')
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))[0],
);

/**
 * Versión desplegada: verde cuando ya incluye un arreglo fusionado, roja mientras hay un arreglo
 * sin fusionar (la desplegada tiene el fallo) y neutra si no hay PRs.
 */
const version = computed<{ variant: BadgeVariant; note: string; title: string }>(() => {
  if (lastMerged.value) {
    return { variant: 'success', note: `incluye ${lastMerged.value.id}`, title: 'Incluye el arreglo fusionado' };
  }
  if (prs.value.length) {
    return { variant: 'danger', note: 'la desplegada en las tiendas', title: 'Tiene el fallo: el arreglo aún no está fusionado' };
  }
  return { variant: 'neutral', note: 'la desplegada en las tiendas', title: 'Versión desplegada en las tiendas' };
});

function prState(pr: PullRequest): { status: Status; label: string } {
  if (pr.status === 'merged') return { status: 'success', label: 'Fusionado' };
  if (pr.status === 'closed') return { status: 'neutral', label: 'Cerrado' };
  if (pr.github) return { status: 'warning', label: 'Pendiente de fusión en GitHub' };
  return { status: 'neutral', label: 'Abierto' };
}

/** CI del repositorio para el commit del PR. Sin CI (`none`) no se pinta nada. */
const CI_STATE: Record<Exclude<CiStatus, 'none'>, { status: Status; label: string }> = {
  pending: { status: 'pending', label: 'En curso' },
  success: { status: 'success', label: 'Tests en verde' },
  failure: { status: 'danger', label: 'Tests en rojo' },
};

const ciState = (pr: PullRequest) => (pr.github && pr.github.ci !== 'none' ? CI_STATE[pr.github.ci] : undefined);

const selectedCi = computed(() => (selected.value ? ciState(selected.value) : undefined));

const remote = computed(() => (data.value?.mode === 'github' ? data.value.remote : undefined));

/** Ruta del repositorio abreviada a sus dos últimos tramos; la completa va en el title. */
const repoShort = computed(() => {
  const parts = (data.value?.repoPath ?? '').split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/');
});

const ratio = (run: TestRun) => `${run.passed}/${run.passed + run.failed}`;

const detailItems = computed<KeyValueItem[]>(() => {
  const pr = selected.value;
  if (!pr) return [];
  const items: KeyValueItem[] = [
    { label: 'Pull request', value: pr.github ? `${pr.id} · #${pr.github.number}` : pr.id, mono: true },
    { label: 'Caso', slot: 'case' },
    { label: 'Abierto', value: fmtDateTime(pr.createdAt) },
  ];
  if (pr.mergedAt) items.push({ label: 'Fusionado', value: fmtDateTime(pr.mergedAt) });
  if (pr.closedAt) items.push({ label: 'Cerrado', value: fmtDateTime(pr.closedAt) });
  if (pr.github) items.push({ label: 'GitHub', slot: 'github' });
  // Sin CI en el repositorio no hay fila: los tests que cuentan son los del agente, más abajo.
  if (ciState(pr)) items.push({ label: 'CI', slot: 'ci' });
  return items;
});

// ── Descripción del PR: el agente la escribe con `## Apartados`, listas `- ` y `código`.
// Se pinta como texto (sin HTML): apartados como h4, listas y código en línea.

interface Chunk {
  code: boolean;
  text: string;
}
interface Block {
  type: 'heading' | 'paragraph' | 'list';
  lines: Chunk[][];
}

function chunks(line: string): Chunk[] {
  const parts = line.split('`');
  if (parts.length % 2 === 0) return [{ code: false, text: line }]; // comillas sin cerrar
  return parts.map((text, i) => ({ code: i % 2 === 1, text })).filter((t) => t.text);
}

const description = computed<Block[]>(() => {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of (selected.value?.description ?? '').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      current = null;
    } else if (heading) {
      blocks.push({ type: 'heading', lines: [chunks(heading[1])] });
      current = null;
    } else if (bullet) {
      if (current?.type !== 'list') blocks.push((current = { type: 'list', lines: [] }));
      current.lines.push(chunks(bullet[1]));
    } else {
      if (current?.type !== 'paragraph') blocks.push((current = { type: 'paragraph', lines: [] }));
      current.lines.push(chunks(line));
    }
  }
  return blocks;
});
</script>

<template>
  <section class="codigo">
    <PageHeader
      title="terminal-pagos"
      description="Software de cobro de los datáfonos. El agente abre el PR; una persona lo revisa y lo fusiona a mano en GitHub."
    >
      <template v-if="data" #actions>
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
        <Badge v-else :title="data.repoPath">Repositorio local</Badge>
        <p class="version" :title="version.title">
          <span class="version__label">Versión actual</span>
          <Badge mono :variant="version.variant">v{{ data.version }}</Badge>
          <span class="version__note">{{ version.note }}</span>
        </p>
      </template>
    </PageHeader>

    <LoadState :loading="loading" :error="error" :has-data="!!data" what="el repositorio" />

    <p v-if="data?.warning" class="notice" role="status">
      <StatusDot status="warning">{{ data.warning }}</StatusDot>
    </p>

    <template v-if="data">
      <EmptyState
        v-if="prs.length === 0"
        title="Todavía no hay pull requests."
        :scenarios="['Investigar la causa raíz de los bloqueos', 'Ola de bloqueos tras la versión 2.14.2']"
        hint="El agente reproducirá el fallo con un test y abrirá el PR con el arreglo."
      />

      <div v-else class="layout">
        <Card class="list" title="Pull requests" :padded="false">
          <template #actions>
            <span class="list__count">{{ prs.length }}</span>
          </template>

          <ul class="list__items" aria-label="Pull requests">
            <li v-for="pr in prs" :key="pr.id">
              <button
                type="button"
                class="row"
                :class="{ 'is-selected': selected?.id === pr.id }"
                :aria-current="selected?.id === pr.id ? 'true' : undefined"
                @click="selectedId = pr.id"
              >
                <span class="row__top">
                  <span class="row__id">{{ pr.id }}<template v-if="pr.github"> · #{{ pr.github.number }}</template></span>
                  <span class="row__date">{{ fmtDateTime(pr.createdAt) }}</span>
                </span>
                <span class="row__title">{{ pr.title }}</span>
                <span class="row__bottom">
                  <StatusDot :status="prState(pr).status" :label="prState(pr).label" />
                  <span class="row__tests">
                    <span class="sr-only">Tests</span>{{ ratio(pr.testsBefore) }} → {{ ratio(pr.testsAfter) }}
                  </span>
                </span>
              </button>
            </li>
          </ul>

          <template #footer>
            <dl class="repo">
              <div class="repo__pair">
                <dt>Repositorio</dt>
                <dd class="mono repo__value" :title="data.repoPath">{{ repoShort }}</dd>
              </div>
              <div class="repo__pair">
                <dt>Ramas</dt>
                <dd v-for="b in data.branches" :key="b" class="mono repo__value" :title="b">{{ b }}</dd>
              </div>
            </dl>
          </template>
        </Card>

        <article v-if="selected" class="pr" :aria-labelledby="`pr-${selected.id}`">
          <div class="pr__header">
            <div class="pr__heading">
              <h2 :id="`pr-${selected.id}`" class="pr__title">{{ selected.title }}</h2>
              <StatusDot class="pr__status" :status="prState(selected).status" :label="prState(selected).label" />
            </div>
            <p class="pr__branch">
              <code>{{ selected.branch }}</code>
              <span class="pr__into" aria-hidden="true">→</span><span class="sr-only">hacia</span>
              <code>main</code>
            </p>
            <KeyValue class="pr__meta" layout="stacked" :items="detailItems">
              <template #case><CaseLink :case-id="selected.caseId" /></template>
              <template #github>
                <a
                  v-if="selected.github"
                  class="gh-link"
                  :href="selected.github.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="`Pull request #${selected.github.number} en GitHub`"
                >Ver en GitHub <span class="gh-link__arrow" aria-hidden="true">↗</span></a>
              </template>
              <template #ci>
                <StatusDot v-if="selectedCi" :status="selectedCi.status" :label="selectedCi.label" />
              </template>
            </KeyValue>
          </div>

          <div v-if="selected.status === 'open' && selected.github" class="callout" role="status">
            <StatusDot status="warning">
              Pendiente de fusión manual.
              <span class="callout__muted">Una persona lo revisa y lo fusiona en GitHub; la consola lo detecta sola.</span>
            </StatusDot>
            <Button
              as="a"
              :href="selected.github.url"
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              size="sm"
            >Abrir en GitHub</Button>
          </div>
          <div v-else-if="selected.status === 'open'" class="callout" role="status">
            <StatusDot status="neutral">
              Abierto.
              <span class="callout__muted">Lo fusiona una persona a mano en GitHub; sin GitHub conectado, queda abierto aquí.</span>
            </StatusDot>
          </div>
          <div v-else-if="selected.status === 'merged'" class="callout" role="status">
            <StatusDot status="success">
              Fusionado {{ selected.github ? 'a mano en GitHub' : 'en main' }}.
              <span class="callout__muted">La versión v{{ data.version }} se despliega en los datáfonos.</span>
            </StatusDot>
          </div>
          <div v-else-if="selected.status === 'closed'" class="callout" role="status">
            <StatusDot status="neutral">
              Cerrado sin fusionar.
              <span class="callout__muted">No se publica ninguna versión.</span>
            </StatusDot>
          </div>

          <section class="pr__section" aria-labelledby="pr-descripcion">
            <h3 id="pr-descripcion" class="pr__section-title">Descripción</h3>
            <div class="md">
              <template v-for="(block, i) in description" :key="i">
                <h4 v-if="block.type === 'heading'" class="md__heading">
                  <template v-for="(t, k) in block.lines[0]" :key="k"><code v-if="t.code">{{ t.text }}</code><template v-else>{{ t.text }}</template></template>
                </h4>
                <ul v-else-if="block.type === 'list'" class="md__list">
                  <li v-for="(line, j) in block.lines" :key="j">
                    <template v-for="(t, k) in line" :key="k"><code v-if="t.code">{{ t.text }}</code><template v-else>{{ t.text }}</template></template>
                  </li>
                </ul>
                <p v-else class="md__paragraph">
                  <template v-for="(line, j) in block.lines" :key="j"><br v-if="j > 0" /><template v-for="(t, k) in line" :key="k"><code v-if="t.code">{{ t.text }}</code><template v-else>{{ t.text }}</template></template></template>
                </p>
              </template>
            </div>
          </section>

          <section class="pr__section" aria-labelledby="pr-tests">
            <h3 id="pr-tests" class="pr__section-title">Tests</h3>
            <div class="compare">
              <TestsCard label="Antes del arreglo" sublabel="main" :run="selected.testsBefore" hide-output />
              <svg class="compare__arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M2.5 8h11M9.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <TestsCard label="Con el arreglo" :sublabel="selected.branch" :run="selected.testsAfter" hide-output />
            </div>
            <details v-if="selected.testsBefore.output || selected.testsAfter.output" class="output">
              <summary class="output__summary">
                <svg class="output__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                  <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                Ver salida de los tests
              </summary>
              <div class="output__blocks">
                <CodeBlock
                  v-if="selected.testsBefore.output"
                  label="Antes del arreglo · main"
                  :code="selected.testsBefore.output"
                  wrap
                  max-height="280px"
                />
                <CodeBlock
                  v-if="selected.testsAfter.output"
                  :label="`Con el arreglo · ${selected.branch}`"
                  :code="selected.testsAfter.output"
                  wrap
                  max-height="280px"
                />
              </div>
            </details>
          </section>

          <section class="pr__section">
            <DiffBlock title="Diff contra main" :diff="selected.diff" />
          </section>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.codigo {
  container: codigo / inline-size;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

/* ── Repositorio y aviso ───────────────────── */
/* Con el distintivo del repositorio, las acciones no caben en una línea en móvil: se reparten. */
.codigo :deep(.page-header__actions) {
  flex: 0 1 auto;
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

.gh-link {
  white-space: nowrap;
}
.gh-link__arrow {
  color: var(--fg-subtle);
}
.gh-link:hover .gh-link__arrow {
  color: var(--fg);
}

/* ── Versión actual ───────────────────────── */
.version {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: var(--text-sm);
  line-height: 20px;
}
.version__label {
  color: var(--fg-muted);
}
.version__note {
  color: var(--fg-subtle);
}

/* ── Lista + detalle ──────────────────────── */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
@container codigo (min-width: 960px) {
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
.row__tests {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
  white-space: nowrap;
}
.row__date {
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
  white-space: nowrap;
}
/* Sobre el fondo gris de hover y selección, los metadatos suben a --fg-muted para mantener el contraste. */
.row:hover .row__id,
.row:hover .row__date,
.row:hover .row__tests,
.row.is-selected .row__id,
.row.is-selected .row__date,
.row.is-selected .row__tests {
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

.repo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  line-height: 16px;
}
.repo__pair {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.repo dt {
  color: var(--fg-subtle);
}
.repo dd {
  min-width: 0;
  margin: 0;
  color: var(--fg-muted);
}
.repo__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repo .mono {
  font-size: var(--text-xs);
}
/* Con la lista a lo ancho, repositorio y ramas van en una fila. */
@container codigo (max-width: 959px) {
  .repo {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px 32px;
  }
}

/* ── Detalle del PR ───────────────────────── */
.pr {
  container: pr / inline-size;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  padding: 24px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
@container codigo (max-width: 520px) {
  .pr {
    padding: 16px;
  }
}

.pr__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.pr__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 24px;
}
.pr__title {
  flex: 1 1 28ch;
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
}
.pr__status {
  flex: none;
  margin-top: 4px;
  font-size: var(--text-sm);
}
.pr__branch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
.pr__branch code {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  line-height: 20px;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.pr__into {
  color: var(--fg-subtle);
}
.pr__meta {
  margin-top: 8px;
}

.callout {
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
  font-weight: 500;
}
.callout__muted {
  font-weight: 400;
  color: var(--fg-muted);
}

.pr__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
.pr__section-title {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
}

/* Descripción en texto: apartados, párrafos y listas. */
.md {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 72ch;
  font-size: var(--text-base);
  line-height: 22px;
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.md__heading {
  margin-top: 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 20px;
  color: var(--fg);
}
.md__heading:first-child {
  margin-top: 0;
}
.md__list {
  margin: 0;
  padding-left: 20px;
}
.md__list li + li {
  margin-top: 4px;
}
.md code {
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: var(--text-xs);
  color: var(--fg);
}

/* Tests: antes → después, y la salida a lo ancho. */
.output__summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--fg-muted);
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: color 150ms var(--ease);
}
.output__summary::-webkit-details-marker {
  display: none;
}
.output__summary:hover {
  color: var(--fg);
}
.output__chevron {
  flex: none;
  transition: transform 150ms var(--ease);
}
.output[open] .output__chevron {
  transform: rotate(90deg);
}
.output__blocks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.compare {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.compare__arrow {
  align-self: center;
  color: var(--fg-subtle);
  transform: rotate(90deg);
}
@container pr (min-width: 560px) {
  .compare {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr);
    align-items: start;
    gap: 12px;
  }
  .compare__arrow {
    align-self: start;
    /* A la altura de las cifras: borde de 1px + 12px de padding + cabecera de 36px + 12px de hueco + media línea de 28px − 8px. */
    margin-top: 67px;
    transform: none;
  }
}
</style>
