/**
 * Proyecto "Código": un agente que investiga bugs sospechados en terminal-pagos sobre un
 * repositorio git real, lo arregla en una rama y abre un PR. El agente no fusiona: el PR lo fusiona
 * una persona a mano en GitHub y el sondeo hace el cierre (versión nueva en los datáfonos).
 */
import type { Case, PlatformApi, ProjectModule, Rule, Scenario } from '../../platform/contracts.ts';
import { linkFor, REMOTE_DIR, stopAllLinks } from './github.ts';
import { bugsMock } from './mock.ts';
import { displayPath, repoFor, type TerminalRepo } from './repo.ts';
import { AGENT_ID, COMPONENT, PROJECT_ID, getState, hasState, saveState } from './state.ts';
import { syncGitHub } from './sync.ts';
import { bugsTools } from './tools.ts';

/** Payload de `code.suspected_bug` (§ 5 del brief). */
export interface SuspectedBugPayload {
  component: string;
  symptom: string;
  evidence: string[];
  affectedSites: string[];
  softwareVersion: string;
  sourceCaseId?: string;
}

const RULE_ID = 'bugs.sospecha_de_bug';

const AGENT_TASK =
  'Operaciones sospecha que hay un bug en terminal-pagos; la evidencia está en los datos del caso. ' +
  'Reproduce el problema con los tests, localiza la causa raíz y, si es un bug de este código, propone el ' +
  'arreglo mínimo en una rama fix/…, comprueba que los tests pasan y abre un PR. No fusiones: el PR lo revisa y ' +
  'lo fusiona una persona a mano en GitHub. Si la evidencia apunta fuera del código, explícalo y no cambies nada.';

function findOpenCodeCase(platform: PlatformApi, component: string): Case | undefined {
  return platform.cases.findOpen(
    (c) => c.project === PROJECT_ID && c.source === 'code' && c.data.component === component,
  );
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

const suspectedBugRule: Rule<SuspectedBugPayload> = {
  id: RULE_ID,
  project: PROJECT_ID,
  description:
    'Al recibir una sospecha de bug en terminal-pagos abre un caso de código con la evidencia (si no hay ya uno ' +
    'abierto para el componente) y encola al agente de código.',
  on: 'code.suspected_bug',
  async handle(event, platform) {
    const payload = event.payload ?? ({} as Partial<SuspectedBugPayload>);
    const component = payload.component || COMPONENT;
    const evidence = strings(payload.evidence);
    const affectedSites = strings(payload.affectedSites);
    const detail = evidence.map((line) => `- ${line}`).join('\n') || undefined;

    const existing = findOpenCodeCase(platform, component);
    if (existing) {
      platform.cases.update(existing.id, {
        data: {
          ...existing.data,
          evidence: union(strings(existing.data.evidence), evidence),
          affectedSites: union(strings(existing.data.affectedSites), affectedSites),
        },
      });
      platform.cases.addTimeline(existing.id, {
        kind: 'rule',
        actor: 'rule',
        title: 'Nueva sospecha del mismo bug: se añade la evidencia al caso abierto',
        detail,
        data: { rule: RULE_ID },
      });
      return;
    }

    const version = payload.softwareVersion ? ` ${payload.softwareVersion}` : '';
    const created = platform.cases.create({
      project: PROJECT_ID,
      title: `Posible bug en ${component}${version}`,
      source: 'code',
      severity: 'high',
      scope: {},
      summary: payload.symptom,
      data: {
        component,
        symptom: payload.symptom,
        evidence,
        affectedSites,
        softwareVersion: payload.softwareVersion,
        sourceCaseId: payload.sourceCaseId,
      },
    });
    platform.cases.addTimeline(created.id, {
      kind: 'rule',
      actor: 'rule',
      title: 'Sospecha de bug recibida: caso de código abierto y agente de código encolado',
      detail,
      data: { rule: RULE_ID, affectedSites },
    });
    platform.runtime.enqueue({ agentId: AGENT_ID, caseId: created.id, task: AGENT_TASK });
  },
};

const EXAMPLE_SUSPICION: SuspectedBugPayload = {
  component: COMPONENT,
  symptom: 'Datáfonos bloqueados ("Terminal ocupado") justo después de un cobro que agota el tiempo de espera',
  evidence: [
    'Los 5 datáfonos afectados ejecutan terminal-pagos 2.14.2',
    'Cada bloqueo aparece inmediatamente después de un cobro que termina en timeout con el lector',
    'Tras el bloqueo, cualquier cobro nuevo responde "Terminal ocupado"',
    'Reiniciar el datáfono lo arregla, pero vuelve a bloquearse con el siguiente timeout',
    'Tiendas de dos clientes distintos afectadas en menos de 2 minutos: no es un problema de una red concreta',
  ],
  affectedSites: ['hr-centro', 'hr-ruzafa', 'hr-campanar', 'fb-gracia', 'fb-sants'],
  softwareVersion: '2.14.2',
};

const analyzeScenario: Scenario = {
  id: 'bugs-analizar',
  project: PROJECT_ID,
  title: 'Investigar la causa raíz de los bloqueos',
  description:
    'Envía al agente de código una sospecha de bug con evidencia de los dispositivos. Reproduce el fallo con tests reales, ' +
    'lo arregla en una rama y abre un PR; una persona lo revisa y lo fusiona a mano en GitHub.',
  order: 60,
  async run(platform) {
    const previous = findOpenCodeCase(platform, COMPONENT);
    await platform.rules.emit('code.suspected_bug', EXAMPLE_SUSPICION);
    if (previous) {
      return {
        message: `Ya había un caso de código abierto para ${COMPONENT} (${previous.id}); se le ha añadido la evidencia.`,
        caseIds: [previous.id],
      };
    }
    const created = findOpenCodeCase(platform, COMPONENT);
    if (!created) return { message: 'Sospecha de bug enviada, pero no se ha abierto ningún caso de código.' };
    return {
      message: `Sospecha de bug enviada. El agente de código investiga ${COMPONENT} en el caso ${created.id}.`,
      caseIds: [created.id],
    };
  },
};

async function saveRepoState(platform: PlatformApi, repo: TerminalRepo, patch: Parameters<typeof saveState>[1] = {}) {
  saveState(platform, { ...patch, version: await repo.readVersion(), branches: await repo.branches() });
}

/**
 * Deja el repositorio local listo. Con `keepExisting` conserva el trabajo previo si el estado sigue ahí
 * y es del mismo modo (mismo repositorio de GitHub, o local).
 *
 * El repositorio local nunca tiene remoto y esto nunca toca GitHub: con GitHub configurado solo se
 * valida el token contra el repositorio (lectura). «Reiniciar demo» recrea el repositorio local desde
 * la plantilla y deja en GitHub lo que haya (PRs abiertos incluidos).
 */
async function prepareRepo(platform: PlatformApi, keepExisting: boolean): Promise<void> {
  const repo = repoFor(platform);
  const link = linkFor(platform);
  link.stopPolling();
  link.setTicker(() => syncGitHub(platform));

  await repo.exclusive(async () => {
    const settings = await link.connect();
    if (settings) link.activate();
    // Con qué se enlazó el estado: el repositorio de la plataforma y la carpeta del producto.
    const binding = settings ? `${settings.repo}/${REMOTE_DIR}` : undefined;
    const previous = keepExisting && hasState(platform) && (await repo.isReady()) ? getState(platform) : undefined;

    // Mismo modo y mismo repositorio; o GitHub configurado pero sin poder usarse (no se tira el trabajo).
    const keep = previous && (previous.boundRepo === binding || (!settings && link.configured));
    if (keep) {
      await repo.removeRemote(); // restos de versiones anteriores de la demo: el repositorio es solo local
      await repo.checkoutMain();
      await saveRepoState(platform, repo);
    } else {
      await repo.recreate();
      await saveRepoState(platform, repo, { prs: [], boundRepo: binding });
    }
    link.announceWarning();
  });

  if (link.mode === 'github') {
    console.log(`[bugs] GitHub conectado: los PRs se abren en ${link.settings?.repo} (${REMOTE_DIR}/) y se fusionan a mano.`);
    link.schedule(1_000);
  }
}

export const bugs: ProjectModule = {
  id: PROJECT_ID,
  name: 'Código',
  description:
    'Un agente investiga los bugs que sospecha operaciones en terminal-pagos: reproduce con tests reales, arregla en una rama y abre un PR que una persona fusiona a mano en GitHub.',
  tools: bugsTools,
  rules: [suspectedBugRule],
  mocks: { [AGENT_ID]: bugsMock },
  scenarios: [analyzeScenario],

  async init(platform) {
    await prepareRepo(platform, true);
  },

  async reset(platform) {
    await prepareRepo(platform, false);
  },

  snapshot(platform) {
    const state = getState(platform);
    const link = linkFor(platform);
    return {
      repoPath: displayPath(platform),
      version: state.version,
      branches: state.branches,
      prs: [...state.prs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      mode: link.mode,
      ...(link.remote ? { remote: link.remote } : {}),
      ...(link.warning ? { warning: link.warning } : {}),
    };
  },

  stop() {
    stopAllLinks();
  },
};
