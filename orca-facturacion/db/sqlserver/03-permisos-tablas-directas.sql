/*
  Permisos si leen directamente de vuestras tablas (en vez de crear las vistas).

  Misma idea que siempre: el agente solo puede SELECT, y solo sobre las tablas que le hagan falta.
  Listadlas una a una. No useis db_datareader: eso le da toda la base, incluida la nómina.

  Ejecutar como administrador, cambiando antes la contraseña y los nombres de tabla.
*/

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'agente_facturacion')
    CREATE LOGIN agente_facturacion WITH PASSWORD = 'CAMBIAR-ESTA-CONTRASENA';
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'agente_facturacion')
    CREATE USER agente_facturacion FOR LOGIN agente_facturacion;
GO

-- Una línea por tabla que el agente necesita leer. Nada más.
GRANT SELECT ON dbo.SUS_FACTURAS            TO agente_facturacion;
GRANT SELECT ON dbo.SUS_LINEAS_FACTURA      TO agente_facturacion;
GRANT SELECT ON dbo.SUS_CONTRATOS           TO agente_facturacion;
GRANT SELECT ON dbo.SUS_TARIFAS             TO agente_facturacion;
GRANT SELECT ON dbo.SUS_SERVICIOS_ACTIVOS   TO agente_facturacion;
GRANT SELECT ON dbo.SUS_PRODUCTOS           TO agente_facturacion;
GRANT SELECT ON dbo.SUS_CATEGORIAS          TO agente_facturacion;
GRANT SELECT ON dbo.SUS_CLIENTES            TO agente_facturacion;
GRANT SELECT ON dbo.SUS_TIENDAS             TO agente_facturacion;
GO

/*
  Para que el agente pueda explorar el esquema y proponeros el mapa de tablas, dadle además esto.
  Es solo la lista de tablas y columnas, no los datos:

    GRANT VIEW DEFINITION ON SCHEMA::dbo TO agente_facturacion;

  Si no queréis ni eso, rellenad el mapa a mano y no se lo deis.

  Comprobación, con ese usuario:
    SELECT COUNT(*) FROM dbo.SUS_FACTURAS;      -- responde un número
    SELECT TOP 1 * FROM dbo.NOMINAS;            -- debe fallar
    UPDATE dbo.SUS_FACTURAS SET total = 0;      -- debe fallar
*/
