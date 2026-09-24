# Mapa de tablas

Rellenad este fichero **solo si preferís que los agentes lean directamente de vuestras tablas**, en
vez de crear las vistas de `01-vistas.sql`.

Si este fichero existe y está relleno, los agentes lo leen antes de consultar nada y usan estos
nombres. Si no existe, usan los nombres de las vistas. No hay que tocar las instrucciones de los
agentes ni en un caso ni en el otro.

> Truco para rellenarlo sin escribirlo a mano: pedidle al agente que explore la base con la
> herramienta `search_objects` del conector y os proponga el mapa. Después lo revisáis vosotros, que
> sois quienes sabéis qué tabla es la buena cuando hay tres que se parecen.

## Cómo se rellena

Una línea por concepto. A la izquierda lo que el agente necesita, a la derecha cómo se llama en
vuestra base. Si una columna no existe, escribid `no existe` y decid en las notas cómo se deduce.

## Facturas

| El agente necesita | Vuestra tabla y columna |
|---|---|
| tabla de facturas | `dbo.???` |
| identificador | `???` |
| número de factura | `???` |
| cliente | `???` |
| tienda | `???` |
| fecha | `???` |
| estado (emitida o borrador) | `???` — decid qué valor significa cada cosa |
| es cuota mensual | `???` |
| concepto | `???` |
| notas o observaciones | `???` |
| base imponible | `???` |
| cuota de IVA | `???` |
| total | `???` |

## Líneas de factura

| El agente necesita | Vuestra tabla y columna |
|---|---|
| tabla de líneas | `dbo.???` |
| factura a la que pertenece | `???` |
| descripción | `???` |
| referencia o código de producto | `???` |
| cantidad | `???` |
| precio unitario | `???` |
| porcentaje de IVA | `???` |
| importe sin IVA | `???` |

## Contratos, tarifas y servicios

| El agente necesita | Vuestra tabla y columna |
|---|---|
| tabla de contratos | `dbo.???` |
| número de contrato | `???` |
| texto del objeto del servicio | `???` — el agente lo cita, así que tiene que ser el texto real |
| política de descuentos | `???` |
| tabla de tarifas pactadas | `dbo.???` (contrato, referencia, precio) |
| tabla de servicios activos por tienda | `dbo.???` (contrato, tienda, referencia) |

## Catálogo, clientes y tiendas

| El agente necesita | Vuestra tabla y columna |
|---|---|
| catálogo de productos | `dbo.???` (referencia, nombre, categoría) |
| categorías con su IVA | `dbo.???` |
| clientes | `dbo.???` |
| tiendas | `dbo.???` (con a qué cliente pertenece) |

## Reglas de la casa

Escribid aquí lo que el agente no puede adivinar mirando la base:

- **Qué facturas ignorar:** anuladas, de prueba, rectificativas ya emitidas… y cómo se reconocen.
- **Ventana de tiempo:** por ejemplo, «solo los tres últimos meses».
- **Importes:** si alguna columna incluye IVA y otra no, decidlo aquí. Es la fuente número uno de
  errores tontos.
- **Cualquier cosa rara** que sepáis vosotros y no esté escrita en ningún sitio.

## Notas

(Espacio libre para lo que no encaje arriba.)
