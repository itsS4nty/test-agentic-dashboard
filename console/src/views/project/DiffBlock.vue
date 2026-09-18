<script setup lang="ts">
/**
 * Diff unificado en `pre.diff` (docs/DESIGN.md § 6 · Código). Líneas añadidas y quitadas con los
 * fondos de estado de `styles.css`, números de línea de antes y de después (sacados de las
 * cabeceras `@@`) y una fila por fichero. Las líneas `index`, `---` y `+++` no se pintan: el
 * nombre del fichero ya va en su fila.
 * API: `diff`; `title?` pinta un h3 con el resumen (+N −N) en la misma línea.
 */
import { computed } from 'vue';

const props = defineProps<{ diff: string; title?: string }>();

type Kind = 'file' | 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'note';

interface DiffLine {
  kind: Kind;
  /** Signo (`+`, `-` o espacio) de las líneas de código; vacío en cabeceras. */
  sign: string;
  text: string;
  before?: number;
  after?: number;
}

const HIDDEN = /^(index |--- |\+\+\+ )/;
const META = /^(new file|deleted file|similarity|rename |old mode|new mode|Binary files)/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

const lines = computed<DiffLine[]>(() => {
  const raw = props.diff.replace(/\n$/, '');
  if (!raw) return [];
  let before = 0;
  let after = 0;
  /* Líneas que quedan en el bloque `@@` en curso: mientras haya, nada es cabecera. */
  let leftBefore = 0;
  let leftAfter = 0;
  let fileRow = false;
  const out: DiffLine[] = [];
  for (const line of raw.split('\n')) {
    const inHunk = leftBefore > 0 || leftAfter > 0;
    if (!inHunk) {
      if (line.startsWith('diff --git')) {
        const m = GIT_HEADER.exec(line);
        out.push({ kind: 'file', sign: '', text: m ? (m[1] === m[2] ? m[2] : `${m[1]} → ${m[2]}`) : line });
        fileRow = true;
        continue;
      }
      if (HIDDEN.test(line)) {
        // Diff sin cabecera git: el fichero sale de `+++ b/ruta`.
        if (line.startsWith('+++ ') && !fileRow) {
          out.push({ kind: 'file', sign: '', text: line.slice(4).replace(/^b\//, '') });
          fileRow = true;
        }
        continue;
      }
      if (META.test(line)) {
        out.push({ kind: 'meta', sign: '', text: line });
        continue;
      }
      const m = HUNK.exec(line);
      if (m) {
        before = Number(m[1]);
        after = Number(m[3]);
        leftBefore = m[2] === undefined ? 1 : Number(m[2]);
        leftAfter = m[4] === undefined ? 1 : Number(m[4]);
        fileRow = false;
        out.push({ kind: 'hunk', sign: '', text: line });
        continue;
      }
    }
    if (line.startsWith('\\')) {
      out.push({ kind: 'note', sign: '', text: line });
      continue;
    }
    const sign = line.charAt(0);
    const text = line.slice(1);
    if (sign === '+') {
      out.push({ kind: 'add', sign, text, after: inHunk ? after++ : undefined });
      if (leftAfter > 0) leftAfter--;
    } else if (sign === '-') {
      out.push({ kind: 'del', sign, text, before: inHunk ? before++ : undefined });
      if (leftBefore > 0) leftBefore--;
    } else {
      out.push({
        kind: 'ctx',
        sign: ' ',
        text: sign === ' ' ? text : line,
        before: inHunk ? before++ : undefined,
        after: inHunk ? after++ : undefined,
      });
      if (leftBefore > 0) leftBefore--;
      if (leftAfter > 0) leftAfter--;
    }
  }
  return out;
});

const added = computed(() => lines.value.filter((l) => l.kind === 'add').length);
const removed = computed(() => lines.value.filter((l) => l.kind === 'del').length);
const files = computed(() => lines.value.filter((l) => l.kind === 'file').length);

const CLASS: Record<Kind, string> = {
  file: 'dl--file',
  meta: 'dl--meta',
  hunk: 'diff-hunk dl--hunk',
  add: 'diff-add',
  del: 'diff-del',
  ctx: '',
  note: 'dl--meta',
};

const regionLabel = computed(() => props.title ?? 'Diff');
</script>

<template>
  <div class="diff-block">
    <div v-if="title || lines.length" class="diff-block__head">
      <h3 v-if="title" class="diff-block__title">{{ title }}</h3>
      <p v-if="lines.length" class="diff-block__summary">
        <span v-if="files > 0" class="diff-block__files">{{ files }} {{ files === 1 ? 'fichero' : 'ficheros' }}</span>
        <span class="diff-block__count" :class="{ 'diff-block__count--add': added > 0 }">+{{ added }}<span class="sr-only"> {{ added === 1 ? 'línea añadida' : 'líneas añadidas' }}</span></span>
        <span class="diff-block__count" :class="{ 'diff-block__count--del': removed > 0 }">−{{ removed }}<span class="sr-only"> {{ removed === 1 ? 'línea quitada' : 'líneas quitadas' }}</span></span>
      </p>
    </div>

    <pre
      v-if="lines.length"
      class="diff"
      role="region"
      :aria-label="regionLabel"
      tabindex="0"
    ><span
      v-for="(line, i) in lines"
      :key="i"
      class="dl"
      :class="CLASS[line.kind]"
    ><span class="dl__num" aria-hidden="true">{{ line.before ?? '' }}</span><span class="dl__num" aria-hidden="true">{{ line.after ?? '' }}</span><span class="dl__sign">{{ line.sign }}</span><span class="dl__code">{{ line.text || ' ' }}</span></span></pre>
    <p v-else class="diff-block__empty">El PR no tiene cambios respecto a main.</p>
  </div>
</template>

<style scoped>
.diff-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.diff-block__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
  min-width: 0;
}
.diff-block__title {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 20px;
}
.diff-block__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-subtle);
}
.diff-block__count {
  font-family: var(--font-mono);
  font-weight: 500;
}
.diff-block__count--add {
  color: var(--success);
}
.diff-block__count--del {
  color: var(--danger);
}

/* ── pre.diff ─────────────────────────────── */
.diff {
  padding: 8px 0;
  font-size: var(--text-xs);
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}

.dl {
  display: grid;
  grid-template-columns: 5ch 5ch 3ch max-content;
  width: max-content;
  min-width: 100%;
  padding: 0 16px 0 0;
  white-space: pre;
}
.dl__num {
  padding-right: 1ch;
  text-align: right;
  color: var(--fg-subtle);
  user-select: none;
}
.dl__sign {
  padding-left: 1ch;
  color: var(--fg-subtle);
  user-select: none;
}
.diff-add .dl__sign {
  color: var(--success);
}
.diff-del .dl__sign {
  color: var(--danger);
}
.diff-add .dl__num,
.diff-del .dl__num {
  color: var(--fg-muted);
}

/* Filas de cabecera a lo ancho: fichero, metadatos y bloques `@@`. */
.dl--file,
.dl--meta,
.dl--hunk {
  grid-template-columns: max-content;
  padding: 0 16px;
}
.dl--file .dl__num,
.dl--file .dl__sign,
.dl--meta .dl__num,
.dl--meta .dl__sign,
.dl--hunk .dl__num,
.dl--hunk .dl__sign {
  display: none;
}
.dl--file {
  margin-bottom: 4px;
  font-weight: 500;
  color: var(--fg);
}
.dl--file:not(:first-child) {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.dl--meta {
  color: var(--fg-subtle);
}

.diff-block__empty {
  font-size: var(--text-sm);
  line-height: 20px;
  color: var(--fg-muted);
}
</style>
