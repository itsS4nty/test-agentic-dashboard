/**
 * Proyecto dispositivo: datáfonos, impresoras y routers en tienda (docs/CONTRACTS.md § 6.1).
 *
 * Reglas deterministas para lo repetitivo (reiniciar, avisar a la tienda) y el agente
 * `dispositivos` para lo que las reglas no resuelven (fallos persistentes y olas).
 */
import type { ProjectModule } from '../../platform/contracts.ts';
import { dispositivosMock } from './mock.ts';
import { DEVICE_AGENT, dispositivoPredicates, dispositivoRules } from './rules.ts';
import { dispositivoScenarios } from './scenarios.ts';
import { PROJECT_ID, simulator } from './simulator.ts';
import { dispositivoTools } from './tools.ts';

export const dispositivo: ProjectModule = {
  id: PROJECT_ID,
  name: 'Dispositivos',
  description:
    'Datáfonos, impresoras y routers de las tiendas: reglas que reinician y avisan en segundos, y un agente para los fallos que las reglas no resuelven.',
  tools: dispositivoTools,
  rules: dispositivoRules,
  predicates: dispositivoPredicates,
  mocks: { [DEVICE_AGENT]: dispositivosMock },
  scenarios: dispositivoScenarios,

  async init(platform) {
    simulator.attach(platform);
    simulator.load();
  },

  async reset(platform) {
    simulator.attach(platform);
    simulator.resetState();
  },

  snapshot(platform) {
    simulator.attach(platform);
    return simulator.snapshot();
  },

  stop() {
    simulator.stop();
  },
};
