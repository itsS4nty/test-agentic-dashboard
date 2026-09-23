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

Hace falta Orca instalado (`brew install --cask stablyai/orca/orca`) y Claude Code con sesión
iniciada.

```bash
./orca-facturacion/lanzar.sh
```

Abre cuatro pestañas en Orca —el coordinador y un agente por paso— y va contando lo que pasa. Cuando
el Analista termina, muestra su dictamen y pregunta en la terminal si se redactan los avisos:
`aprobar`, `solo borradores` o `cancelar`. Para probarlo sin nadie delante, `RESPUESTA_AUTO="aprobar"`.

Tarda unos diez minutos con Claude real y cuesta unos pocos céntimos por agente.

## Qué queda en `salida/`

| Fichero | Quién lo escribe |
|---|---|
| `1-hallazgos.json` y `.md` | Detector |
| `2-dictamen.json` y `.md` | Analista |
| `buzon/aprobacion.txt` | La persona, desde el coordinador |
| `3-avisos/<cliente>.md` y `3-resumen-interno.md` | Redactor |

En el repositorio están los de una ejecución real del 23/09/2026, como ejemplo.

## Qué hace Orca aquí y qué no

**Lo que aporta:** cada agente en su pestaña, visibles a la vez; una línea de comandos para crearlas
y gobernarlas; y una mensajería entre agentes (`orca orchestration send` / `check`) por la que se
avisan de verdad. Todo con la suscripción de Claude que ya tienes, sin pagar por tokens aparte.

**Lo que no funcionó** (Orca 1.4.209 con Claude Code 2.1.177, 23/09/2026):

- `orca orchestration worker-start`, su lanzador supervisado, falla siempre en la comprobación de
  que el agente está listo: el agente arranca bien, pero Orca no lo detecta y da tiempo de espera
  agotado. Por eso aquí las pestañas se crean con `terminal create` y el trabajo se manda con
  `terminal send`.
- `orca orchestration ask` (pregunta bloqueante) exige una tarea supervisada, así que tampoco sirve.
  La aprobación va por fichero, que además se lee mejor en la demo.
- Las respuestas a una pregunta no vuelven a la bandeja del agente que la hizo.
- Al instalar, Orca deja marcado «Yolo / Dangerously skip permissions», que lanza los agentes sin
  pedir permiso para nada. Conviene desmarcarlo; los permisos de esta demo están acotados en
  `.claude/settings.local.json`.

En resumen: Orca vale hoy como sitio donde ver y manejar varios agentes; la coordinación fiable la
pone el guion (`lanzar.sh`), que son cincuenta líneas de shell.
