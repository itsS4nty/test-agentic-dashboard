# Conectar los agentes a vuestro SQL Server

Esta carpeta es lo que falta para que los agentes dejen de leer la base de datos de ejemplo y lean
la facturación de verdad. Son tres pasos y ninguno es programar.

Hay **dos formas de hacerlo** y las dos están preparadas. Elegid una:

| | Opción A: con vistas | Opción B: leyendo vuestras tablas |
|---|---|---|
| Qué hay que hacer | Crear nueve vistas | Rellenar un fichero con los nombres de vuestras tablas |
| Qué ve el agente | Solo lo que exponéis | Las tablas a las que le deis permiso |
| Si cambiáis una tabla | Se toca la vista, nada más | Hay que actualizar el mapa |
| Filtros (anuladas, tres meses) | Los impone la base de datos | Dependen de que el agente los aplique |
| Trabajo de vuestro DBA | Una hora larga | Unos minutos |

**Recomiendo la A** si esto va a quedarse funcionando: los filtros y los permisos los impone la base,
no la buena voluntad del agente. La **B** es perfecta para probar rápido y decidir después.

Las dos usan el mismo usuario de solo lectura y el mismo conector; lo único que cambia es sobre qué
le dais permiso y si rellenáis el mapa.

---

# Opción A: con vistas

Los agentes no leen vuestras tablas, leen nueve vistas. Vosotros decidís qué hay detrás de cada una.
Si mañana cambiáis una tabla por dentro, se cambia la vista y los agentes ni se enteran.

## Paso 1. Crear las vistas

Abrid [`01-vistas.sql`](01-vistas.sql) y sustituid cada `FROM dbo.SUS_...` por vuestras tablas
reales. **Los nombres de las vistas y de sus columnas no se tocan**: son los que los agentes esperan.

Las nueve vistas y lo que tiene que haber en cada una:

| Vista | Qué contiene | Detalle que importa |
|---|---|---|
| `agente.facturas` | Una fila por factura | `estado` debe decir `emitida` o `borrador`. Es lo que decide si se corrige o se propone rectificativa |
| `agente.lineas` | Una fila por línea de factura | `base` es cantidad × precio, sin IVA. `sku` puede venir vacío: eso es un hallazgo, no un fallo |
| `agente.contratos` | Un contrato por cliente | `objeto_del_servicio` y `politica_descuentos` son **texto libre**: el agente los lee y los cita |
| `agente.tarifas` | Precio pactado por referencia y contrato | Sin IVA |
| `agente.servicios_activos` | Qué servicios tiene contratados cada tienda | Es lo que permite detectar cuotas a las que les falta algo |
| `agente.catalogo` | Referencia, nombre y categoría | |
| `agente.categorias` | Categoría y su IVA | El IVA correcto sale de aquí, no de la factura |
| `agente.clientes` | Identificador y razón social | |
| `agente.tiendas` | Tienda y a qué cliente pertenece | |

Dos consejos de la ventana de datos:

- En `agente.facturas` hay un filtro de tres meses. No le deis el histórico entero: ni lo necesita ni
  os interesa que lo lea.
- Si tenéis facturas anuladas o de prueba, excluidlas ahí. Lo que no está en la vista, no existe para
  el agente.

## Paso 2. Crear el usuario

Ejecutad [`02-usuario-lectura.sql`](02-usuario-lectura.sql) cambiando antes la contraseña. Crea un
usuario que **solo puede hacer SELECT y solo sobre las vistas**, y que tiene denegado el acceso a las
tablas de verdad.

Esto es lo más importante de todo el montaje. Las instrucciones de un agente son un fichero de texto
que cualquiera puede cambiar; los permisos de la base de datos, no. Comprobadlo con ese usuario:

```sql
SELECT COUNT(*) FROM agente.facturas;   -- responde un número
SELECT TOP 1 * FROM dbo.SUS_FACTURAS;   -- debe fallar
UPDATE agente.facturas SET total = 0;   -- debe fallar
```

Si las dos últimas no fallan, parad: algo está mal en los permisos.

## Paso 3. Apuntar el conector a vuestro servidor

En [`dbhub.sqlserver.toml`](dbhub.sqlserver.toml) poned vuestro servidor, base de datos y la
contraseña del paso 2. Después, en `~/.codex/config.toml` de la máquina donde corran los agentes:

```toml
[mcp_servers.facturacion]
command = "npx"
args = ["-y", "@bytebase/dbhub@latest", "--config", "<ruta>/db/sqlserver/dbhub.sqlserver.toml"]
startup_timeout_sec = 60
tool_timeout_sec = 120
```

Comprobad que está con `codex mcp list` y probadlo con una consulta suelta:

```bash
codex "Con la herramienta execute_sql del conector facturacion, ejecuta: SELECT COUNT(*) FROM agente.facturas; y responde solo el número."
```

Si responde un número, ya está: los agentes leen vuestra facturación.

---

# Opción B: leer directamente de vuestras tablas

Si preferís no crear vistas, los agentes pueden ir contra vuestras tablas. Son dos pasos.

## B1. Dar permiso, tabla a tabla

Ejecutad [`03-permisos-tablas-directas.sql`](03-permisos-tablas-directas.sql), que crea el mismo
usuario de solo lectura y le da `SELECT` **solo sobre las tablas que listéis**.

No useis `db_datareader`: eso le daría la base entera, nóminas incluidas. Una línea por tabla, y solo
las nueve que necesita.

## B2. Rellenar el mapa de tablas

Rellenad [`mapa-de-tablas.md`](mapa-de-tablas.md): una línea por concepto, diciendo cómo se llama en
vuestra base. **Los agentes leen ese fichero antes de consultar nada** y usan esos nombres; no hay
que tocar sus instrucciones.

Para no escribirlo a mano, dadle también permiso de ver el esquema
(`GRANT VIEW DEFINITION ON SCHEMA::dbo`) y pedidle al agente que explore y os proponga el mapa:

```bash
codex "Con la herramienta search_objects del conector facturacion, explora el esquema y proponme
el contenido de db/sqlserver/mapa-de-tablas.md. No inventes: si dudas entre dos tablas, dilo."
```

Revisadlo vosotros antes de darlo por bueno: él ve nombres, vosotros sabéis cuál es la tabla buena
cuando hay tres que se parecen.

En el apartado «Reglas de la casa» del mapa está lo más importante y lo que nadie apunta nunca: qué
facturas hay que ignorar, qué ventana de tiempo mirar y si algún importe lleva el IVA incluido.

## Lo que perdéis con esta opción

- **Los filtros pasan a ser una instrucción, no un candado.** Que el agente mire solo los últimos
  tres meses y salte las anuladas depende de que lo haga; con vistas, la base no le enseña otra cosa.
- **Cada cambio en vuestro esquema obliga a tocar el mapa.** Con vistas, se toca la vista.
- **El agente ve los nombres reales de vuestras tablas.** Sin importancia si es interno, algo a
  pensar si algún día ese agente lo maneja alguien de fuera.

---

# Un detalle común a las dos opciones

Los agentes usan por defecto los nombres `facturas`, `lineas`, `contratos`… a secas. Si vuestras
vistas van en el esquema `agente` (como en `01-vistas.sql`) o vuestras tablas tienen otros nombres,
**rellenad `mapa-de-tablas.md`**: por ejemplo `agente.facturas` en vez de `facturas`. Los agentes lo
leen antes de consultar y usan lo que ponga ahí.

Es decir: el mapa sirve para las dos opciones, y mientras esté puesto, **no hay que tocar ningún
fichero de los agentes**.

## Qué NO está probado

Esto está escrito a partir del montaje que sí funciona sobre PostgreSQL, y del formato de conexión
que el conector documenta para SQL Server. **No se ha podido probar contra un SQL Server real**
porque no tenemos acceso. Lo previsible es que falle alguna de estas tres cosas, todas de
configuración:

1. **El cifrado de la conexión.** Muchos SQL Server exigen TLS: si la conexión se rechaza, cambiad
   `sslmode=disable` por `sslmode=true` en el dsn.
2. **La instancia con nombre.** Si vuestro servidor es `SERVIDOR\SQLEXPRESS`, va como
   `&instanceName=SQLEXPRESS` al final del dsn, no con la barra.
3. **Los tipos de datos.** Si alguna columna de importe es `money` o `decimal` con separador raro,
   revisad que la vista la devuelva como número y no como texto.

Cuando lo tengáis montado, decidme qué falló y lo dejo escrito aquí para la próxima.

## Después de esto

Con las vistas y el usuario creados, el resto ya está: los cuatro agentes son ficheros de texto y no
cambian. Lo que sí conviene decidir antes de dejarlo funcionando solo:

- **Qué puede hacer sin preguntar.** De momento, leer e informar. Nada de escribir en facturas.
- **Quién aprueba** cuando el agente propone corregir un borrador.
- **Quién se entera si un día no se ejecuta.** Eso no lo cubre ningún agente: hace falta un vigilante
  externo, y está explicado en el README principal.
