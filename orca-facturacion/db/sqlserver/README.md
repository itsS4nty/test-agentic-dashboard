# Conectar los agentes a vuestro SQL Server

Esta carpeta es lo que falta para que los agentes dejen de leer la base de datos de ejemplo y lean
la facturación de verdad. Son tres pasos y ninguno es programar.

La idea: **los agentes no leen vuestras tablas, leen nueve vistas**. Vosotros decidís qué hay detrás
de cada vista y el agente solo ve eso. Si mañana cambiáis una tabla por dentro, se cambia la vista y
los agentes ni se enteran.

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

## Paso 4. Ajustar las instrucciones, si hace falta

Los agentes esperan los nombres de tabla de las vistas (`facturas`, `lineas`, `contratos`…). Si en
las vistas usáis el esquema `agente`, en las consultas hay que escribir `agente.facturas`. Decídselo
una vez, en dos sitios:

- `agentes/01-detector.md`, donde dice de dónde saca las facturas.
- `agentes/02-analista.md`, donde dice dónde están los contratos.

Es un párrafo en cada uno, en castellano. No hay nada más que tocar.

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
