/**
 * Guion del modo simulado para el agente `bugs`.
 *
 * Cada turno decide el siguiente paso a partir del resultado REAL de la herramienta
 * anterior: busca, lee, reproduce con tests, construye el arreglo a partir del fichero
 * leído, lo verifica en la rama y abre el PR. Ahí termina: el PR lo fusiona una persona a mano
 * en GitHub. Si la política no deja ejecutar algo, se detiene y lo explica; nunca intenta rodearla.
 */
import type { MockContext, MockScript, MockToolResult, MockTurn } from '../../platform/contracts.ts';
import { bumpPatch, clip, COMPONENT, getState } from './state.ts';

const TARGET_FILE = 'src/terminal.ts';
const FIX_BRANCH = 'fix/terminal-libera-tras-timeout';
const PR_TITLE = 'Liberar el terminal tras un timeout de cobro';
const FAILING_SYMPTOM = 'Terminal ocupado';

const COMMIT_MESSAGE = [
  'fix(terminal): liberar el terminal tras un timeout de cobro',
  '',
  'En PaymentTerminal.charge, la rama de timeout anulaba la operación en el',
  'lector pero no volvía a idle ni limpiaba la transacción pendiente. El',
  'siguiente cobro fallaba con "Terminal ocupado" y el datáfono quedaba',
  'bloqueado hasta reiniciarlo.',
].join('\n');

interface TestData {
  branch?: string;
  passed: number;
  failed: number;
  output?: string;
  failures?: string[];
}

/**
 * Arreglo mínimo y determinista: añade `this.finish();` justo antes del `return` de la
 * rama de timeout. Devuelve null si el código no tiene esa forma o ya está corregido.
 */
export function buildTimeoutFix(original: string): string | null {
  const timeoutReturn = /^([ \t]*)return \{ status: 'timeout'/m.exec(original);
  if (!timeoutReturn) return null;
  const head = original.slice(0, timeoutReturn.index);
  const branchStart = head.lastIndexOf('if (response === TIMEOUT)');
  if (branchStart === -1 || head.slice(branchStart).includes('this.finish()')) return null;
  return `${head}${timeoutReturn[1]}this.finish();\n${original.slice(timeoutReturn.index)}`;
}

function lastOk(ctx: MockContext, name: string, match: (r: MockToolResult) => boolean = () => true) {
  return [...ctx.allResults].reverse().find((r) => r.name === name && r.ok && r.executed && match(r));
}

function testsOn(ctx: MockContext, branch: string): TestData | undefined {
  const found = lastOk(ctx, 'bugs_run_tests', (r) => ((r.data as TestData | undefined)?.branch ?? 'main') === branch);
  return found?.data as TestData | undefined;
}

function countLine(run: TestData): string {
  return `${run.passed} ${run.passed === 1 ? 'pasa' : 'pasan'} y ${run.failed} ${run.failed === 1 ? 'falla' : 'fallan'}`;
}

function nextVersion(ctx: MockContext): string {
  return bumpPatch(getState(ctx.platform).version);
}

function prDescription(ctx: MockContext, before: TestData, after: TestData, branch: string): string {
  const reported = String(ctx.caseRecord.data.softwareVersion ?? getState(ctx.platform).version);
  const failing = before.failures?.[0];
  return [
    '## Diagnóstico',
    `Los datáfonos con ${COMPONENT} ${reported} se quedan bloqueados después de un cobro que agota el tiempo de ` +
      'espera del lector: cualquier cobro posterior responde "Terminal ocupado" hasta que se reinicia el equipo.',
    '',
    '## Causa raíz',
    'En `PaymentTerminal.charge` (`src/terminal.ts`), cuando el lector no contesta dentro de `timeoutMs`, la rama ' +
      "de timeout anula la operación con `device.cancel()` y devuelve `status: 'timeout'`, pero no llama a " +
      '`finish()`. El estado se queda en `processing` y `pendingTransaction` conserva la operación anulada, así que ' +
      'el siguiente `charge()` lanza `TerminalBusyError`. Las salidas de éxito, denegación y error sí pasan por `finish()`.',
    '',
    'Encaja con lo observado en los dispositivos: afecta a todas las tiendas con la misma versión, aparece justo después de un ' +
      'timeout de cobro y el reinicio lo alivia porque arranca un terminal nuevo en `idle`.',
    '',
    '## Arreglo',
    'Una línea: llamar a `finish()` en la rama de timeout antes de devolver el resultado. No cambia nada más.',
    '',
    '## Tests',
    `- Antes, en \`main\`: ${countLine(before)}${failing ? ` («${failing}»)` : ''}.`,
    `- Después, en \`${branch}\`: ${countLine(after)}.`,
    '',
    '## Riesgo y despliegue',
    `Bajo: el cambio solo afecta a la rama de timeout. Al fusionar se publica ${COMPONENT} ${nextVersion(ctx)} ` +
      'y se despliega en los datáfonos. La fusión la hace una persona a mano en GitHub tras revisar el PR.',
  ].join('\n');
}

function stoppedReport(result: MockToolResult): string {
  switch (result.decision) {
    case 'approve':
      return `La acción ${result.name} ha quedado pendiente de aprobación humana y todavía no se ha ejecutado. Me detengo aquí; cuando se decida se podrá seguir con el siguiente paso.`;
    case 'shadow':
      return `El dial tiene ${result.name} en modo sombra: la acción se ha registrado pero no se ha ejecutado. Me detengo aquí sin intentar rodearlo.`;
    case 'deny':
    case 'escalate':
      return `La política ha bloqueado ${result.name}: ${result.content}\nRespeto la decisión y dejo el caso para una persona.`;
    default:
      return `La herramienta ${result.name} ha fallado:\n${clip(result.content, 600)}\nMe detengo y dejo el caso para revisión.`;
  }
}

function notReproducedReport(ctx: MockContext, tests: TestData): string {
  const repoVersion = getState(ctx.platform).version;
  const reported = ctx.caseRecord.data.softwareVersion ? String(ctx.caseRecord.data.softwareVersion) : undefined;
  return [
    `Diagnóstico: no encuentro en ${COMPONENT} un bug que explique los bloqueos.`,
    '',
    'Comprobado:',
    `- En main (versión ${repoVersion}) pasan los ${tests.passed} tests, incluido el de recuperación tras un timeout de cobro.`,
    '- La rama de timeout de PaymentTerminal.charge ya devuelve el terminal a idle.',
    ...(reported && reported !== repoVersion
      ? [`- La evidencia habla de la versión ${reported}, pero el código actual es la ${repoVersion}.`]
      : []),
    '',
    'Conclusión: no parece nuestro código. Si los datáfonos siguen bloqueándose, lo probable es que no ejecuten la ' +
      'última versión o que la causa esté fuera (red de la tienda, lector o despliegue). No he creado ramas ni PRs.',
    '',
    'Pendiente: que operaciones de dispositivos verifique la versión desplegada en los datáfonos afectados.',
  ].join('\n');
}

function finalReport(ctx: MockContext, open: MockToolResult): string {
  const pr = open.data as { id: string; branch: string; version?: string; github?: { number: number; url: string } } | undefined;
  const prId = pr?.id ?? 'el PR';
  const branch = pr?.branch ?? FIX_BRANCH;
  const before = testsOn(ctx, 'main');
  const after = testsOn(ctx, branch);
  const version = pr?.version ?? nextVersion(ctx);
  const where = pr?.github ? `en GitHub (#${pr.github.number}, ${pr.github.url})` : 'en la consola';

  return [
    `Diagnóstico: bug confirmado en ${COMPONENT}.`,
    '',
    'Causa raíz: en PaymentTerminal.charge (src/terminal.ts), la rama de timeout anula la operación en el lector ' +
      'pero no llama a finish(). El terminal se queda en "processing" con la transacción pendiente y el siguiente ' +
      'cobro falla con "Terminal ocupado": es el datáfono bloqueado que ve dispositivo. Reiniciar arranca un terminal ' +
      'nuevo en idle, por eso lo alivia solo hasta el siguiente timeout.',
    '',
    'Hecho:',
    before ? `- Reproducido en main: ${countLine(before)}.` : '- Reproducido en main con los tests.',
    `- Arreglo de una línea en la rama ${branch}: llamar a finish() también en la rama de timeout.`,
    after ? `- ${prId} abierto ${where} con los tests en verde: ${countLine(after)}.` : `- ${prId} abierto ${where}.`,
    '',
    `Pendiente: una persona revisa ${prId} y lo fusiona a mano en GitHub; yo no lo fusiono. Al fusionarlo se publica ` +
      `${COMPONENT} ${version} y se despliega en los datáfonos. Después, comprobar en tienda que no vuelven los bloqueos.`,
  ].join('\n');
}

export const bugsMock: MockScript = (ctx): MockTurn => {
  const last = ctx.lastResults.at(-1);

  if (!last) {
    return {
      text: 'La evidencia apunta a lo que pasa tras un timeout de cobro. Empiezo localizando en el código dónde se gestiona el timeout.',
      toolCalls: [{ name: 'bugs_search_code', input: { query: 'timeout' } }],
    };
  }

  if (!last.executed || !last.ok) return { text: stoppedReport(last) };

  switch (last.name) {
    case 'bugs_search_code': {
      const matches = (last.data as { matches?: { path: string }[] } | undefined)?.matches ?? [];
      const inTarget = matches.filter((m) => m.path === TARGET_FILE).length;
      return {
        text: `La búsqueda de «timeout» da ${matches.length} coincidencias y ${inTarget} están en ${TARGET_FILE}, donde vive la máquina de estados del cobro. Leo el fichero completo antes de sacar conclusiones.`,
        toolCalls: [{ name: 'bugs_read_file', input: { path: TARGET_FILE } }],
      };
    }

    case 'bugs_read_file': {
      const content = (last.data as { content?: string } | undefined)?.content ?? '';
      const text = buildTimeoutFix(content)
        ? 'En la rama `if (response === TIMEOUT)` se anula la operación en el lector y se devuelve `timeout`, pero no se llama a `finish()` como en las demás salidas. Antes de tocar nada, ejecuto los tests en main para reproducirlo.'
        : 'La rama de timeout parece devolver el terminal a idle. Ejecuto los tests en main para confirmarlo con evidencia.';
      return { text, toolCalls: [{ name: 'bugs_run_tests', input: {} }] };
    }

    case 'bugs_run_tests': {
      const tests = last.data as TestData;
      const branch = tests.branch ?? 'main';

      if (branch === 'main') {
        if (tests.failed === 0) return { text: notReproducedReport(ctx, tests) };
        const original = (lastOk(ctx, 'bugs_read_file', (r) => r.input?.path === TARGET_FILE)?.data as { content?: string } | undefined)
          ?.content;
        const fixed = original ? buildTimeoutFix(original) : null;
        if (!fixed) {
          return {
            text: `En main ${countLine(tests)}, pero el código no tiene la forma que esperaba y no puedo construir un arreglo mínimo con garantías. Dejo el caso para revisión de una persona.`,
          };
        }
        const failing = tests.failures?.[0];
        const symptom = tests.output?.includes(FAILING_SYMPTOM) ? ` con "TerminalBusyError: ${FAILING_SYMPTOM}"` : '';
        return {
          text: `Reproducido en main: ${countLine(tests)}.${failing ? ` Falla «${failing}»${symptom}, que es exactamente el bloqueo que ve dispositivo.` : ''} Propongo el arreglo mínimo: llamar a finish() también en la rama de timeout.`,
          toolCalls: [
            {
              name: 'bugs_propose_fix',
              input: { branch: FIX_BRANCH, files: [{ path: TARGET_FILE, content: fixed }], commitMessage: COMMIT_MESSAGE },
            },
          ],
        };
      }

      if (tests.failed > 0) {
        return {
          text: `Con el arreglo, en ${branch} ${countLine(tests)}. No abro el PR con tests en rojo; dejo el caso para revisión.`,
        };
      }
      const before = testsOn(ctx, 'main') ?? { passed: 0, failed: 0 };
      return {
        text: `Tests en verde en ${branch}: ${countLine(tests)}. Abro el PR con el diagnóstico.`,
        toolCalls: [
          { name: 'bugs_open_pr', input: { branch, title: PR_TITLE, description: prDescription(ctx, before, tests, branch) } },
        ],
      };
    }

    case 'bugs_propose_fix': {
      const branch = (last.data as { branch?: string } | undefined)?.branch ?? FIX_BRANCH;
      return {
        text: `Cambio guardado en la rama ${branch}. Ejecuto los tests en la rama antes de abrir el PR.`,
        toolCalls: [{ name: 'bugs_run_tests', input: { branch } }],
      };
    }

    // Abrir el PR es el último paso: la fusión la hace una persona a mano en GitHub.
    case 'bugs_open_pr':
      return { text: finalReport(ctx, last) };

    default:
      return { text: 'He terminado la investigación sin un siguiente paso claro. Dejo el caso para revisión.' };
  }
};
