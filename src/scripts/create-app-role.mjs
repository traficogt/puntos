#!/usr/bin/env node
/**
 * Create a least-privilege application DB role (login, nosuperuser, nobypassrls) and grant basic DML rights.
 *
 * Env:
 *   APP_DB_USER (default: puntos_app)
 *   APP_DB_PASSWORD (required)
 *   DB_HOST/DB_PORT/DB_NAME
 *   DB_MIGRATIONS_USER/DB_MIGRATIONS_PASSWORD (fallback to DB_USER/DB_PASSWORD)
 */
import pg from "pg";

const {
  APP_DB_USER = "puntos_app",
  APP_DB_PASSWORD,
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "puntos",
  DB_MIGRATIONS_USER,
  DB_MIGRATIONS_PASSWORD,
  DB_USER,
  DB_PASSWORD
} = process.env;

if (!APP_DB_PASSWORD) {
  console.error("APP_DB_PASSWORD is required (will be used to create the app role).");
  process.exit(1);
}

const connUser = DB_MIGRATIONS_USER || DB_USER;
const connPass = DB_MIGRATIONS_PASSWORD || DB_PASSWORD;

if (!connUser || !connPass) {
  console.error("DB_MIGRATIONS_USER/DB_MIGRATIONS_PASSWORD (or DB_USER/DB_PASSWORD) are required to create roles.");
  process.exit(1);
}

const client = new pg.Client({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: connUser,
  password: connPass
});

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  await client.connect();
  await client.query("BEGIN");
  try {
    const appDbUserLiteral = quoteLiteral(APP_DB_USER);
    const appDbPasswordLiteral = quoteLiteral(APP_DB_PASSWORD);
    const appDbUserIdent = quoteIdent(APP_DB_USER);
    const dbNameIdent = quoteIdent(DB_NAME);

    await client.query(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${appDbUserLiteral}) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS', ${appDbUserLiteral}, ${appDbPasswordLiteral});
      ELSE
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS', ${appDbUserLiteral}, ${appDbPasswordLiteral});
      END IF;
    END$$;`);

    await client.query(`GRANT CONNECT ON DATABASE ${dbNameIdent} TO ${appDbUserIdent}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${appDbUserIdent}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appDbUserIdent}`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${appDbUserIdent}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appDbUserIdent}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appDbUserIdent}`);

    // app.* functions are schema-qualified in RLS and login flows; runtime roles need schema USAGE.
    await client.query("CREATE SCHEMA IF NOT EXISTS app");
    await client.query(`GRANT USAGE ON SCHEMA app TO ${appDbUserIdent}`);

    // If the login lookup function exists, ensure the runtime role can execute it.
    await client.query(`DO $$
    BEGIN
      IF to_regprocedure('app.staff_login_lookup(text)') IS NOT NULL THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION app.staff_login_lookup(text) TO %I', ${appDbUserLiteral});
      END IF;
    END$$;`);

    await client.query("COMMIT");
    console.log(`App role '${APP_DB_USER}' ensured with basic DML grants.`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
