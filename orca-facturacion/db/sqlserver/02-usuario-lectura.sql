/*
  Usuario del agente: solo lectura, y solo sobre las vistas.

  Este es el control de verdad. Las instrucciones de un agente son texto y se pueden cambiar; esto
  no. Con este usuario, el agente no puede escribir aunque se lo pidan.

  Ejecutar como administrador. Cambiad la contraseña antes, y guardadla donde guardéis las demás.
*/

-- 1. Login de servidor
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'agente_facturacion')
    CREATE LOGIN agente_facturacion WITH PASSWORD = 'CAMBIAR-ESTA-CONTRASENA';
GO

-- 2. Usuario en la base de datos de facturación
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'agente_facturacion')
    CREATE USER agente_facturacion FOR LOGIN agente_facturacion;
GO

-- 3. Solo SELECT, y solo sobre el esquema de las vistas
GRANT SELECT ON SCHEMA::agente TO agente_facturacion;

-- 4. Nada sobre las tablas de verdad, por si algún día alguien amplía permisos por error
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO agente_facturacion;
GO

/*
  Comprobación. Con ese usuario:
    SELECT COUNT(*) FROM agente.facturas;      -- debe responder un número
    SELECT TOP 1 * FROM dbo.SUS_FACTURAS;      -- debe fallar por permisos
    UPDATE agente.facturas SET total = 0;      -- debe fallar por permisos
*/
