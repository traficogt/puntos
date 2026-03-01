-- Initialize e2e database with least-privileged runtime role and a privileged migrations role.

-- Application runtime role (no superuser, no createdb/createrole)
CREATE ROLE loyalty_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'loyalty_app_password';

-- Database is created by entrypoint using POSTGRES_USER=loyalty_admin and POSTGRES_DB=puntos_e2e
\c puntos_e2e

-- Grant runtime privileges
GRANT CONNECT ON DATABASE puntos_e2e TO loyalty_app;
GRANT USAGE ON SCHEMA public TO loyalty_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO loyalty_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO loyalty_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO loyalty_app;
