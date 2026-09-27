import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Database = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: Database;
};

let runtimePool: Pool | undefined;
let runtimeDb: Database | undefined;

function databaseUrlRequired() {
  return new Error("DATABASE_URL is required");
}

function getPool(): Pool {
  if (runtimePool) return runtimePool;
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    runtimePool = globalForDb.__arenaNextJsPostgresqlPool;
    return runtimePool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw databaseUrlRequired();

  runtimePool = new Pool({ connectionString: databaseUrl });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = runtimePool;
  }

  return runtimePool;
}

function getDb(): Database {
  if (runtimeDb) return runtimeDb;
  if (globalForDb.__arenaNextJsPostgresqlDb) {
    runtimeDb = globalForDb.__arenaNextJsPostgresqlDb;
    return runtimeDb;
  }

  runtimeDb = drizzle(getPool());

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlDb = runtimeDb;
  }

  return runtimeDb;
}

function bindProperty<T extends object>(target: T, property: PropertyKey) {
  const value = Reflect.get(target, property, target);
  return typeof value === "function" ? value.bind(target) : value;
}

/**
 * These proxies intentionally defer database initialization until the first
 * actual database operation. Next.js imports route modules while building;
 * those imports must not require a live database connection or DATABASE_URL.
 *
 * At runtime, the first attempted database access still fails immediately
 * with a clear configuration error when DATABASE_URL is missing.
 */
export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    return bindProperty(getPool(), property);
  },
  set(_target, property, value) {
    return Reflect.set(getPool(), property, value);
  },
});

export const db = new Proxy({} as Database, {
  get(_target, property) {
    return bindProperty(getDb(), property);
  },
  set(_target, property, value) {
    return Reflect.set(getDb(), property, value);
  },
});
