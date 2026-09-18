/** Motor de reglas deterministas: eventos de dominio → reglas suscritas, en serie. */
import type { DomainEvent, PlatformApi, Rule, RuleEngine } from './contracts.ts';
import { nowIso } from './util.ts';

export function createRuleEngine(platform: PlatformApi): RuleEngine {
  const rules: Rule[] = [];

  return {
    register(rule) {
      const index = rules.findIndex((r) => r.id === rule.id);
      if (index >= 0) rules[index] = rule;
      else rules.push(rule);
    },

    list: () => [...rules],

    async emit<P>(name: string, payload: P) {
      const event: DomainEvent<P> = { name, payload, at: nowIso() };
      platform.events.emit({ type: 'domain', event });
      for (const rule of rules.filter((r) => r.on === name)) {
        try {
          await rule.handle(event, platform);
        } catch (err) {
          console.error(`[reglas] La regla ${rule.id} ha fallado con el evento ${name}:`, err);
        }
      }
    },
  };
}
