-- Datos de ejemplo: septiembre de 2026. Generado desde los JSON de datos/.

INSERT INTO clientes (id, nombre) VALUES ('horno-real', 'Panaderías Horno Real');
INSERT INTO clientes (id, nombre) VALUES ('forn-del-barri', 'Forn del Barri');
INSERT INTO clientes (id, nombre) VALUES ('pan-de-pueblo', 'Pan de Pueblo');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-centro', 'horno-real', 'Centro');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-ruzafa', 'horno-real', 'Ruzafa');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-campanar', 'horno-real', 'Campanar');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-benimaclet', 'horno-real', 'Benimaclet');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-cabanyal', 'horno-real', 'Cabanyal');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('hr-patraix', 'horno-real', 'Patraix');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('fb-gracia', 'forn-del-barri', 'Gràcia');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('fb-sants', 'forn-del-barri', 'Sants');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('fb-poblenou', 'forn-del-barri', 'Poblenou');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('pp-alcala', 'pan-de-pueblo', 'Alcalá');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('pp-getafe', 'pan-de-pueblo', 'Getafe');
INSERT INTO tiendas (id, cliente_id, nombre) VALUES ('pp-mostoles', 'pan-de-pueblo', 'Móstoles');

INSERT INTO categorias (id, nombre, iva) VALUES ('licencias', 'Licencias de software', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('mantenimiento', 'Mantenimiento de equipos', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('soporte', 'Soporte y asistencia', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('conectividad', 'Conectividad', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('hardware', 'Equipos de punto de venta', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('consumibles', 'Consumibles de tienda', 21);
INSERT INTO categorias (id, nombre, iva) VALUES ('formacion', 'Formación', 21);
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('LIC-TPV', 'Licencia de software TPV', 'licencias', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('LIC-OBR', 'Licencia módulo de obrador y producción', 'licencias', 'mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('LIC-FID', 'Licencia módulo de fidelización', 'licencias', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('MNT-TPV', 'Mantenimiento de equipos TPV', 'mantenimiento', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('SOP-PRE', 'Soporte premium 7 días', 'soporte', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('SOP-EST', 'Soporte estándar en días laborables', 'soporte', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('CON-4G', 'Conectividad 4G de respaldo', 'conectividad', 'tienda/mes');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('VIS-TEC', 'Visita técnica fuera de contrato', 'mantenimiento', 'visita');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('HW-DAT', 'Datáfono Android con impresora', 'hardware', 'unidad');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('HW-IMP', 'Impresora de tickets térmica', 'hardware', 'unidad');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('PAP-TER', 'Papel térmico 80 mm (caja de 50 rollos)', 'consumibles', 'caja');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('ETQ-ALE', 'Etiquetas de alérgenos (rollo de 1.000)', 'consumibles', 'rollo');
INSERT INTO catalogo (sku, nombre, categoria_id, unidad) VALUES ('FOR-HOR', 'Formación presencial', 'formacion', 'hora');

INSERT INTO contratos (id, cliente_id, numero, firmado_el, vigente_hasta, facturacion, condiciones_pago, objeto_del_servicio, politica_descuentos)
VALUES (1, 'horno-real', 'CT-HR-2024-017', '2024-03-01', '2027-02-28', 'Cuotas mensuales a mes vencido, una factura por tienda. Pedidos y visitas se facturan al entregarse.', 'Transferencia a 30 días', 'Software de punto de venta para panadería, mantenimiento y soporte de los equipos de venta instalados en tienda (TPV, datáfonos, impresoras de tickets y router), suministro de consumibles de tienda y formación en el uso del software. No incluye maquinaria de obrador (hornos, cámaras, amasadoras) ni balanzas.', 'El contrato no prevé descuentos. Cualquier descuento o bonificación requiere acuerdo por escrito firmado por ambas partes.');
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'LIC-TPV', 39);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'LIC-OBR', 59);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'MNT-TPV', 24);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'SOP-PRE', 18);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'VIS-TEC', 65);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'HW-DAT', 289);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'HW-IMP', 149);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'PAP-TER', 32);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'ETQ-ALE', 14.5);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (1, 'FOR-HOR', 45);
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-centro', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-ruzafa', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-campanar', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-benimaclet', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-cabanyal', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-patraix', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-centro', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-ruzafa', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-campanar', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-benimaclet', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-cabanyal', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-patraix', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-centro', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-ruzafa', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-campanar', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-benimaclet', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-cabanyal', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-patraix', 'SOP-PRE');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (1, 'hr-centro', 'LIC-OBR');
INSERT INTO contratos (id, cliente_id, numero, firmado_el, vigente_hasta, facturacion, condiciones_pago, objeto_del_servicio, politica_descuentos)
VALUES (2, 'forn-del-barri', 'CT-FB-2025-004', '2025-01-15', '2027-01-14', 'Cuotas mensuales a mes vencido, una factura por tienda. Pedidos y visitas se facturan al entregarse.', 'Domiciliación bancaria a 15 días', 'Software de punto de venta para panadería, mantenimiento y soporte de los equipos de venta instalados en tienda (TPV, datáfonos, impresoras de tickets y router), suministro de consumibles de tienda y formación en el uso del software. No incluye maquinaria de obrador (hornos, cámaras, amasadoras) ni balanzas.', 'El contrato no prevé descuentos. Cualquier descuento o bonificación requiere acuerdo por escrito firmado por ambas partes.');
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'LIC-TPV', 42);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'MNT-TPV', 26);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'SOP-EST', 12);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'CON-4G', 13);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'VIS-TEC', 70);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'HW-DAT', 299);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'PAP-TER', 34);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (2, 'ETQ-ALE', 15);
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-gracia', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-sants', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-poblenou', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-gracia', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-sants', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-poblenou', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-gracia', 'SOP-EST');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-sants', 'SOP-EST');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-poblenou', 'SOP-EST');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-gracia', 'CON-4G');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-sants', 'CON-4G');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (2, 'fb-poblenou', 'CON-4G');
INSERT INTO contratos (id, cliente_id, numero, firmado_el, vigente_hasta, facturacion, condiciones_pago, objeto_del_servicio, politica_descuentos)
VALUES (3, 'pan-de-pueblo', 'CT-PP-2025-011', '2025-06-01', '2027-05-31', 'Cuotas mensuales a mes vencido, una factura por tienda. Pedidos y visitas se facturan al entregarse.', 'Transferencia a 30 días', 'Software de punto de venta para panadería, mantenimiento y soporte de los equipos de venta instalados en tienda (TPV, datáfonos, impresoras de tickets y router), suministro de consumibles de tienda y formación en el uso del software. No incluye maquinaria de obrador (hornos, cámaras, amasadoras) ni balanzas.', 'El contrato no prevé descuentos. Cualquier descuento o bonificación requiere acuerdo por escrito firmado por ambas partes.');
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'LIC-TPV', 40);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'LIC-FID', 19);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'MNT-TPV', 25);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'SOP-EST', 12);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'VIS-TEC', 60);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'HW-DAT', 279);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'HW-IMP', 145);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'PAP-TER', 31.5);
INSERT INTO tarifas (contrato_id, sku, precio_pactado) VALUES (3, 'FOR-HOR', 42);
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-alcala', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-getafe', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-mostoles', 'LIC-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-alcala', 'LIC-FID');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-getafe', 'LIC-FID');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-mostoles', 'LIC-FID');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-alcala', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-getafe', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-mostoles', 'MNT-TPV');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-alcala', 'SOP-EST');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-getafe', 'SOP-EST');
INSERT INTO servicios_activos (contrato_id, tienda_id, sku) VALUES (3, 'pp-mostoles', 'SOP-EST');
SELECT setval('contratos_id_seq', (SELECT max(id) FROM contratos));

INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-01', 'FV-2026-0412', 'horno-real', 'hr-centro', '2026-09-02', '2026-10-02', 'emitida', false, 'Pedido de consumibles', NULL, 378, 79.38, 457.38);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-01', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 10, 32, 21, 320);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-01', 2, 'Etiquetas de alérgenos (rollo de 1.000)', 'ETQ-ALE', 4, 14.5, 21, 58);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-02', 'FV-2026-0413', 'pan-de-pueblo', 'pp-getafe', '2026-09-02', '2026-10-02', 'emitida', false, 'Pedido de consumibles', NULL, 189, 39.69, 228.69);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-02', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 6, 31.5, 21, 189);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-03', 'FV-2026-0414', 'forn-del-barri', 'fb-gracia', '2026-09-03', '2026-09-18', 'emitida', false, 'Pedido de consumibles', NULL, 200, 42, 224);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-03', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 5, 34, 21, 170);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-03', 2, 'Etiquetas de alérgenos (rollo de 1.000)', 'ETQ-ALE', 2, 15, 21, 30);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-04', 'FV-2026-0415', 'horno-real', 'hr-ruzafa', '2026-09-04', '2026-10-04', 'emitida', false, 'Visita técnica', NULL, 65, 13.65, 78.65);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-04', 1, 'Visita técnica fuera de contrato · sustitución de cajón portamonedas', 'VIS-TEC', 1, 65, 21, 65);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-05', 'FV-2026-0416', 'pan-de-pueblo', 'pp-alcala', '2026-09-05', '2026-10-05', 'emitida', false, 'Suministro de equipos', NULL, 145, 30.45, 175.45);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-05', 1, 'Impresora de tickets térmica', 'HW-IMP', 1, 145, 21, 145);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-06', 'FV-2026-0417', 'horno-real', 'hr-campanar', '2026-09-08', '2026-10-08', 'emitida', false, 'Renovación de datáfonos', NULL, 658, 138.18, 796.18);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-06', 1, 'Datáfono Android con impresora', 'HW-DAT', 2, 329, 21, 658);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-07', 'FV-2026-0418', 'forn-del-barri', 'fb-poblenou', '2026-09-08', '2026-09-23', 'emitida', false, 'Renovación de datáfonos', 'Descuento del 20 % aplicado a petición del encargado de la tienda por las caídas del datáfono en agosto. Según el comercial se acordó por teléfono con gerencia; no consta por escrito.', 717.6, 150.7, 868.3);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-07', 1, 'Datáfono Android con impresora', 'HW-DAT', 3, 299, 21, 897);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-07', 2, 'Descuento comercial 20 %', 'DTO', 1, -179.4, 21, -179.4);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-08', 'FV-2026-0419', 'horno-real', 'hr-cabanyal', '2026-09-09', '2026-10-09', 'emitida', false, 'Pedido de consumibles', NULL, 128, 26.88, 154.88);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-08', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 4, 32, 21, 128);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-09', 'FV-2026-0420', 'horno-real', 'hr-benimaclet', '2026-09-11', '2026-10-11', 'emitida', false, 'Formación de personal', NULL, 135, 28.35, 163.35);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-09', 1, 'Formación presencial · nuevo personal de caja', 'FOR-HOR', 3, 45, 21, 135);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-10', 'FV-2026-0421', 'forn-del-barri', 'fb-sants', '2026-09-12', '2026-09-27', 'emitida', false, 'Visita técnica', NULL, 70, 14.7, 84.7);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-10', 1, 'Visita técnica fuera de contrato · router sin conexión tras obra en el local', 'VIS-TEC', 1, 70, 21, 70);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-11', 'FV-2026-0422', 'horno-real', 'hr-patraix', '2026-09-15', '2026-10-15', 'emitida', false, 'Suministro de equipos y consumibles', NULL, 213, 44.73, 257.73);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-11', 1, 'Impresora de tickets térmica', 'HW-IMP', 1, 149, 21, 149);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-11', 2, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 2, 32, 21, 64);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-12', 'FV-2026-0423', 'pan-de-pueblo', 'pp-getafe', '2026-09-16', '2026-10-16', 'emitida', false, 'Formación de personal', NULL, 168, 35.28, 203.28);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-12', 1, 'Formación presencial · módulo de fidelización', 'FOR-HOR', 4, 42, 21, 168);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-13', 'FV-2026-0424', 'horno-real', 'hr-centro', '2026-09-18', '2026-10-18', 'emitida', false, 'Suministro de equipos', NULL, 298, 62.58, 360.58);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-13', 1, 'Impresora de tickets térmica · segundo puesto de cobro', 'HW-IMP', 2, 149, 21, 298);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-14', 'FV-2026-0425', 'forn-del-barri', 'fb-gracia', '2026-09-22', '2026-10-07', 'emitida', false, 'Pedido de consumibles', NULL, 90, 18.9, 108.9);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-14', 1, 'Etiquetas de alérgenos (rollo de 1.000)', 'ETQ-ALE', 6, 15, 21, 90);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-15', 'FV-2026-0426', 'pan-de-pueblo', 'pp-mostoles', '2026-09-23', '2026-10-23', 'emitida', false, 'Pedido de consumibles', NULL, 94.5, 19.85, 114.35);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-15', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 3, 31.5, 21, 94.5);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-16', 'BORR-2609-01', 'horno-real', 'hr-patraix', '2026-09-24', '2026-10-24', 'borrador', false, 'Formación de personal', NULL, 360, 36, 396);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-16', 1, 'Formación presencial · apertura de la tienda', 'FOR-HOR', 8, 45, 10, 360);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-17', 'BORR-2609-02', 'pan-de-pueblo', 'pp-mostoles', '2026-09-26', '2026-10-26', 'borrador', false, 'Pedido de consumibles', NULL, 252, 52.92, 304.92);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-17', 1, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 4, 31.5, 21, 126);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-17', 2, 'Papel térmico 80 mm (caja de 50 rollos)', 'PAP-TER', 4, 31.5, 21, 126);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-18', 'BORR-2609-03', 'pan-de-pueblo', 'pp-alcala', '2026-09-29', '2026-10-29', 'borrador', false, 'Visitas técnicas', NULL, 180, 37.8, 217.8);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-18', 1, 'Visita técnica fuera de contrato · sustitución de lector de códigos de barras', 'VIS-TEC', 1, 60, 21, 60);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-18', 2, 'Revisión de horno de convección y cámara de fermentación (2 visitas)', 'VIS-TEC', 2, 60, 21, 120);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-19', 'BORR-2609-04', 'horno-real', 'hr-centro', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 140, 29.4, 169.4);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-19', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-19', 2, 'Licencia módulo de obrador y producción · septiembre 2026', 'LIC-OBR', 1, 59, 21, 59);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-19', 3, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-19', 4, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-20', 'BORR-2609-05', 'horno-real', 'hr-ruzafa', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 81, 17.01, 98.01);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-20', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-20', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-20', 3, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-21', 'BORR-2609-06', 'horno-real', 'hr-campanar', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 81, 17.01, 98.01);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-21', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-21', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-21', 3, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-22', 'BORR-2609-07', 'horno-real', 'hr-benimaclet', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 81, 17.01, 98.01);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-22', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-22', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-22', 3, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-23', 'BORR-2609-08', 'horno-real', 'hr-cabanyal', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 81, 17.01, 98.01);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-23', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-23', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-23', 3, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-24', 'BORR-2609-09', 'horno-real', 'hr-patraix', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 81, 17.01, 98.01);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-24', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 39, 21, 39);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-24', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 24, 21, 24);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-24', 3, 'Soporte premium 7 días · septiembre 2026', 'SOP-PRE', 1, 18, 21, 18);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-25', 'BORR-2609-10', 'forn-del-barri', 'fb-gracia', '2026-09-30', '2026-10-15', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 93, 19.53, 112.53);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-25', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 42, 21, 42);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-25', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 26, 21, 26);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-25', 3, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-25', 4, 'Conectividad 4G de respaldo · septiembre 2026', 'CON-4G', 1, 13, 21, 13);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-26', 'BORR-2609-11', 'forn-del-barri', 'fb-sants', '2026-09-30', '2026-10-15', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 80, 16.8, 96.8);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-26', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 42, 21, 42);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-26', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 26, 21, 26);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-26', 3, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-27', 'BORR-2609-12', 'forn-del-barri', 'fb-poblenou', '2026-09-30', '2026-10-15', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 93, 19.53, 112.53);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-27', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 42, 21, 42);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-27', 2, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 26, 21, 26);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-27', 3, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-27', 4, 'Conectividad 4G de respaldo · septiembre 2026', 'CON-4G', 1, 13, 21, 13);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-28', 'BORR-2609-13', 'pan-de-pueblo', 'pp-alcala', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 96, 20.16, 116.16);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-28', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 40, 21, 40);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-28', 2, 'Licencia módulo de fidelización · septiembre 2026', 'LIC-FID', 1, 19, 21, 19);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-28', 3, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 25, 21, 25);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-28', 4, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-29', 'BORR-2609-14', 'pan-de-pueblo', 'pp-getafe', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 96, 20.16, 116.16);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-29', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 40, 21, 40);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-29', 2, 'Licencia módulo de fidelización · septiembre 2026', 'LIC-FID', 1, 19, 21, 19);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-29', 3, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 25, 21, 25);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-29', 4, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
INSERT INTO facturas (id, numero, cliente_id, tienda_id, fecha, vencimiento, estado, recurrente, concepto, notas, base, iva_total, total)
VALUES ('fac-30', 'BORR-2609-15', 'pan-de-pueblo', 'pp-mostoles', '2026-09-30', '2026-10-30', 'borrador', true, 'Cuota mensual septiembre 2026', NULL, 96, 20.16, 116.16);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-30', 1, 'Licencia de software TPV · septiembre 2026', 'LIC-TPV', 1, 40, 21, 40);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-30', 2, 'Licencia módulo de fidelización · septiembre 2026', 'LIC-FID', 1, 19, 21, 19);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-30', 3, 'Mantenimiento de equipos TPV · septiembre 2026', 'MNT-TPV', 1, 25, 21, 25);
INSERT INTO lineas (factura_id, n, descripcion, sku, cantidad, precio_unitario, iva_pct, base) VALUES ('fac-30', 4, 'Soporte estándar en días laborables · septiembre 2026', 'SOP-EST', 1, 12, 21, 12);
