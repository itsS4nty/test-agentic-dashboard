import type { ProjectModule } from '../platform/contracts.ts';
import { dispositivo } from './dispositivo/index.ts';
import { bugs } from './bugs/index.ts';
import { facturas } from './facturas/index.ts';
import { soporte } from './soporte/index.ts';
import { plataforma } from './plataforma/index.ts';

/** Orden de registro. Añadir un proyecto nuevo es añadirlo aquí. */
export const allProjects: ProjectModule[] = [dispositivo, bugs, facturas, soporte, plataforma];
