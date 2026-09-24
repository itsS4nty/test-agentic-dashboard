/*
  Vistas que leen los agentes, sobre SQL Server.

  Los agentes NO leen vuestras tablas: leen estas nueve vistas. Así podéis cambiar por dentro lo que
  queráis sin tocar a los agentes, y el permiso se da solo sobre esto.

  Qué hay que hacer: sustituir cada FROM por vuestras tablas reales y comprobar que cada columna
  contiene lo que dice el comentario. Los nombres de las vistas y de las columnas NO se cambian:
  son los que las instrucciones de los agentes esperan.

  Ejecutar como administrador sobre la base de datos de facturación.
*/

IF SCHEMA_ID('agente') IS NULL EXEC('CREATE SCHEMA agente');
GO

-- ── Clientes y tiendas ──────────────────────────────────────────────────────

CREATE OR ALTER VIEW agente.clientes AS
SELECT
    c.codigo        AS id,        -- identificador corto y estable del cliente
    c.razon_social  AS nombre
FROM dbo.SUS_CLIENTES AS c;       -- ← vuestra tabla
GO

CREATE OR ALTER VIEW agente.tiendas AS
SELECT
    t.codigo        AS id,
    t.cliente_codigo AS cliente_id,
    t.nombre        AS nombre
FROM dbo.SUS_TIENDAS AS t;        -- ← vuestra tabla
GO

-- ── Catálogo ────────────────────────────────────────────────────────────────

CREATE OR ALTER VIEW agente.categorias AS
SELECT
    cat.codigo      AS id,
    cat.nombre      AS nombre,
    cat.iva         AS iva        -- porcentaje: 21 significa 21 %
FROM dbo.SUS_CATEGORIAS AS cat;
GO

CREATE OR ALTER VIEW agente.catalogo AS
SELECT
    p.referencia    AS sku,
    p.nombre        AS nombre,
    p.categoria     AS categoria_id,
    p.unidad        AS unidad
FROM dbo.SUS_PRODUCTOS AS p;
GO

-- ── Contratos ───────────────────────────────────────────────────────────────

CREATE OR ALTER VIEW agente.contratos AS
SELECT
    ct.id                  AS id,
    ct.cliente_codigo      AS cliente_id,
    ct.numero              AS numero,
    ct.fecha_firma         AS firmado_el,
    ct.fecha_fin           AS vigente_hasta,
    ct.condiciones_factura AS facturacion,
    ct.forma_pago          AS condiciones_pago,
    ct.objeto              AS objeto_del_servicio,   -- TEXTO: qué cubre y qué excluye. El agente lo cita.
    ct.politica_descuentos AS politica_descuentos    -- TEXTO: p. ej. "requiere acuerdo por escrito"
FROM dbo.SUS_CONTRATOS AS ct;
GO

CREATE OR ALTER VIEW agente.tarifas AS
SELECT
    tf.contrato_id  AS contrato_id,
    tf.referencia   AS sku,
    tf.precio       AS precio_pactado   -- precio unitario pactado, sin IVA
FROM dbo.SUS_TARIFAS AS tf;
GO

CREATE OR ALTER VIEW agente.servicios_activos AS
SELECT
    sa.contrato_id  AS contrato_id,
    sa.tienda_codigo AS tienda_id,
    sa.referencia   AS sku            -- servicio que esa tienda tiene contratado y debe facturarse
FROM dbo.SUS_SERVICIOS_ACTIVOS AS sa;
GO

-- ── Facturas ────────────────────────────────────────────────────────────────

CREATE OR ALTER VIEW agente.facturas AS
SELECT
    f.id                AS id,
    f.numero            AS numero,
    f.cliente_codigo    AS cliente_id,
    f.tienda_codigo     AS tienda_id,
    f.fecha             AS fecha,
    f.fecha_vencimiento AS vencimiento,
    CASE WHEN f.emitida = 1 THEN 'emitida' ELSE 'borrador' END AS estado,
    CAST(f.es_cuota_mensual AS bit) AS recurrente,   -- 1 en las cuotas mensuales de tienda
    f.concepto          AS concepto,
    f.observaciones     AS notas,                    -- texto libre: el agente lo usa como pista, no como verdad
    f.base_imponible    AS base,
    f.cuota_iva         AS iva_total,
    f.total             AS total
FROM dbo.SUS_FACTURAS AS f
WHERE f.fecha >= DATEADD(month, -3, GETDATE())       -- ventana: no hace falta darle el histórico entero
  AND f.anulada = 0;
GO

CREATE OR ALTER VIEW agente.lineas AS
SELECT
    l.factura_id    AS factura_id,
    l.linea         AS n,
    l.descripcion   AS descripcion,
    l.referencia    AS sku,          -- puede venir vacía o con un código que no está en el catálogo: es un hallazgo, no un error de la vista
    l.cantidad      AS cantidad,
    l.precio        AS precio_unitario,
    l.iva           AS iva_pct,
    l.importe       AS base          -- cantidad × precio_unitario, sin IVA
FROM dbo.SUS_LINEAS_FACTURA AS l;
GO
