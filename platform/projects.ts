/** Registro de proyectos: cada módulo aporta herramientas, reglas, predicados, guiones y escenarios. */
import type { PlatformApi, ProjectModule, ProjectRegistry } from './contracts.ts';

export function createProjectRegistry(platform: PlatformApi): ProjectRegistry {
  const modules: ProjectModule[] = [];

  const registry: ProjectRegistry = {
    async register(project) {
      if (modules.some((m) => m.id === project.id)) throw new Error(`El proyecto ${project.id} ya está registrado.`);
      for (const tool of project.tools) platform.tools.register(tool);
      for (const rule of project.rules) platform.rules.register(rule);
      for (const [name, predicate] of Object.entries(project.predicates ?? {})) platform.policy.registerPredicate(name, predicate);
      for (const [agentId, script] of Object.entries(project.mocks ?? {})) platform.llm.registerMock(agentId, script);
      modules.push(project);
      if (project.init) {
        try {
          await project.init(platform);
        } catch (err) {
          console.error(`[proyectos] Error al iniciar ${project.id}:`, err);
        }
      }
    },

    list: () => [...modules],

    get: (id) => modules.find((m) => m.id === id),

    scenarios: () => modules.flatMap((m) => m.scenarios).sort((a, b) => a.order - b.order),

    async runScenario(id) {
      const scenario = registry.scenarios().find((s) => s.id === id);
      if (!scenario) throw new Error(`Escenario desconocido: ${id}`);
      return scenario.run(platform);
    },

    changed(projectId) {
      platform.events.emit({ type: 'project.changed', projectId });
    },
  };

  return registry;
}
