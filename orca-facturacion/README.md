# Agentes de revisión de facturas

Cuatro agentes que se reparten la revisión de las facturas del mes, con una persona decidiendo antes
de escribir a ningún cliente. No hay programa que mantener: **cada agente es un fichero de texto**.

```
Coordinador
    │
    ├──▶ Detector ──▶ Analista ──▶ [ una persona aprueba ] ──▶ Redactor
         reglas       criterio                                 avisos
```

- **Detector.** Aplica las comprobaciones deterministas: precio de contrato, IVA, líneas duplicadas,
  totales descuadrados y servicios activos sin facturar. Barato y siempre igual. Lo que no cubre
  ninguna regla lo deja marcado como dudoso.
- **Analista.** Confirma o descarta cada hallazgo citando el contrato, resuelve las dudosas y aplica
  la regla de negocio: una factura ya emitida no se corrige sola, se propone rectificativa.
- **Redactor.** Escribe un aviso por cliente, y solo después de que una persona apruebe.
- **Coordinador.** Reparte el trabajo, espera a cada uno, pregunta a la persona y cierra. Es lo que
  evita tener que escribir un programa: la coordinación también son instrucciones.

Se apoya en [Orca](https://www.onorca.dev), que es donde viven los agentes, y en Codex, que es quien
razona. Con la suscripción que ya tengas, sin pagar tokens aparte.

## Qué hay en esta carpeta

| Carpeta | Qué es |
|---|---|
| `agentes/` | Los cuatro agentes, en texto plano. Es lo que de verdad importa. |
| `reglas/` | Las comprobaciones de facturación, también en texto. |
| `db/` | La base de datos de ejemplo: `docker compose up -d` y dentro están el esquema, los datos y el usuario de solo lectura. |
| `db/sqlserver/` | Lo que hay que configurar para leer de un SQL Server: vistas o lectura directa de vuestras tablas, usuario de solo lectura y conector, con su propio README. |
| `datos/` | Los mismos datos en JSON, por si no quieres levantar la base de datos. |
| `salida/` | Donde escriben los agentes al ejecutarse. |
| `ejemplo-de-ejecucion/` | El resultado de una ejecución real, para verlo sin lanzar nada. |
| `preparar-maquina.sh` | Deja la máquina lista y te dice qué falta. Opcional. |
| `lanzar.sh` | Para ejecutarlo sin nadie delante. Opcional. |

## Ponerlo en marcha en una máquina nueva

```bash
./preparar-maquina.sh
```

Instala lo que falte (Node, Orca, Codex), registra esta carpeta en Orca y te dice lo que tienes que
hacer tú. A mano son estos siete pasos:

| Paso | Cómo | ¿Persona? |
|---|---|---|
| 1. Node 22 o superior | `brew install node` | No |
| 2. Orca | `brew install --cask stablyai/orca/orca` | No |
| 3. Abrir Orca la primera vez | Elegir Codex como agente por defecto | Sí, dos clics |
| 4. Codex | `npm install -g @openai/codex` | No |
| 5. Iniciar sesión | `codex login`, se abre el navegador | Sí, es su cuenta |
| 6. Argumento de Codex en Orca | Ajustes → Agentes → Codex: `--dangerously-bypass-approvals-and-sandbox` | Sí, un clic |
| 7. Registrar esta carpeta | `orca repo add --path <ruta de esta carpeta>` | No |
| 8. Base de datos | `cd db && docker compose up -d` | No |
| 9. Conector de la base de datos | El bloque `[mcp_servers.facturacion]` en `~/.codex/config.toml` | No |

Sobre el paso 6: dentro de su cajón de arena, Codex no alcanza a Orca (comprobado:
`runtimeReachable: false`) y no puede avisar de que ha terminado. Es la razón por la que Orca trae
ese modo activado de fábrica. Asúmelo solo en una máquina dedicada y con accesos acotados.

Un detalle que despista la primera vez: **Codex y Claude enseñan pantallas de bienvenida** que dejan
la pestaña esperando sin que se note. Se contestan una vez por máquina y ya no vuelven.

## La base de datos

Los agentes leen de un Postgres, como leerán del SQL de vuestro server:

```bash
cd db && docker compose up -d
```

Levanta un Postgres 17 en el puerto 5434 y carga solo con arrancar: el esquema
(`db/init/01-esquema.sql`), los datos de septiembre (`02-datos.sql`) y un usuario `agente` que
**solo puede hacer SELECT** (`03-usuario-lectura.sql`). Son nueve tablas: facturas y sus líneas,
contratos con sus tarifas pactadas y servicios activos por tienda, catálogo con el IVA de cada
categoría, y clientes y tiendas.

El agente llega ahí con un conector MCP, [DBHub](https://github.com/bytebase/dbhub), que además se
declara de solo lectura. Dos candados: aunque alguien cambie las instrucciones del agente, sigue sin
poder escribir. Para registrarlo en Codex, añade esto a `~/.codex/config.toml` con la ruta de tu
carpeta:

```toml
[mcp_servers.facturacion]
command = "npx"
args = ["-y", "@bytebase/dbhub@latest", "--config", "<ruta>/db/dbhub.toml"]
startup_timeout_sec = 60
tool_timeout_sec = 120
```

Compruébalo con `codex mcp list`. Para Claude Code ya está el `.mcp.json` de la carpeta, que apunta
al mismo fichero de conexión.

Si no levantas la base de datos, los agentes se apañan con los JSON de `datos/`: lo dicen en su
informe y siguen. Así la demo nunca se queda tirada.

## Ejecutarlo

En Orca, abre una pestaña de agente con Codex y pégale el contenido de `agentes/00-coordinador.md`.
Ya está. Él monta la ejecución, encadena las tres tareas, pone la puerta de decisión, lanza a cada
agente cuando toca, te pregunta antes de redactar y cierra. Tú contestas `aprobar`,
`solo borradores` o `cancelar`.

Desde la terminal, si prefieres no tocar la ventana:

```bash
codex "$(cat agentes/00-coordinador.md)"
```

Tarda unos diez minutos. Al terminar, en `salida/` quedan los hallazgos, el dictamen, los avisos por
cliente y un resumen interno.

### Sin nadie delante

- `./lanzar.sh` hace de coordinador desde la terminal, con la misma orquestación. Con
  `RESPUESTA_AUTO="aprobar"` se ejecuta entera sola.

Si va a correr solo cada mañana, mejor que los agentes solo lean e informen: sin nadie que apruebe,
la puerta de decisión sobra y las escrituras deberían esperar a que alguien las mire.

## Usarlo con datos reales

Hoy los agentes leen del Postgres de `db/`. Para leer de vuestro SQL Server está todo preparado en
**[`db/sqlserver/`](db/sqlserver/README.md)**, con **dos caminos a elegir**:

- **Con vistas.** Creáis nueve vistas que apuntan a vuestras tablas. El agente solo ve eso, y los
  filtros (últimos meses, sin anuladas) los impone la base de datos. Es lo más sólido si esto se
  queda funcionando.
- **Leyendo vuestras tablas.** Sin vistas: dais permiso de solo lectura tabla a tabla y rellenáis
  `mapa-de-tablas.md`, un fichero donde apuntáis cómo se llama cada cosa en vuestra base. Los agentes
  lo leen antes de consultar, así que no hay que tocar sus instrucciones. Se monta en minutos, pero
  los filtros pasan a depender del agente y cada cambio de esquema obliga a actualizar el mapa.

¿Y si no queréis ni rellenar el mapa? También vale: con permiso para ver el esquema, el agente
explora la base y encuentra las tablas solo. Lo dejará escrito en su informe. Va más lento y puede
dudar entre dos tablas parecidas, así que para algo que corre cada día es mejor el mapa.

El mismo conector sirve para los dos motores; solo cambia la cadena de conexión.

El esquema de `db/init/01-esquema.sql` sirve además de guion de la conversación con ellos: es lo que
el agente necesita saber de su facturación, y se ve de un vistazo si en su base falta algo.

Las reglas de `reglas/reglas-facturacion.md` se editan igual: son texto, las mantiene quien sepa de
facturación, no quien sepa programar.

## Qué hace Orca aquí y qué no

**Lo que aporta:** cada agente en su pestaña, visibles a la vez; tareas con dependencias, puertas de
decisión para las aprobaciones y mensajería entre agentes; y una línea de comandos con la que un
agente puede gobernarlo todo, que es lo que permite que el coordinador sea otro agente.

**Lo que no funciona** (Orca 1.4.209, 23/09/2026):

- **Con Claude**, `orca orchestration worker-start` falla siempre: el agente arranca bien, pero Orca
  no detecta que está listo y agota el tiempo de espera. Orca espera a que la pantalla quede quieta
  (`tui-idle`) y con Claude recién arrancado eso no llega nunca; con Claude ya arrancado, la misma
  espera se cumple en 2 segundos. Está abierto como
  [#22040](https://github.com/stablyai/orca/issues/22040): la misma tarea con Codex arranca en medio
  minuto y con Claude se queda siete minutos sin hacer nada. Codex, Cursor y Copilot están
  pre-confiados en su código; Claude no ([#21867](https://github.com/stablyai/orca/issues/21867)).
- `orca orchestration ask`, la pregunta bloqueante, exige una tarea supervisada, así que con Claude
  tampoco sirve. Con Claude habría que coordinar por fuera y aprobar por fichero.
- Las respuestas a una pregunta no vuelven a la bandeja del agente que la hizo.

**Con Codex sí funciona**: `worker-start` arranca el agente, le entrega la tarea y recibe su aviso de
fin. Por eso la vía principal va con Codex.
