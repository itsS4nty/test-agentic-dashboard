# Dictamen de revisión de facturas — septiembre 2026

**Analista:** Agente Analista (HitSystems)
**Fecha:** 2026-09-23
**Fuentes:** salida/1-hallazgos.json · datos/facturas-2026-09.json · datos/contratos-y-catalogo.json · reglas/reglas-facturacion.md

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Hallazgos analizados | 7 (5 del Detector + 2 promovidos desde dudosas) |
| Confirmados | 7 |
| Descartados | 0 |
| Requiere criterio | 0 |
| **Importe total en juego** | **684,86 €** |
| Facturas emitidas → rectificativa | 3 (H-01, H-02, H-06) — 331,87 € |
| Borradores → corrección | 4 (H-03, H-04, H-05, H-07) — 352,99 € |

---

## Hallazgos confirmados

### H-01 · FV-2026-0417 · horno-real / hr-campanar
**Comprobación:** precio_contrato
**Estado factura:** emitida
**Veredicto:** confirmado
**Motivo:** HW-DAT facturado a 329 €/ud. El contrato CT-HR-2024-017 (cláusula de tarifas) fija el precio de HW-DAT en 289 €/ud. Exceso unitario: 40 €; qty 2 → sobrecobro en base 80 €, con IVA 21 %: **96,80 €**. El cliente ha sido cobrado en exceso.
**Acción:** proponer_rectificativa
**Estado:** escalado
**Impacto:** 96,80 €

---

### H-02 · FV-2026-0414 · forn-del-barri / fb-gracia
**Comprobación:** total_descuadrado
**Estado factura:** emitida
**Veredicto:** confirmado
**Motivo:** Error aritmético en el total de la factura. Líneas: PAP-TER 5×34=170 + ETQ-ALE 2×15=30 → subtotal 200 €; vatTotal 200×21%=42 €; total correcto 242 €. La factura declara total 224 €, una diferencia de 18 € a favor del cliente. HitSystems ha facturado 18 € menos de lo que corresponde.
**Acción:** proponer_rectificativa
**Estado:** escalado
**Impacto:** 18,00 €

---

### H-03 · BORR-2609-01 · horno-real / hr-patraix
**Comprobación:** iva_catalogo
**Estado factura:** borrador
**Veredicto:** confirmado
**Motivo:** FOR-HOR (Formación presencial) pertenece a la categoría 'formacion' del catálogo, que establece vatRate 21 %. La línea aplica vatRate 10 %, infrafacturando IVA. Base 360 €; diferencia de IVA: 360×(0,21−0,10)=**39,60 €**. El borrador debe corregirse antes de emitir.
**Acción:** proponer_correccion
**Estado:** pendiente_aprobacion
**Impacto:** 39,60 €

---

### H-04 · BORR-2609-02 · pan-de-pueblo / pp-mostoles
**Comprobación:** linea_duplicada
**Estado factura:** borrador
**Veredicto:** confirmado
**Motivo:** La referencia PAP-TER (qty 4, unitPrice 31,50, total 126) aparece dos veces con idénticos SKU, cantidad y precio unitario. Línea duplicada que sobrecarga al cliente. Base duplicada: 126 €; IVA 21 %: 26,46 €; total con IVA: **152,46 €**.
**Acción:** proponer_correccion
**Estado:** pendiente_aprobacion
**Impacto:** 152,46 €

---

### H-05 · BORR-2609-11 · forn-del-barri / fb-sants
**Comprobación:** servicio_no_facturado
**Estado factura:** borrador
**Veredicto:** confirmado
**Motivo:** CON-4G figura como servicio activo para fb-sants en el contrato CT-FB-2025-004 (activeServices). La cuota mensual de septiembre 2026 de fb-sants no incluye esta línea. Tarifa contractual 13 €/mes; con IVA 21 %: **15,73 €**. Ingreso omitido en el borrador.
**Acción:** proponer_correccion
**Estado:** pendiente_aprobacion
**Impacto:** 15,73 €

---

### H-06 · FV-2026-0418 · forn-del-barri / fb-poblenou
**Origen:** promovido desde dudosas del Detector
**Comprobación:** descuento_sin_respaldo
**Estado factura:** emitida
**Veredicto:** confirmado
**Motivo:** Descuento del 20 % (−179,40 € base, −37,67 € IVA, total −217,07 €) aplicado sin respaldo documental. La nota de la factura indica: _"se acordó por teléfono con gerencia; no consta por escrito."_ El contrato CT-FB-2025-004 (discountPolicy) exige acuerdo por escrito firmado por ambas partes para cualquier descuento o bonificación. Una comunicación telefónica no cumple este requisito.
**Acción:** proponer_rectificativa
**Estado:** escalado
**Impacto:** 217,07 €

---

### H-07 · BORR-2609-03 · pan-de-pueblo / pp-alcala
**Origen:** promovido desde dudosas del Detector
**Comprobación:** concepto_fuera_de_contrato
**Estado factura:** borrador
**Veredicto:** confirmado
**Motivo:** Segunda línea de VIS-TEC describe _"Revisión de horno de convección y cámara de fermentación (2 visitas)"_. El contrato CT-PP-2025-011 (serviceScope) excluye expresamente _"maquinaria de obrador (hornos, cámaras, amasadoras)"_. Aunque el SKU y precio son correctos, el trabajo descrito queda fuera del ámbito contractual. El borrador debe corregirse o la línea debe ampararse en un pedido adicional aceptado por escrito. Base: 2×60=120 €; IVA 21 %: 25,20 €; total con IVA: **145,20 €**.
**Acción:** proponer_correccion
**Estado:** pendiente_aprobacion
**Impacto:** 145,20 €

---

## Importe total en juego: 684,86 €

| ID | Factura | Cliente | Acción | Importe |
|---|---|---|---|---|
| H-01 | FV-2026-0417 | horno-real | rectificativa | 96,80 € |
| H-02 | FV-2026-0414 | forn-del-barri | rectificativa | 18,00 € |
| H-03 | BORR-2609-01 | horno-real | corrección | 39,60 € |
| H-04 | BORR-2609-02 | pan-de-pueblo | corrección | 152,46 € |
| H-05 | BORR-2609-11 | forn-del-barri | corrección | 15,73 € |
| H-06 | FV-2026-0418 | forn-del-barri | rectificativa | 217,07 € |
| H-07 | BORR-2609-03 | pan-de-pueblo | corrección | 145,20 € |
| | | | **TOTAL** | **684,86 €** |

---

## Notas

Todos los hallazgos quedan confirmados; ninguno descartado ni marcado como `requiere_criterio`. Las dos dudosas del Detector se han convertido en hallazgos confirmados (H-06 y H-07) con apoyo contractual explícito.

H-01 y H-02 son errores en facturas emitidas de signo opuesto: H-01 perjudica al cliente (cobro excesivo 96,80 €); H-02 perjudica a HitSystems (cobro insuficiente 18 €). Ambas requieren rectificativa. H-06 también es factura emitida con descuento sin cobertura contractual (217,07 €). Los tres casos escalados suman **331,87 €** y requieren intervención de administración.

Los cuatro borradores (H-03, H-04, H-05, H-07) suman **352,99 €** y se pueden corregir antes de emitir sin necesidad de rectificativa.
