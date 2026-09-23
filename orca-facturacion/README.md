# Tres agentes de facturación con Orca

Demo pequeña, sin plataforma propia: tres agentes de IA que se pasan el trabajo entre ellos dentro
de [Orca](https://www.onorca.dev), con una persona decidiendo en medio.

```
Detector  ──avisa──▶  Analista  ──avisa──▶  Redactor
   │                      │                    │
 reglas                criterio            avisos al cliente
   │                      │                    │
   └──────── una persona aprueba antes de redactar ────────┘
```

- **Detector.** Aplica las comprobaciones deterministas (precio de contrato, IVA, duplicados,
  descuadres, servicios sin facturar). Coste bajo y resultado siempre igual. Lo que no cubre ninguna
  regla lo deja marcado como dudoso.
- **Analista.** Confirma o descarta cada hallazgo citando el contrato, resuelve las dudosas y aplica
  la regla de negocio: una factura ya emitida no se corrige sola, se propone rectificativa.
- **Redactor.** Escribe un aviso por cliente, pero solo después de que una persona apruebe.

Los datos son los de la demo anterior: 30 facturas de septiembre de 2026 de tres clientes, con
errores sembrados a propósito, y sus contratos y catálogo.

## Cómo se lanza

Hace falta Orca (`brew install --cask stablyai/orca/orca`) y Codex con sesión iniciada
(`npm install -g @openai/codex` y `codex login`).

```bash
./orca-facturacion/lanzar.sh
```

Usa la orquestación de Orca: crea una ejecución, tres tareas encadenadas por dependencias y una
**puerta de decisión** que bloquea al Redactor. Cuando el Analista termina, el guion muestra su
dictamen y pregunta si se redactan los avisos (`aprobar`, `solo borradores`, `cancelar`), resuelve la
puerta y arranca al Redactor. Para probarlo sin nadie delante, `RESPUESTA_AUTO="aprobar"`.

Cada agente aparece en Orca como trabajador supervisado y avisa al terminar. Tarda unos diez minutos.

**Un ajuste obligatorio:** en Orca, Ajustes → Agentes, Codex tiene que llevar
`--dangerously-bypass-approvals-and-sandbox`. Dentro de su cajón de arena, Codex no alcanza a Orca
(comprobado: `runtimeReachable: false`) y no puede avisar de que ha terminado. Es la razón por la que
Orca trae ese modo activado de fábrica. Asúmelo solo en una máquina dedicada y con accesos acotados.

**Respaldo con Claude:** `./orca-facturacion/lanzar-claude.sh`. Con Claude, el lanzador supervisado de
Orca no arranca (ver abajo), así que ese guion coordina por fuera y la aprobación va por fichero.

## Qué queda en `salida/`

| Fichero | Quién lo escribe |
|---|---|
| `1-hallazgos.json` y `.md` | Detector |
| `2-dictamen.json` y `.md` | Analista |
| `buzon/aprobacion.txt` | La persona, desde el coordinador |
| `3-avisos/<cliente>.md` y `3-resumen-interno.md` | Redactor |

En el repositorio están los de una ejecución real del 23/09/2026, como ejemplo.

## Qué hace Orca aquí y qué no

**Lo que aporta:** cada agente en su pestaña, visibles a la vez; tareas con dependencias, puertas de
decisión para las aprobaciones y mensajería entre agentes; y una línea de comandos con la que se
gobierna todo. Con la suscripción que ya tengas (Codex o Claude), sin pagar tokens aparte.

**Lo que no funcionó** (Orca 1.4.209 con Claude Code 2.1.177, 23/09/2026):

- `orca orchestration worker-start`, su lanzador supervisado, falla siempre en la comprobación de
  que el agente está listo: el agente arranca bien, pero Orca no lo detecta y da tiempo de espera
  agotado. Por eso aquí las pestañas se crean con `terminal create` y el trabajo se manda con
  `terminal send`.
  **Es un fallo suyo con Claude, no del modelo**: Orca espera a que la pantalla del agente quede
  quieta (`tui-idle`) y con Claude recién arrancado eso no llega nunca (comprobado: con Claude ya
  arrancado, la misma espera se cumple en 2 segundos). En su repositorio está abierto como
  [#22040](https://github.com/stablyai/orca/issues/22040), con la comparación hecha: la misma tarea
  con `--agent codex` arranca en medio minuto y con `--agent claude` se queda siete minutos sin
  hacer nada. Codex, Cursor y Copilot están pre-confiados en su código; Claude no
  ([#21867](https://github.com/stablyai/orca/issues/21867)). Con Codex es previsible que sí funcione,
  y entonces se podrían usar sus tareas supervisadas y sus puertas de decisión.
- `orca orchestration ask` (pregunta bloqueante) exige una tarea supervisada, así que tampoco sirve.
  La aprobación va por fichero, que además se lee mejor en la demo.
- Las respuestas a una pregunta no vuelven a la bandeja del agente que la hizo.
- Al instalar, Orca deja marcado «Yolo / Dangerously skip permissions», que lanza los agentes sin
  pedir permiso para nada. Conviene desmarcarlo; los permisos de esta demo están acotados en
  `.claude/settings.local.json`.

**Con Codex sí funciona** (probado el 23/09/2026 con Codex CLI 0.156.1): `worker-start` arranca el
agente (`ready` / `input_accepted`), le entrega la tarea y recibe su `worker_done`. Por eso la demo
principal va con Codex y usa tareas encadenadas y puertas de decisión de verdad.

En resumen: con Codex, Orca sirve como orquestador pequeño, siempre que aceptes que sus agentes
corran sin cajón de arena. Con Claude, hoy solo sirve como sitio donde ver y manejar los agentes, y
la coordinación la pone el guion de respaldo.
