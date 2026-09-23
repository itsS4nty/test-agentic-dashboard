# Reglas de revisión de facturas

Datos: `datos/facturas-2026-09.json` (30 facturas de septiembre de 2026, emitidas y borradores) y
`datos/contratos-y-catalogo.json` (catálogo de productos con su IVA y un contrato por cliente).

Los importes se expresan en euros con IVA incluido y en valor absoluto. En cada línea,
`total` es la base imponible (`qty × unitPrice`); el IVA se suma aparte en `vatTotal`.

## Comprobaciones deterministas

Estas no necesitan criterio: o se cumplen o no.

| Nombre | Qué comprueba |
|---|---|
| `precio_contrato` | Cada línea se factura a la tarifa pactada en el contrato del cliente. Si el contrato no fija tarifa para esa referencia, vale la del catálogo. |
| `iva_catalogo` | El IVA de la línea es el de la categoría del producto en el catálogo. |
| `linea_duplicada` | La misma referencia, cantidad y precio no aparece dos veces en la misma factura. |
| `total_descuadrado` | `subtotal` es la suma de las bases, `vatTotal` el IVA correspondiente, y `total` la suma de ambos. |
| `servicio_no_facturado` | En las cuotas mensuales recurrentes están todos los servicios activos de esa tienda según el contrato. |

## Lo que requiere criterio

No son reglas: son señales para que una persona o un agente decidan.

- **Conceptos que no encajan con el objeto del contrato.** La referencia y el precio pueden cuadrar
  y aun así el texto describir un trabajo que el contrato excluye.
- **Descuentos sin respaldo.** El contrato exige acuerdo por escrito firmado por ambas partes. Una
  nota en texto libre no es un acuerdo por escrito.

## Regla de negocio que manda sobre todo

Una factura **emitida** no se corrige sola: se propone una rectificativa y se escala a
administración. Solo los **borradores** admiten propuesta de corrección directa.
