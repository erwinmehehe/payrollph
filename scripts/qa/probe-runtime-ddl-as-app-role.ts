// Disposable localhost rehearsal only. After rehearse-clean-baseline-cutover.mjs,
// call every request-time schema "ensure" function as the restricted runtime role
// (payrollph_app: DML only, no DDL) and report which ones still try to change the
// schema. Run once per CORE_SCHEMA_COMPATIBILITY_MODE (unset, then "read-only").
// The app role password is reset to a random value in this process and never printed.
//
// No-write mode: with PROBE_APP_DATABASE_URL set (for example after the real
// cutover), connect with it as given; never touch passwords, never insert rows,
// and skip the one call that needs an organization.
import { randomBytes } from "node:crypto";
import pg from "pg";

const HOST = "127.0.0.1:5432";
const DB = "neondb";
const adminUrl = `postgresql://postgres:postgres@${HOST}/${DB}`;

async function main() {
  const noWrite = Boolean(process.env.PROBE_APP_DATABASE_URL);
  let orgId: number | null = null;
  if (noWrite) {
    process.env.DATABASE_URL = process.env.PROBE_APP_DATABASE_URL;
  } else {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const password = randomBytes(24).toString("hex");
    try {
      const { rows: [db] } = await admin.query("SELECT current_database() AS name");
      if (db.name !== DB) throw new Error("disposable neondb only");
      await admin.query(`ALTER ROLE payrollph_app PASSWORD '${password}'`);
      const { rows: [org] } = await admin.query(
        "INSERT INTO organizations (name, legal_name) VALUES ('Runtime DDL probe', 'Runtime DDL probe Inc.') RETURNING id");
      orgId = org.id;
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = `postgresql://payrollph_app:${password}@${HOST}/${DB}`;
  }
  process.env.BANK_DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");

  const calls: Array<[string, () => Promise<unknown> | unknown]> = [];
  const add = (label: string, fn: () => Promise<unknown> | unknown) => calls.push([label, fn]);
  const core = await import("../../src/lib/core-schema-compat");
  add("core-schema-compat.ensureCoreCompatibilitySchema", () => core.ensureCoreCompatibilitySchema());
  add("core-schema-compat.bankDataEncryptionReady", () => core.bankDataEncryptionReady());
  add("dole-reporting-schema", async () => (await import("../../src/lib/dole-reporting-schema")).ensureDoleReportingSchema());
  add("leave-payroll-schema", async () => (await import("../../src/lib/leave-payroll-schema")).ensureLeavePayrollSchema());
  add("marketing-leads", async () => (await import("../../src/lib/marketing-leads")).ensureMarketingLeadSchema());
  add("migration-schema", async () => (await import("../../src/lib/migration-schema")).ensureMigrationSchema());
  add("pay-basis-schema.ensureEmployeePayProfileSchema", async () => (await import("../../src/lib/pay-basis-schema")).ensureEmployeePayProfileSchema());
  if (orgId !== null) {
    const id = orgId;
    add("pay-basis-schema.ensureEmployeePayProfiles", async () => (await import("../../src/lib/pay-basis-schema")).ensureEmployeePayProfiles(id));
  }
  add("payroll-month-close-schema", async () => (await import("../../src/lib/payroll-month-close-schema")).ensurePayrollMonthCloseSchema());
  add("separation-schema", async () => (await import("../../src/lib/separation-schema")).ensureSeparationSchema());
  add("statutory-remittance-correction-schema", async () => (await import("../../src/lib/statutory-remittance-correction-schema")).ensureStatutoryRemittanceCorrectionSchema());
  add("statutory-remittance-month-close-schema", async () => (await import("../../src/lib/statutory-remittance-month-close-schema")).ensureStatutoryRemittanceMonthCloseSchema());
  add("workforce-attendance-control-schema", async () => (await import("../../src/lib/workforce-attendance-control-schema")).ensureWorkforceAttendanceControlSchema());

  const results: Array<Record<string, unknown>> = [];
  for (const [label, fn] of calls) {
    try {
      await fn();
      results.push({ call: label, ok: true });
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string; message?: string }; message?: string };
      results.push({
        call: label, ok: false,
        code: e.code ?? e.cause?.code ?? null,
        error: String(e.cause?.message ?? e.message ?? error).split("\n")[0].slice(0, 160),
      });
    }
  }
  console.log(JSON.stringify({
    kind: "runtime-ddl-as-app-role",
    mode: process.env.CORE_SCHEMA_COMPATIBILITY_MODE ?? "(unset: legacy runtime writes)",
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }, null, 2));
  const { pool } = await import("../../src/db");
  await pool.end();
  if (process.argv.includes("--fail-on-error") && results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((error) => { console.error(String(error?.message ?? error).split("\n")[0]); process.exit(1); });
