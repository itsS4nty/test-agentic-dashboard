/**
 * Punto de entrada: `npm start` (tsx server/index.ts).
 * Crea la plataforma, registra los proyectos, arranca Fastify y cierra limpio con Ctrl+C.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformApi } from '../platform/contracts.ts';
import { createPlatform } from '../platform/index.ts';
import { allProjects } from '../projects/index.ts';
import { buildServer } from './app.ts';

const DEFAULT_PORT = 4000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readPort(): number {
  const port = Number(process.env.PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

async function main(): Promise<void> {
  let platform: PlatformApi | undefined;
  try {
    platform = await createPlatform({ rootDir, dataDir: process.env.DATA_DIR || undefined });
    for (const project of allProjects) await platform.projects.register(project);

    const { app, consoleBuilt } = await buildServer(platform);
    // PORT y HOST se leen después de createPlatform, que es quien carga el .env.
    const port = readPort();
    const host = process.env.HOST || 'localhost';
    await app.listen({ port, host });

    const url = `http://localhost:${port}`;
    const { llm } = platform;
    console.log('');
    console.log(`  Consola de agentes en ${url}`);
    console.log(`  Proveedor de IA: ${llm.label} (${llm.provider})`);
    console.log(`  Modelos: reasoning → ${llm.modelFor('reasoning')} · fast → ${llm.modelFor('fast')}`);
    console.log(`  Proyectos: ${platform.projects.list().map((p) => p.id).join(', ') || 'ninguno'}`);
    if (!consoleBuilt) {
      console.log('  Aviso: la consola no está compilada. Ejecuta `npm run build` (o `npm run demo`).');
    }
    console.log('  Ctrl+C para parar.');
    console.log('');

    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) {
        console.log('  Cierre forzado.');
        process.exit(1);
      }
      closing = true;
      console.log(`\n  ${signal} recibido: cerrando servidor y guardando estado…`);
      const timer = setTimeout(() => {
        console.error('  El cierre tarda demasiado; salgo sin esperar.');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref();
      try {
        await app.close();
        await platform?.shutdown();
        process.exit(0);
      } catch (error) {
        console.error('  Error al cerrar:', error);
        process.exit(1);
      }
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  El puerto ${readPort()} está ocupado. Prueba con otro: PORT=${readPort() + 1} npm start\n`);
    } else {
      console.error('\n  No se pudo arrancar la demo:', err.message ?? err, '\n');
      if (err.stack) console.error(err.stack);
    }
    await platform?.shutdown().catch(() => {});
    process.exit(1);
  }
}

await main();
