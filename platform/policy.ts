/**
 * Policy Gate. El dial es un TECHO de autonomía:
 *   1. techo en cascada: defecto → override de cliente → override de tienda;
 *   2. condiciones en orden: `deny`/`escalate` bloquean; un nivel solo puede BAJAR el techo.
 * Nunca se sube autonomía por una condición.
 */
import { join } from 'node:path';
import { AUTONOMY_ORDER } from './contracts.ts';
import type {
  ActionPolicy,
  AutonomyLevel,
  PlatformApi,
  PolicyConfig,
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluation,
  PolicyOverride,
  PolicyPredicate,
  PredicateArgs,
  Scope,
} from './contracts.ts';
import { clone, errorMessage, readYamlFile } from './util.ts';

const STORE_KEY = 'policy';

const isLevel = (value: unknown): value is AutonomyLevel => AUTONOMY_ORDER.includes(value as AutonomyLevel);
const isDecision = (value: unknown): value is PolicyDecision => isLevel(value) || value === 'deny' || value === 'escalate';
const rank = (level: AutonomyLevel) => AUTONOMY_ORDER.indexOf(level);

export function loadPolicyConfig(rootDir: string): PolicyConfig {
  const path = join(rootDir, 'config', 'policies.yaml');
  const raw = readYamlFile(path) ?? {};

  const actions: ActionPolicy[] = (Array.isArray(raw.actions) ? raw.actions : []).map((a: any) => {
    if (!a?.action) throw new Error(`${path}: hay una acción sin nombre`);
    if (!isLevel(a.level)) throw new Error(`${path}: nivel no válido en ${a.action}: ${a.level}`);
    const conditions = (Array.isArray(a.conditions) ? a.conditions : []).map((c: any) => {
      if (!isDecision(c?.decision)) throw new Error(`${path}: decisión no válida en ${a.action}: ${c?.decision}`);
      return {
        when: (Array.isArray(c.when) ? c.when : [c.when]).filter(Boolean).map(String),
        decision: c.decision,
        label: String(c.label ?? c.when),
      };
    });
    return { action: String(a.action), level: a.level, ...(conditions.length ? { conditions } : {}) };
  });

  const overrides: PolicyOverride[] = (Array.isArray(raw.overrides) ? raw.overrides : []).map((o: any) => {
    if (!o?.action || !isLevel(o.level)) throw new Error(`${path}: override no válido: ${JSON.stringify(o)}`);
    const scope: Scope = {};
    if (o.scope?.clientId) scope.clientId = String(o.scope.clientId);
    if (o.scope?.siteId) scope.siteId = String(o.scope.siteId);
    if (!scope.clientId && !scope.siteId) throw new Error(`${path}: el override de ${o.action} no tiene cliente ni tienda`);
    return { scope, action: String(o.action), level: o.level };
  });

  return { actions, overrides };
}

/** Un override de tienda se identifica por tienda; uno de cliente, por cliente (sin tienda). */
function sameTarget(a: Scope, b: Scope): boolean {
  return b.siteId ? a.siteId === b.siteId : !a.siteId && a.clientId === b.clientId;
}

export function createPolicyEngine(platform: PlatformApi): PolicyEngine {
  let baseline = loadPolicyConfig(platform.rootDir);
  const predicates = new Map<string, PolicyPredicate>();
  const warnedPredicates = new Set<string>();

  const current = (): PolicyConfig => platform.store.getValue<PolicyConfig>(STORE_KEY) ?? baseline;

  function save(config: PolicyConfig): PolicyConfig {
    platform.store.setValue(STORE_KEY, config);
    platform.events.emit({ type: 'policy.changed', config });
    return config;
  }

  function completeScope(scope: Scope): Scope {
    const out: Scope = { ...scope };
    if (out.siteId && !out.clientId) {
      const site = platform.directory.site(out.siteId);
      if (site) out.clientId = site.clientId;
    }
    return out;
  }

  async function allPredicatesHold(names: string[], args: PredicateArgs): Promise<boolean> {
    for (const name of names) {
      const predicate = predicates.get(name);
      if (!predicate) {
        if (!warnedPredicates.has(name)) {
          warnedPredicates.add(name);
          console.warn(`[política] Predicado no registrado: "${name}". Se considera falso.`);
        }
        return false;
      }
      try {
        if (!(await predicate(args))) return false;
      } catch (err) {
        console.warn(`[política] El predicado "${name}" ha fallado; se considera falso. ${errorMessage(err)}`);
        return false;
      }
    }
    return true;
  }

  return {
    getConfig: current,

    setActionLevel(action, level) {
      if (!isLevel(level)) throw new Error(`Nivel de autonomía no válido: ${level}`);
      const config = clone(current());
      const entry = config.actions.find((a) => a.action === action);
      if (entry) entry.level = level;
      else if (platform.tools.get(action)) config.actions.push({ action, level });
      else throw new Error(`Acción desconocida: ${action}`);
      return save(config);
    },

    setOverride(scope, action, level) {
      if (level !== null && !isLevel(level)) throw new Error(`Nivel de autonomía no válido: ${level}`);
      const target: Scope = {};
      const full = completeScope(scope ?? {});
      if (full.clientId) target.clientId = full.clientId;
      if (full.siteId) target.siteId = full.siteId;
      if (!target.clientId && !target.siteId) throw new Error('Un override necesita un cliente o una tienda.');

      const config = clone(current());
      const index = config.overrides.findIndex((o) => o.action === action && sameTarget(o.scope, target));
      if (level === null) {
        if (index >= 0) config.overrides.splice(index, 1);
      } else if (index >= 0) {
        config.overrides[index] = { scope: target, action, level };
      } else {
        config.overrides.push({ scope: target, action, level });
      }
      return save(config);
    },

    registerPredicate(name, fn) {
      predicates.set(name, fn);
    },

    async evaluate(action, input, scope, caseId): Promise<PolicyEvaluation> {
      const config = current();
      const fullScope = completeScope(scope ?? {});
      const entry = config.actions.find((a) => a.action === action);

      // 1. Techo por cascada.
      let ceiling: AutonomyLevel;
      let ceilingSource: PolicyEvaluation['ceilingSource'];
      let ceilingText: string;
      if (entry) {
        ceiling = entry.level;
        ceilingSource = 'default';
        ceilingText = 'por defecto';
      } else {
        const isRead = platform.tools.get(action)?.risk === 'read';
        ceiling = isRead ? 'auto' : 'approve';
        ceilingSource = 'unconfigured';
        ceilingText = isRead ? 'acción sin configurar, de lectura' : 'acción sin configurar';
      }

      const clientOverride = fullScope.clientId
        ? config.overrides.find((o) => o.action === action && !o.scope.siteId && o.scope.clientId === fullScope.clientId)
        : undefined;
      if (clientOverride) {
        ceiling = clientOverride.level;
        ceilingSource = 'client';
        ceilingText = `override de cliente ${platform.directory.client(fullScope.clientId!)?.name ?? fullScope.clientId}`;
      }

      const siteOverride = fullScope.siteId
        ? config.overrides.find((o) => o.action === action && o.scope.siteId === fullScope.siteId)
        : undefined;
      if (siteOverride) {
        ceiling = siteOverride.level;
        ceilingSource = 'site';
        ceilingText = `override de tienda ${platform.directory.describeScope({ siteId: fullScope.siteId })}`;
      }

      const base = { action, scope: fullScope, ceiling, ceilingSource };

      // 2. Condiciones en orden: bloquean o bajan el techo; nunca lo suben.
      const args: PredicateArgs = { action, input, scope: fullScope, caseId, platform };
      let level = ceiling;
      let matchedCondition: string | undefined;
      const lowered: string[] = [];
      for (const condition of entry?.conditions ?? []) {
        if (!(await allPredicatesHold(condition.when, args))) continue;
        if (condition.decision === 'deny' || condition.decision === 'escalate') {
          const verb = condition.decision === 'deny' ? 'Bloqueado' : 'Escalado';
          return { ...base, decision: condition.decision, matchedCondition: condition.label, reason: `${verb}: ${condition.label}` };
        }
        if (rank(condition.decision) < rank(level)) {
          level = condition.decision;
          matchedCondition = condition.label;
          lowered.push(`baja a ${level}: ${condition.label}`);
        }
      }

      // 3. Decisión = techo final.
      const tail = lowered.length ? lowered.join(' · ') : 'sin condiciones activas';
      return { ...base, decision: level, matchedCondition, reason: `Techo ${ceiling} (${ceilingText}) · ${tail}` };
    },

    reset() {
      baseline = loadPolicyConfig(platform.rootDir);
      return save(clone(baseline));
    },
  };
}
