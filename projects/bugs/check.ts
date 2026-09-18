/**
 * Comprobación de punta a punta del proyecto de código, en modo simulado y rápido.
 *
 *   npx tsx projects/bugs/check.ts
 *
 * Registra solo `bugs`, lanza `bugs-analizar`, espera a que el agente termine y comprueba
 * el PR con tests en verde y que el agente no fusiona; simula la fusión manual en GitHub con el
 * cierre del sondeo y comprueba la versión 2.14.3.
 * Usa un directorio de datos propio que borra al terminar.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DomainEvent } from '../../platform/contracts.ts';
import { createPlatform } from '../../platform/index.ts';
import { bugs } from './index.ts';
import type { BugsState } from './state.ts';
import { closeMergedPullRequest } from './tools.ts';

// Siempre en modo local: un .env con GITHUB_TOKEN no debe hacer que esta comprobación llame a GitHub.
process.env.DEMO_GITHUB = 'off';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = join(rootDir, 'data', 'check-bugs');

let failures = 0;
function check(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  OK     ${label}`);
  } else {
    failures++;
    console.log(`  FALLO  ${label}${detail === undefined ? '' : `\n         ${JSON.stringify(detail)}`}`);
  }
}

await rm(dataDir, { recursive: true, force: true });
const platform = await createPlatform({ rootDir, dataDir, provider: 'mock', fast: true, inMemory: true });
const domainEvents: DomainEvent[] = [];
platform.events.on((event) => {
  if (event.type === 'domain') domainEvents.push(event.event);
});

try {
  await platform.projects.register(bugs);
  const snapshot = () => bugs.snapshot!(platform) as BugsState & { repoPath: string };

  console.log('\n1. Estado inicial');
  check(snapshot().version === '2.14.2', 'versión inicial 2.14.2', snapshot().version);
  check(platform.manifests.get('bugs')?.maxTurns === 14, 'manifiesto bugs cargado (max_turns 14)');
  const outside = await platform.tools.invoke('bugs_read_file', { path: '../../package.json' }, { caseId: 'none', actor: 'agent' });
  check(!outside.result.ok && outside.result.content.includes('fuera del repositorio'), 'bugs_read_file rechaza rutas fuera del repo', outside.result.content);

  console.log('\n2. Escenario bugs-analizar');
  const { message, caseIds } = await platform.projects.runScenario('bugs-analizar');
  console.log(`  ${message}`);
  const caseId = caseIds?.[0];
  check(caseId, 'el escenario abre un caso de código');
  await platform.runtime.idle();

  const record = platform.cases.get(caseId!);
  const pr = snapshot().prs[0];
  check(record?.status === 'resolved' && record.resolvedBy === 'agent', 'el agente termina al abrir el PR', record?.status);
  check(pr?.status === 'open', 'PR abierto', pr?.status);
  check(pr?.testsBefore.failed === 1 && pr.testsBefore.passed === 5, 'tests antes: 5 pasan, 1 falla', pr?.testsBefore);
  check(pr?.testsAfter.failed === 0 && pr.testsAfter.passed === 6, 'tests después: 6 pasan, 0 fallan', pr?.testsAfter);
  check(pr?.testsBefore.output.includes('Terminal ocupado'), 'el fallo original es "Terminal ocupado"');
  check(pr?.diff.includes('+      this.finish();'), 'el diff añade this.finish() en la rama de timeout', pr?.diff);
  check(snapshot().branches.includes(pr?.branch ?? '-'), 'la rama del PR aparece en el snapshot', snapshot().branches);

  const pending = platform.approvals.list({ caseId: caseId!, status: 'pending' });
  check(pending.length === 0, 'sin aprobaciones: el agente no fusiona', pending.map((a) => a.tool));

  console.log('\n3. Fusión manual en GitHub (simulada con el cierre del sondeo)');
  const closed = await closeMergedPullRequest(platform, pr!.id);
  check(closed.ok, 'cierre tras la fusión manual', closed.content);
  const merged = snapshot().prs[0];
  check(merged.status === 'merged' && merged.mergedAt, 'PR fusionado');
  check(snapshot().version === '2.14.3', 'versión 2.14.3 en el snapshot', snapshot().version);
  const repoDir = join(dataDir, 'repos', 'terminal-pagos');
  const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')) as { version: string };
  check(pkg.version === '2.14.3', 'package.json en main con 2.14.3', pkg.version);
  const log = execFileSync('git', ['log', '--oneline', 'main'], { cwd: repoDir, encoding: 'utf8' });
  check(log.includes('release: terminal-pagos 2.14.3') && log.includes(`Fusiona ${merged.id}`), 'commits de fusión y versión en main', log);
  const fixMerged = domainEvents.find((e) => e.name === 'code.fix_merged');
  check(fixMerged?.payload?.newVersion === '2.14.3' && fixMerged.payload.prId === merged.id, 'emitido code.fix_merged con 2.14.3', fixMerged?.payload);
  const mainTests = await platform.tools.invoke('bugs_run_tests', {}, { caseId: caseId!, actor: 'human', skipPolicy: true });
  const mainData = mainTests.result.data as { passed: number; failed: number };
  check(mainData.failed === 0 && mainData.passed === 6, 'tests en main tras fusionar: 6 pasan', mainData);

  console.log('\n4. Segunda sospecha con el arreglo ya en main');
  const second = await platform.projects.runScenario('bugs-analizar');
  await platform.runtime.idle();
  const secondCase = platform.cases.get(second.caseIds?.[0] ?? '');
  check(secondCase?.status === 'resolved' && secondCase.resolvedBy === 'agent', 'el agente lo cierra sin cambios', secondCase?.status);
  check(secondCase?.summary?.includes('no parece nuestro código'), 'concluye que no es un bug del código actual', secondCase?.summary);
  check(snapshot().prs.length === 1, 'no se abre un segundo PR', snapshot().prs.length);

  console.log('\n5. Reinicio');
  await platform.reset();
  check(snapshot().version === '2.14.2' && snapshot().prs.length === 0, 'reset vuelve a 2.14.2 sin PRs', snapshot());

  const summary = record?.summary ?? '';
  console.log(`\nResumen final del agente (primer caso):\n${summary.replace(/^/gm, '  ')}`);
} catch (error) {
  failures++;
  console.error('\nError inesperado:', error);
} finally {
  await platform.shutdown();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nTodo correcto.' : `\n${failures} comprobaciones fallidas.`);
process.exit(failures === 0 ? 0 : 1);
