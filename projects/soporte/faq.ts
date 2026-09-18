/**
 * Catálogo de preguntas frecuentes con plantillas ya aprobadas.
 * La coincidencia es literal (sobre texto sin tildes ni puntuación): si la tienda pregunta con
 * una de las formulaciones del catálogo, responde una regla, sin IA.
 */
import { readFileSync } from 'node:fs';
import { foldText } from './injection.ts';

export interface FaqEntry {
  id: string;
  title: string;
  phrasings: string[];
  /** Admite `{nombre}` y `{tienda}`. */
  answer: string;
}

export interface FaqMatch {
  entry: FaqEntry;
  phrasing: string;
}

export const FAQ_ENTRIES: FaqEntry[] = (
  JSON.parse(readFileSync(new URL('./data/faq.json', import.meta.url), 'utf8')) as { faqs: FaqEntry[] }
).faqs;

function normalize(text: string): string {
  return foldText(text).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function matchFaq(subject: string, body: string): FaqMatch | undefined {
  const haystack = ` ${normalize(`${subject}\n${body}`)} `;
  for (const entry of FAQ_ENTRIES) {
    for (const phrasing of entry.phrasings) {
      if (haystack.includes(` ${normalize(phrasing)} `)) return { entry, phrasing };
    }
  }
  return undefined;
}

export function renderFaqAnswer(entry: FaqEntry, vars: { nombre: string; tienda: string }): string {
  return entry.answer.replace(/\{(nombre|tienda)\}/g, (_, key: 'nombre' | 'tienda') => vars[key]);
}
