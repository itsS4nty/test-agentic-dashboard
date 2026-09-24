-- El control de verdad no es lo que diga el prompt: es el permiso.
-- El agente entra con este usuario y, diga lo que diga, no puede escribir nada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agente') THEN
    CREATE ROLE agente LOGIN PASSWORD 'agente';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE facturacion TO agente;
GRANT USAGE ON SCHEMA public TO agente;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agente;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agente;

-- Ni crear tablas ni tocar las existentes.
REVOKE CREATE ON SCHEMA public FROM agente;
