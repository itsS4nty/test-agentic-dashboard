/**
 * Carga en un proceso aparte el index.ts de un proyecto generado e imprime sus herramientas.
 * Uso: node --import tsx projects/plataforma/load-check.ts <ruta/al/index.ts>
 */
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
const mod = await import(pathToFileURL(file).href);
const project = mod.default ?? Object.values(mod)[0];
if (!project?.id || !Array.isArray(project.tools)) throw new Error('El index.ts no exporta un ProjectModule.');
console.log(
  JSON.stringify({
    id: project.id,
    tools: project.tools.map((t: any) => ({ name: t.name, risk: t.risk, description: t.description, hasHandler: typeof t.handler === 'function', schema: t.inputSchema?.type })),
  }),
);
