# Datos de la demo de facturas

Datos ficticios de septiembre de 2026 para los tres clientes de `config/clients.yaml`. El proveedor
factura a cadenas de panaderías software TPV, mantenimiento y soporte de equipos de venta,
conectividad, equipos, consumibles de tienda y formación.

- `contracts.json` — `catalog` (categorías con su IVA y productos con referencia, nombre y unidad)
  y `contracts` (uno por cliente: objeto del servicio, tarifas pactadas, servicios activos por
  tienda, condiciones de facturación y política de descuentos).
- `invoices.json` — 30 facturas: 15 **emitidas** (`FV-2026-04xx`, pedidos, visitas y formación ya
  entregados) y 15 **borradores** (`BORR-2609-xx`, las cuotas mensuales a mes vencido y tres
  servicios pendientes de emitir). Cada línea: `description, sku, qty, unitPrice, vatRate, total`
  (`total` es la base de la línea; el IVA se suma en `vatTotal`).

En el catálogo de la demo todas las categorías tributan al 21 %. Los importes de impacto se
expresan en euros, IVA incluido y en valor absoluto.

## Errores sembrados

Cada error aparece **una sola vez**. El resto de facturas cuadra con su contrato y el catálogo.

### Deterministas (capa 1, reglas, coste 0)

| Comprobación | Factura | Estado | Qué está mal | Impacto |
|---|---|---|---|---|
| `precio_contrato` | `fac-06` · FV-2026-0417 · Horno Real · Campanar | emitida | 2 datáfonos `HW-DAT` a 329,00 € (tarifa general); el contrato fija 289,00 € | 96,80 € |
| `iva_catalogo` | `fac-16` · BORR-2609-01 · Horno Real · Patraix | borrador | Formación `FOR-HOR` (8 h) con IVA del 10 %; la categoría `formacion` va al 21 % | 39,60 € |
| `linea_duplicada` | `fac-17` · BORR-2609-02 · Pan de Pueblo · Móstoles | borrador | La línea de papel térmico `PAP-TER` (4 cajas) aparece dos veces | 152,46 € |
| `total_descuadrado` | `fac-03` · FV-2026-0414 · Forn del Barri · Gràcia | emitida | Base 200,00 € + IVA 42,00 € = 242,00 €, pero el total declarado es 224,00 € | 18,00 € |
| `servicio_no_facturado` | `fac-26` · BORR-2609-11 · Forn del Barri · Sants | borrador | La cuota no incluye `CON-4G` (conectividad 4G), activa en el contrato para esa tienda | 15,73 € |

Total de impacto detectado por reglas: 322,59 €.

### Requieren criterio (capa 2, agente `facturacion`)

La comprobación `requiere_criterio` no decide: marca la factura, abre un caso y lo encola al agente.

| Factura | Estado | Por qué una regla no basta | Qué se espera |
|---|---|---|---|
| `fac-18` · BORR-2609-03 · Pan de Pueblo · Alcalá | borrador | La línea 2 usa `VIS-TEC` a precio de contrato, pero el concepto es "Revisión de horno de convección y cámara de fermentación (2 visitas)". Referencia y precio cuadran; el texto habla de maquinaria de obrador, que el objeto del contrato excluye. | Hallazgo de IA (145,20 €) y propuesta de retirar la línea: total 217,80 € → 72,60 €. Queda **pendiente de aprobación**. |
| `fac-07` · FV-2026-0418 · Forn del Barri · Poblenou | emitida | Descuento comercial del 20 % (−179,40 € de base) en la compra de 3 datáfonos. El contrato no prevé descuentos y exige acuerdo por escrito; la justificación es una nota en texto libre sobre un acuerdo telefónico. | Hallazgo de IA (217,07 €). La propuesta de rectificativa **se escala** por la condición `invoice_issued`: la factura emitida no se toca. |

## Regenerar

Los JSON se generaron con un script de un solo uso que calcula los totales con el mismo redondeo
que usan las comprobaciones (`round2` en `../data.ts`). Si se editan a mano, hay que mantener
`total = qty × unitPrice` por línea, `subtotal`, `vatTotal` y `total` coherentes, salvo en los
errores sembrados de esta tabla.
