/**
 * Secretos del proyecto de código (el token de GitHub) y limpieza de textos.
 *
 * El token solo vive en `process.env` y en memoria. Todo texto que salga de git, de los tests o de
 * la API de GitHub hacia trazas, notificaciones, snapshots o el modelo pasa antes por `redact`, y
 * los procesos hijos (git, tests) reciben un entorno sin variables con secretos.
 */
import { Buffer } from 'node:buffer';

const HIDDEN = '[oculto]';
const secrets = new Set<string>();

/** Registra un secreto para ocultarlo, junto con sus formas codificadas habituales. */
export function registerSecret(value: string | undefined): void {
  const secret = value?.trim();
  if (!secret || secret.length < 6) return;
  secrets.add(secret);
  secrets.add(encodeURIComponent(secret));
  secrets.add(Buffer.from(`x-access-token:${secret}`).toString('base64'));
  secrets.add(Buffer.from(secret).toString('base64'));
}

/** Oculta los secretos registrados, cabeceras de autorización y tokens con forma de GitHub. */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  // Los más largos primero, para no dejar restos de una forma codificada.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join(HIDDEN);
  return out
    .replace(/(authorization:\s*(?:basic|bearer|token)\s+)[^\s'"]+/gi, `$1${HIDDEN}`)
    .replace(/(extraheader\s*[=:]\s*)[^\n]*/gi, `$1${HIDDEN}`)
    .replace(/(GIT_CONFIG_VALUE_\d+\s*[=:]\s*)[^\n]*/g, `$1${HIDDEN}`)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, HIDDEN);
}

const SECRET_ENV_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL/i;

/**
 * Copia del entorno sin variables con secretos, para los procesos hijos (git y tests). El código que
 * ejecutan los tests lo escribe un agente: no debe poder leer ni el token de GitHub ni otras claves.
 */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (SECRET_ENV_NAME.test(name)) continue;
    if (value !== undefined && [...secrets].some((secret) => value.includes(secret))) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}
