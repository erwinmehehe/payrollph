import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pinVerifiedPgTls } from "@/lib/pg-tls-policy";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/**
 * Pool size is tunable so the app can sit behind a connection-limited
 * database: a pgBouncer transaction pool, a serverless Postgres with a low
 * ceiling, or a small local instance. Defaults to node-postgres' own default.
 */
const poolMax = Number(process.env.PG_POOL_MAX);

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    // Preserve strict certificate and hostname checks when pg v9 changes
    // the semantics of legacy sslmode=require/prefer/verify-ca aliases.
    connectionString: pinVerifiedPgTls(databaseUrl, process.env.NODE_ENV === "production"),
    ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
