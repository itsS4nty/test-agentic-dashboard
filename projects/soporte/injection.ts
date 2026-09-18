/**
 * Filtro de entrada: heurística determinista de inyección de instrucciones en tickets.
 *
 * Es deliberadamente simple y explicable: una lista de patrones con nombre.
 * Criterio para marcar un ticket: basta un patrón fuerte, o dos patrones cualesquiera.
 * No sustituye a la política (la última palabra la tiene el Policy Gate); es una capa más.
 */

export interface InjectionPattern {
  id: string;
  /** Frase legible para la traza y la consola. */
  label: string;
  /** Un patrón fuerte marca el ticket por sí solo. */
  strong: boolean;
  /** Se evalúa sobre el texto en minúsculas y sin tildes (ver `foldText`). */
  regex: RegExp;
}

export interface InjectionMatch {
  id: string;
  label: string;
  strong: boolean;
  /** Fragmento literal del ticket que ha coincidido. */
  excerpt: string;
}

export interface InjectionReport {
  detected: boolean;
  matches: InjectionMatch[];
  /** Explicación en español de por qué se ha marcado (o no). */
  explanation: string;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: 'ignorar_instrucciones',
    label: 'Pide ignorar u olvidar las instrucciones',
    strong: true,
    regex:
      /\b(?:ignora|ignorad|ignorar|olvida|olvidad|olvidar|descarta|omite|ignore|disregard)\s+(?:[a-z]+\s+){0,3}(?:instrucciones|indicaciones|normas|reglas|politicas|instructions|rules)\b/,
  },
  {
    id: 'dirigido_al_asistente',
    label: 'Se dirige al asistente o se hace pasar por el sistema',
    strong: true,
    regex:
      /\b(?:nota|mensaje|aviso|orden|ordenes|instruccion|instrucciones)\s+(?:para|al|a)\s+(?:el\s+|la\s+)?(?:asistente|agente|ia|bot|sistema|modelo)\b|\[\s*(?:sistema|system|admin)\s*\]|\bmodo\s+(?:administrador|desarrollador|mantenimiento)\b|\ba partir de ahora eres\b/,
  },
  {
    id: 'orden_de_pago',
    label: 'Ordena mover dinero (abono, reembolso o transferencia)',
    strong: false,
    regex:
      /\b(?:emite|emitid|emitir|haz|haced|realiza|realizad|realizar|tramita|tramitad|tramitar|procesa|procesad|procesar|ingresa|ingresad|transfiere|transferid|transferir)\s+(?:[a-z]+\s+){0,2}(?:abono|reembolso|transferencia|devolucion|ingreso)s?\b/,
  },
  {
    id: 'iban',
    label: 'Incluye un número de cuenta bancaria (IBAN)',
    strong: false,
    regex: /\b[a-z]{2}\d{2}(?:[ -]?[a-z0-9]{4}){3,7}(?:[ -]?\d{1,3})?\b/,
  },
  {
    id: 'saltarse_controles',
    label: 'Pide saltarse aprobaciones o no avisar a nadie',
    strong: false,
    regex:
      /\bsin\s+(?:pedir\s+|solicitar\s+|esperar\s+)?(?:aprobacion|autorizacion|confirmacion|permiso|revision)\b|\bno\s+(?:hace\s+falta|es\s+necesario)\s+(?:pedir\s+|solicitar\s+)?(?:aprobacion|autorizacion|confirmacion|permiso)\b|\bya\s+esta\s+(?:autorizad[oa]|validad[oa]|aprobad[oa])\b|\bno\s+(?:lo\s+|se\s+lo\s+)?(?:consultes|escales|avises|comentes)\b/,
  },
  {
    id: 'revelar_configuracion',
    label: 'Pide revelar instrucciones o configuración interna',
    strong: true,
    regex:
      /\b(?:muestra|revela|dime|ensena|copia|repite)\s+(?:[a-z]+\s+){0,2}(?:prompt|instrucciones\s+(?:internas|de\s+sistema|del\s+sistema)|configuracion\s+interna)\b/,
  },
];

/**
 * Minúsculas y sin tildes conservando la longitud, para que los índices de una coincidencia
 * sirvan también sobre el texto original (y así citar el fragmento literal).
 */
export function foldText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const base = ch.normalize('NFD').charAt(0).toLowerCase();
    out += base.length === 1 ? base : ch;
  }
  return out;
}

/** "Incluye un IBAN" → "incluye un IBAN" (sin tocar siglas). */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function detectInjection(text: string): InjectionReport {
  const folded = foldText(text);
  const matches: InjectionMatch[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const found = pattern.regex.exec(folded);
    if (!found) continue;
    matches.push({
      id: pattern.id,
      label: pattern.label,
      strong: pattern.strong,
      excerpt: text.slice(found.index, found.index + found[0].length).trim(),
    });
  }

  const strong = matches.filter((m) => m.strong).length;
  const detected = strong > 0 || matches.length >= 2;
  const criterion = 'Criterio: basta un patrón fuerte o dos cualesquiera.';
  const labels = matches.map((m) => lowerFirst(m.label)).join('; ');

  let explanation: string;
  if (matches.length === 0) {
    explanation = 'Ningún patrón de manipulación en el asunto ni en el cuerpo.';
  } else if (detected) {
    explanation = `${count(matches.length, 'patrón', 'patrones')} (${count(strong, 'fuerte', 'fuertes')}): ${labels}. ${criterion}`;
  } else {
    explanation = `Solo un patrón débil (${labels}); no basta para marcarlo. ${criterion}`;
  }

  return { detected, matches, explanation };
}
