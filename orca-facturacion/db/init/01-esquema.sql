-- Esquema de facturación de HitSystems.
-- Reproduce en Postgres lo que en producción vive en su SQL Server: catálogo, contratos con sus
-- tarifas y servicios activos por tienda, y las facturas del mes con sus líneas.

CREATE TABLE clientes (
  id     text PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE tiendas (
  id         text PRIMARY KEY,
  cliente_id text NOT NULL REFERENCES clientes(id),
  nombre     text NOT NULL
);

CREATE TABLE categorias (
  id     text PRIMARY KEY,
  nombre text NOT NULL,
  iva    numeric(5,2) NOT NULL          -- porcentaje: 21 significa 21 %
);

CREATE TABLE catalogo (
  sku          text PRIMARY KEY,
  nombre       text NOT NULL,
  categoria_id text NOT NULL REFERENCES categorias(id),
  unidad       text
);

CREATE TABLE contratos (
  id                   serial PRIMARY KEY,
  cliente_id           text NOT NULL REFERENCES clientes(id),
  numero               text NOT NULL UNIQUE,
  firmado_el           date,
  vigente_hasta        date,
  facturacion          text,
  condiciones_pago     text,
  objeto_del_servicio  text,                -- qué cubre y qué excluye
  politica_descuentos  text
);

CREATE TABLE tarifas (
  contrato_id    integer NOT NULL REFERENCES contratos(id),
  sku            text NOT NULL REFERENCES catalogo(sku),
  precio_pactado numeric(10,2) NOT NULL,
  PRIMARY KEY (contrato_id, sku)
);

CREATE TABLE servicios_activos (
  contrato_id integer NOT NULL REFERENCES contratos(id),
  tienda_id   text NOT NULL REFERENCES tiendas(id),
  sku         text NOT NULL REFERENCES catalogo(sku),
  PRIMARY KEY (contrato_id, tienda_id, sku)
);

CREATE TYPE estado_factura AS ENUM ('borrador', 'emitida');

CREATE TABLE facturas (
  id          text PRIMARY KEY,
  numero      text NOT NULL UNIQUE,
  cliente_id  text NOT NULL REFERENCES clientes(id),
  tienda_id   text NOT NULL REFERENCES tiendas(id),
  fecha       date NOT NULL,
  vencimiento date,
  estado      estado_factura NOT NULL,
  recurrente  boolean NOT NULL DEFAULT false,   -- cuota mensual de la tienda
  concepto    text,
  notas       text,
  base        numeric(12,2) NOT NULL,           -- suma de las bases de las líneas
  iva_total   numeric(12,2) NOT NULL,
  total       numeric(12,2) NOT NULL
);

CREATE TABLE lineas (
  factura_id     text NOT NULL REFERENCES facturas(id),
  n              integer NOT NULL,
  descripcion    text NOT NULL,
  -- A propósito sin clave ajena: en la vida real una línea puede traer un código que no está en el
  -- catálogo (un descuento, un concepto inventado), y eso es justo lo que hay que detectar.
  sku            text,
  cantidad       numeric(10,2) NOT NULL,
  precio_unitario numeric(10,2) NOT NULL,
  iva_pct        numeric(5,2) NOT NULL,
  base           numeric(12,2) NOT NULL,        -- cantidad × precio_unitario
  PRIMARY KEY (factura_id, n)
);

CREATE INDEX ON facturas (fecha);
CREATE INDEX ON facturas (cliente_id, estado);
CREATE INDEX ON lineas (sku);
