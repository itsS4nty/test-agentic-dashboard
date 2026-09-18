/**
 * Construye la aplicación Fastify sobre una plataforma ya creada:
 * API, consola estática con fallback SPA y errores en forma { error }.
 * Separado de index.ts para poder probarlo con `app.inject()` sin abrir puerto.
 */
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformApi } from '../platform/contracts.ts';
import { registerRoutes } from './routes.ts';

export interface BuiltServer {
  app: FastifyInstance;
  /** Carpeta de la consola compilada. */
  consoleDir: string;
  /** false si falta `console/dist/index.html` (no se ha ejecutado `npm run build`). */
  consoleBuilt: boolean;
}

const NO_BUILD_TEXT = [
  'Consola de agentes',
  '',
  'La API está en marcha, pero la consola no está compilada.',
  '',
  '  npm run build    compila la consola y vuelve a arrancar con: npm start',
  '  npm run demo     hace las dos cosas de una vez',
  '',
  'Para desarrollo: npm run dev:console (http://localhost:5173, con proxy a esta API).',
  '',
].join('\n');

export async function buildServer(platform: PlatformApi): Promise<BuiltServer> {
  const app = Fastify({ logger: false });
  const consoleDir = join(platform.rootDir, 'console', 'dist');
  const consoleBuilt = existsSync(join(consoleDir, 'index.html'));

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    let message = error.message || 'Error interno';
    if (error.code?.startsWith('FST_ERR_CTP')) message = `Cuerpo de la petición no válido: ${message}`;
    if (status >= 500) console.error('[servidor] Error no controlado:', error);
    return reply.code(status).send({ error: message });
  });

  registerRoutes(app, platform);

  if (consoleBuilt) {
    await app.register(fastifyStatic, { root: consoleDir, prefix: '/' });
  } else {
    app.get('/', async (_request, reply) => reply.type('text/plain; charset=utf-8').send(NO_BUILD_TEXT));
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (path === '/api' || path.startsWith('/api/')) {
      return reply.code(404).send({ error: `Ruta no encontrada: ${request.method} ${path}` });
    }
    const isPageRequest = request.method === 'GET' || request.method === 'HEAD';
    if (consoleBuilt && isPageRequest && !/\.[a-z0-9]+$/i.test(path)) {
      // Fallback SPA: cualquier ruta sin extensión devuelve la consola.
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    if (!consoleBuilt && isPageRequest) {
      return reply.code(404).type('text/plain; charset=utf-8').send(NO_BUILD_TEXT);
    }
    return reply.code(404).send({ error: `Ruta no encontrada: ${request.method} ${path}` });
  });

  return { app, consoleDir, consoleBuilt };
}
