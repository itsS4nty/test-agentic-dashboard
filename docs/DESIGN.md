# Consola — sistema visual monocromo

Referencia: consolas técnicas del estilo de Vercel. **Profesional, minimalista e intuitiva.**
Sustituye por completo a las dos direcciones anteriores (la petróleo/teal original y «Obrador»).
No debe quedar rastro de ninguna: ni tickets, sellos, mandos, visores, azulejo, ni teal, pills o
etiquetas mono en mayúsculas.

## 1. Principios

1. **Monocromo.** Blanco, negro y grises. El color solo aparece para comunicar estado:
   verde = correcto/resuelto, ámbar = requiere a una persona/en espera, rojo = error, bloqueo o
   escalado. Ningún color decorativo, ningún acento de marca.
2. **Patrones que ya conoce cualquiera.** Cabecera con pestañas, tablas, lista + panel de
   detalle, control segmentado, botón primario y secundario. Nada que haya que aprender.
3. **Poco texto.** Un título por página y como mucho una línea de descripción. Las explicaciones
   largas desaparecen; si algo necesita aclaración, `title` o una línea gris bajo el dato.
4. **Jerarquía con tipografía, espacio y bordes de 1px.** Sin sombras, salvo capas flotantes.
5. **Claro y oscuro según el sistema**, con el mismo cuidado en los dos (incluidos
   `data-theme="light"` / `data-theme="dark"` si se fuerzan).
6. **Cifras con `tabular-nums`.** IDs, nombres técnicos (`dispositivo_restart_device`), ramas, código y
   JSON en mono. Importes con formato español (`0,20 US$`, `39,60 €`).

## 2. Tokens (`console/src/styles.css`)

Los componentes usan solo `var(--…)`. Nunca colores literales.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | #ffffff | #0a0a0a | fondo de página y tarjetas |
| `--bg-subtle` | #fafafa | #111111 | cabeceras de tabla, zonas secundarias |
| `--bg-muted` | #f2f2f2 | #1a1a1a | pista de controles segmentados, código |
| `--bg-hover` | #f5f5f5 | #1f1f1f | hover de filas y botones secundarios |
| `--border` | #ebebeb | #262626 | bordes de 1px |
| `--border-strong` | #d4d4d4 | #3a3a3a | bordes de inputs, separadores fuertes |
| `--fg` | #0a0a0a | #ededed | texto principal |
| `--fg-muted` | #5c5c5c | #a1a1a1 | texto secundario |
| `--fg-subtle` | #737373 | #8a8a8a | metadatos, marcas de tiempo |
| `--primary` / `--primary-fg` | #0a0a0a / #ffffff | #ededed / #0a0a0a | botón primario, badge invertido |
| `--success` / `--success-bg` | #15803d / #f0fdf4 | #4ade80 / rgb(34 197 94 / .12) | estado correcto |
| `--warning` / `--warning-bg` | #b45309 / #fffbeb | #fbbf24 / rgb(245 158 11 / .12) | requiere persona |
| `--danger` / `--danger-bg` | #b91c1c / #fef2f2 | #f87171 / rgb(239 68 68 / .12) | error, bloqueo |
| `--focus` | #0a0a0a | #ededed | anillo de foco |

Tipografía: `--font-sans` **Geist**, `--font-mono` **Geist Mono**, servidas en local.
Escala: `--text-xs` 12 · `--text-sm` 13 · `--text-base` 14 · `--text-md` 16 · `--text-lg` 20 ·
`--text-xl` 24 · `--text-2xl` 32. Títulos en 600 con `letter-spacing: -0.02em` desde 20px.
Forma: `--radius-sm` 4px (badges) · `--radius` 6px (botones, inputs) · `--radius-lg` 8px
(tarjetas, tablas). `--shadow-overlay` solo para paneles flotantes.

## 3. Estados: correspondencia fija

| Concepto | Presentación |
|---|---|
| Caso `resolved` | `StatusDot` success · "Resuelto" |
| Caso `open` / `running` | `StatusDot` neutral · "Abierto" / `pending` (pulso) · "En curso" |
| Caso `waiting_approval` | `StatusDot` warning · "Pendiente de aprobación" |
| Caso `escalated` / `failed` | `StatusDot` danger · "Escalado" / "Fallido" |
| Dispositivo `ok` · `restarting` · `paper_out` · `locked` · `offline` | success · pending · warning · danger · danger |
| Decisión `deny` / `escalate` | `Badge` danger |
| Decisión `approve` | `Badge` warning |
| Decisión `auto` / `notify` / `shadow` | `Badge` neutral |
| Actor `rule` · `agent` · `human` | `Badge` neutral "Regla" · `Badge` inverted "IA" · `Badge` outline "Persona" |
| Riesgo | texto `--fg-muted`; `financial`, `physical`, `code` como `Badge` outline |
| Nivel del dial | `SegmentedControl` sin color: *Solo observa · Pide permiso · Hace y avisa · Hace sola* |

## 4. Componentes base (`console/src/ui/`)

Todos con `<script setup lang="ts">`, props tipadas, `<style scoped>` con tokens, exportados desde
`console/src/ui/index.ts`.

- **`Button`** — `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` (secondary por defecto),
  `size: 'sm' | 'md'`, `loading`, `disabled`, `as: 'button' | 'a'`, `href`. Altura 32px (md) / 28px (sm).
  Primary: fondo `--primary`. Secondary: `--bg` con borde. Danger: texto `--danger`, borde.
- **`Badge`** — `variant: 'neutral' | 'inverted' | 'outline' | 'success' | 'warning' | 'danger'`.
  12px, 500, `--radius-sm`, alto 20px, sin punto.
- **`StatusDot`** — `status: 'success' | 'warning' | 'danger' | 'neutral' | 'pending'`, `label?`.
  Punto de 8px + texto; `pending` con pulso suave (sin pulso con reduced motion).
- **`Card`** — `title?`, `description?`, slot `actions`, slot default, `padded` (true).
  Borde 1px `--border`, `--radius-lg`, fondo `--bg`. Cabecera con título 14px 600.
- **`StatGrid` + `Stat`** — rejilla de celdas separadas por bordes de 1px dentro de un mismo marco
  (como las métricas de uso de Vercel). `Stat`: `label`, `value`, `hint?`, `tone?: 'default' |
  'success' | 'warning' | 'danger'` (colorea solo el valor cuando hay alerta).
- **`PageHeader`** — `title`, `description?`, slot `actions`. Título 24px 600.
- **`Tabs`** — `items: { id; label; count? }[]`, `modelValue`, `hrefFor?`. Subrayado de 2px `--fg`
  en la activa; inactivas `--fg-muted`; `count` como número pequeño gris.
- **`SegmentedControl`** — `options: { value; label }[]`, `modelValue`, `size`, `disabled`,
  `ariaLabel`. Pista `--bg-muted`, opción activa `--bg` con borde. `role="radiogroup"` y flechas.
- **`CodeBlock`** — `code`, `wrap?`, `maxHeight?`; botón "Copiar" discreto.
- **`EmptyState`** — `title`, `description?`, slot `action`. Centrado, sin iconos.
- **`Timeline` + `TimelineItem`** — lista vertical con línea de 1px; `TimelineItem`: `status`
  (color del marcador), `title`, `time?`, slots `meta` y default (detalle).
- **`KeyValue`** — `items: { label; value }[]` o slots; filas con etiqueta `--fg-muted`.
- **`RelativeTime`** — "hace 12 s", con la fecha completa en `title`.
- **`ThemeSwitcher`** — Sistema · Claro · Oscuro con iconos de 16px dibujados a mano (monitor, sol,
  luna; trazo `currentColor`). Por defecto, segmentado de iconos con el aspecto de `SegmentedControl`
  sm (`role="radiogroup"`, flechas, Inicio y Fin); `labels` añade el texto; `compact` es un solo botón
  de 28px que pasa al siguiente tema. El estado vive en `ui/theme.ts` (`useTheme()`, clave
  `consola.tema` en `localStorage`; `system` quita `data-theme`). `index.html` aplica el tema guardado
  antes del primer pintado.
- Clases globales en `styles.css`: `table.table` (cabecera `--bg-subtle`, filas con borde,
  hover), `.mono`, `.num`, `.muted`, `.subtle`, inputs/select nativos con estilo coherente,
  `pre.diff` con `.diff-add` / `.diff-del` / `.diff-hunk` (fondos `--success-bg` / `--danger-bg`).

## 5. Estructura (`App.vue`)

- **Cabecera fija de 56px**, borde inferior:
  - Izquierda: marca sobria — un cuadrado de 18px relleno de `--fg` y el texto
    **Consola de agentes** en 14px 600; a continuación `/` gris y **Demo** en `--fg-muted`.
  - Derecha: `StatusDot` "En vivo" / "Sin conexión"; `Badge` del modo de IA ("Simulado" neutral,
    proveedor real outline con el modelo); `ThemeSwitcher` solo con iconos (`compact` por debajo de
    768px, donde "En vivo" queda solo como punto; oculto a 370px o menos); `Button` secondary **Director de demo**; `Button`
    secondary **Reiniciar demo** que al pulsar pasa a danger **Confirmar reinicio** durante 4 s.
- **Pestañas** bajo la cabecera, también fijas: Resumen · Dispositivos · Código · Facturas · Soporte ·
  Casos · Aprobaciones (con contador) · El dial · Agentes. Navegación por hash como ahora
  (incluido `#casos/<id>` y el evento global `open-case`).
- **Contenido**: `max-width: 1200px`, centrado, padding 32px (16px en móvil), espacio vertical
  generoso entre bloques (24–32px).
- **Director de demo**: panel acoplado a la derecha de 360px, bajo la cabecera, borde izquierdo,
  con scroll propio. Cabecera "Director de demo" + botón ghost **Plegar**. Escenarios agrupados
  por proyecto (rótulo 12px `--fg-muted`); cada uno: número en mono gris, título 14px 500,
  descripción en `--fg-muted` recortada a 2 líneas (completa en `title`), `Button` sm secondary
  **Lanzar** (loading mientras corre). El resultado aparece debajo del escenario en una línea con
  `StatusDot` y enlaces **Ver caso**. Por debajo de 1200px es un panel flotante sobre el
  contenido con `--shadow-overlay`. Abierto por defecto a partir de 1280px.
- Ruta oculta `#muestrario` con todos los componentes de `ui/` en sus variantes, para revisión.

## 6. Vistas

Todas conservan su funcionalidad, datos, enlaces y los textos que cita `DEMO.md`: nombres de
pestañas, títulos de escenarios, **Lanzar**, **Ver caso**, **Aprobar**, **Rechazar**, **Plegar**,
**Director de demo**, **Reiniciar demo**, **Confirmar reinicio**, **Volver a la configuración** y
los cuatro niveles.

- **Resumen** — `PageHeader` sin descripción larga. `StatGrid` de 6: Casos · Sin intervención
  humana · Aprobaciones pendientes · Coste de IA · Acciones de reglas / llamadas a IA · Bloqueos por
  política. Debajo, dos columnas: **Actividad** (tarjeta con lista en vivo: hora mono, `Badge` de
  actor, texto, caso en `--fg-muted`, importe a la derecha si es IA; filtros con
  `SegmentedControl`: Todo · Reglas · IA · Personas · Bloqueos) y lateral con **En ejecución**
  (agentes corriendo, "N de 3") y **Por proyecto** (tabla compacta: proyecto, casos, resueltos,
  coste).
- **Casos** — lista izquierda (320px) con buscador, filtro por estado (`SegmentedControl` o
  select) y filas: título, ámbito en gris, `StatusDot`, importe. Detalle derecho: título,
  `StatusDot` de estado, fila de metadatos (proyecto, agente, ámbito, creado); `StatGrid`
  pequeño Reglas · IA · Total; **Traza** como `Timeline` (llm: modelo, tokens, coste, latencia en
  `meta`; policy: `Badge` de decisión y motivo; tool: extracto); aprobaciones del caso.
- **Aprobaciones** — `StatGrid` pequeño: Aprobadas · Rechazadas · Tasa. **Pendientes** como
  tarjetas limpias: resumen en 14px 600, `KeyValue` (Acción en mono, Ámbito, Propone con `Badge`,
  Riesgo), motivo en `--fg-muted`, entrada JSON plegable con `CodeBlock`, comentario opcional,
  `Button` primary **Aprobar** y secondary **Rechazar**; tras decidir, estado con `StatusDot`
  ("Aprobada y ejecutada" / "Rechazada" / "Falló"). **Historial** como `table.table`.
- **El dial** — una línea de descripción: el nivel es un techo; las condiciones solo lo bajan o
  bloquean. Por proyecto, `Card` con `table.table`: Acción (nombre legible + id mono gris), Riesgo,
  **Nivel** (`SegmentedControl` con los cuatro niveles), Condiciones (líneas "Si … → Bloquea" en
  `--fg-muted` con `Badge` de decisión) y Excepciones (`Badge` outline "Pan de Pueblo · Pide
  permiso"). Interruptor para mostrar también las acciones de solo lectura. Tarjeta
  **Excepciones por cliente** con tabla y formulario de alta (selects) y baja. `Button` secondary
  **Volver a la configuración**. Confirmación "Aplicado" discreta junto al control.
- **Agentes** — rejilla de `Card`: nombre, descripción corta, `KeyValue` (Proyecto, Modelo,
  Esfuerzo, Turnos máx., Presupuesto), herramientas como lista mono con su nivel en `Badge`, y el
  manifiesto YAML plegable en `CodeBlock`. Una línea arriba: "Cada agente es un fichero YAML."
- **Dispositivos** — `StatGrid`: Tiendas · Con incidencia · Reiniciando · Cobros en curso · Datáfonos en
  2.14.2 · en 2.14.3. Por cliente, `Card` con `table.table`: Tienda (nombre + ciudad), Horario,
  Datáfono / Impresora / Router (cada celda: `StatusDot` + versión mono), Reinicios (última hora),
  enlace al caso abierto. Lateral o debajo: **Avisos a tienda** y **Visitas de técnico** como
  listas simples. El aviso de "dispositivos operativos" solo cuando es verdad (lógica `allQuiet` actual).
- **Código** — cabecera con el componente y `Badge` de versión (mono). Lista de PRs (tabla o
  filas) y detalle: título, `StatusDot` (Pendiente de aprobación / Fusionado), rama mono, caso,
  descripción, **Tests** como dos cifras "Antes 5 ✓ 1 ✗ → Después 6 ✓ 0 ✗", y **Diff** en
  `pre.diff` con números de línea opcionales. Junto a la versión, `Badge` "Repositorio local" o, con
  GitHub conectado, `Badge` outline "GitHub · owner/nombre" enlazado; si GitHub está configurado pero
  no se puede usar, el aviso en una línea con `StatusDot` warning. Con GitHub, cada PR enlaza **Ver en
  GitHub ↗**. La demo no añade CI al repositorio: sin ella (`ci: 'none'`) no se muestra ninguna fila de
  CI ni nada en rojo por ahí, y los tests visibles son los del agente. Si el repositorio tuviera CI, se
  muestra con `StatusDot`: En curso · Tests en verde · Tests en rojo. Un PR cerrado sin fusionar queda
  como "Cerrado" (neutral).
- **Facturas** — `StatGrid`: Facturas revisadas · Hallazgos por reglas (coste 0,00 US$) ·
  Hallazgos por IA (coste x US$) · Impacto detectado. **Hallazgos** en `table.table`: Factura
  (mono), Capa (`Badge` "Regla" neutral / "IA" inverted), Hallazgo, Impacto (derecha), Estado,
  Caso. **Facturas** en `table.table` con estado Borrador/Emitida como `Badge`.
- **Soporte** — si hay inyección, un aviso discreto en `--danger-bg` con borde `--danger` y botón
  "Ver ticket". Bandeja como lista tipo correo (remitente, asunto, tienda, categoría/prioridad en
  `Badge`, estado con `StatusDot`, hora) y panel de detalle con cuerpo, borrador o respuesta
  enviada y, en el ticket sospechoso, `Badge` danger "Inyección detectada" y la acción bloqueada.

## 7. Prohibido

- Color que no sea de estado; gradientes; sombras en tarjetas; emoji; ilustraciones; iconos de
  librerías; metáforas visuales (tickets, sellos, mandos, visores, azulejo).
- Eyebrows en mono y mayúsculas espaciadas; pills de colores para todo; teal/petróleo;
  crema/terracota.
- Párrafos explicativos en la interfaz.
- Logos, nombres o marcas de terceros en la interfaz.
- Tocar `api.ts`, `live.ts` o el backend; renombrar los textos del guion (§ 6).
