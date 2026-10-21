#!/usr/bin/env node
// CI ONLY. Simulates Neon for the production cutover runner: a non-superuser
// CREATEDB/CREATEROLE owner of an empty allowlisted test database, and the payrollph_* roles created
// by that owner with SQL (the operator's step). Random passwords are masked and
// written to $GITHUB_ENV as connection URLs for later steps; never printed.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import pg from "pg";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
  throw new Error("CI only (GitHub Actions with GITHUB_ENV)");
}
const HOST = "127.0.0.1:5432";
const databaseName = process.env.EXPECTED_DATABASE_NAME;
if (!["neondb", "payrollph_clean_baseline"].includes(databaseName)) throw new Error("Unsupported disposable test database");
const secret = () => randomBytes(24).toString("hex");
const pw = { owner: secret(), migrator: secret(), planner: secret(), app: secret(), sealer: secret() };
for (const value of Object.values(pw)) console.log(`::add-mask::${value}`);

const admin = new pg.Client({ connectionString: `postgresql://postgres:postgres@${HOST}/postgres` });
await admin.connect();
await admin.query(`CREATE ROLE neondb_owner_sim LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD '${pw.owner}'`);
await admin.query(`CREATE DATABASE ${databaseName} OWNER neondb_owner_sim`);
await admin.end();

const ownerUrl = `postgresql://neondb_owner_sim:${pw.owner}@${HOST}/${databaseName}`;
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
await owner.query(`CREATE ROLE payrollph_schema_owner NOLOGIN NOINHERIT;
  CREATE ROLE payrollph_ledger_owner NOLOGIN NOINHERIT;
  CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT;
  CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT;`);
await owner.query(`CREATE ROLE payrollph_migrator LOGIN INHERIT PASSWORD '${pw.migrator}'`);
await owner.query(`CREATE ROLE payrollph_migration_planner LOGIN NOINHERIT PASSWORD '${pw.planner}'`);
await owner.query(`CREATE ROLE payrollph_app LOGIN NOINHERIT PASSWORD '${pw.app}'`);
await owner.query(`CREATE ROLE payrollph_sealer_login LOGIN NOINHERIT PASSWORD '${pw.sealer}'`);
await owner.end();

appendFileSync(process.env.GITHUB_ENV, [
  `SIM_OWNER_URL=${ownerUrl}`,
  `SIM_PLANNER_URL=postgresql://payrollph_migration_planner:${pw.planner}@${HOST}/${databaseName}`,
  `SIM_APP_URL=postgresql://payrollph_app:${pw.app}@${HOST}/${databaseName}`,
  `SIM_SEALER_URL=postgresql://payrollph_sealer_login:${pw.sealer}@${HOST}/${databaseName}`,
].join("\n") + "\n");
console.log(`Provisioned the simulated Neon owner, an empty ${databaseName} and the payrollph_* roles.`);
