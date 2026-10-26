/**
 * DL-01 shared, real HTTP/PG16 proof harness: THREE fictional employers,
 * two independent authenticated attackers and a higher-ID victim.
 * No manifest credit is given by merely running this module.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import * as s from "../../src/db/schema";
import { encryptBankAccount } from "../../src/lib/bank-account-crypto";

export const BASE = process.env.DL01_PROOF_URL ?? "";
export const METHODS = Object.freeze([
  "GET /api/year-end/prior-evidence", "POST /api/year-end/prior-evidence",
  "POST /api/payroll-runs/[id]/exports", "POST /api/documents",
  "POST /api/employees/import",
]);

export function requireDisposable() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.TENANT_DL01_CLOSURE_PROOF, "isolated-ci-only");
  assert.equal(BASE, "http://127.0.0.1:3011");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(pg.href, "postgresql://postgres:postgres@127.0.0.1:5432/payroll_dl01_test");
  assert.equal(process.env.PAYMONGO_SECRET_KEY, "sk_test_synthetic_no_network");
  assert.equal(process.env.PAYMONGO_WALLET_ID, "wallet_synthetic");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(process.env.PAYROLL_PAYOUT_PROVIDER, "paymongo");
  assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "https://127.0.0.1:8444/");
  assert.equal(process.env.MALWARE_SCAN_URL, "https://127.0.0.1:8443/scan");
}
export function exact(result, expected, label) {
  assert.equal(result.status, expected, label + " got " + result.status + ": " + result.text.slice(0, 250));
  return result;
}
export async function request(path, { method = "GET", cookie, body, fields, file } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") Object.assign(headers, { origin: BASE, "sec-fetch-site": "same-origin" });
  let payload;
  if (fields) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
    if (file) form.set("file", new Blob([file.bytes], { type: file.mime }), file.name);
    payload = form;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(new URL(path, BASE), {
    method, headers, body: payload, redirect: "manual", cache: "no-store",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response retained */ }
  return { status: response.status, text, json, bytes, headers: response.headers };
}
export function noVictim(result, victim, label) {
  assert.ok(!result.text.includes(victim.worker.employeeNo), label + ": leaked victim worker");
  assert.ok(!result.text.includes(victim.marker), label + ": leaked victim marker");
}
async function session(userId) {
  const raw = randomBytes(32).toString("hex");
  const [row] = await db.insert(s.sessions).values({
    userId, tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3600_000),
    mfaVerifiedAt: new Date(), lastSeenAt: new Date(), authMethod: "oidc",
  }).returning();
  return { row, cookie: "__Host-linaw_session=" + raw };
}
async function account(org, label, nonce) {
  const [user] = await db.insert(s.users).values({
    email: "dl01-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
    name: "DL01 " + label + " " + nonce, role: "owner",
    passwordHash: "fictional-session-only", totpEnabled: true,
  }).returning();
  await db.insert(s.userOrganizations).values({
    userId: user.id, organizationId: org.id, role: "owner", active: true,
  });
  return { user, ...(await session(user.id)) };
}
async function run(e, suffix) {
  const [record] = await db.insert(s.payrollRuns).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    periodLabel: "DL01 " + e.label + " " + suffix,
    periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-16",
    status: "Released", employeeCount: 1, grossPay: "30000.00", netPay: "28000.00",
  }).returning();
  await db.insert(s.payrollEntries).values({
    payrollRunId: record.id, employeeId: e.worker.id,
    grossPay: "30000.00", deductions: "2000.00", netPay: "28000.00",
    trace: { payment: {
      employeeName: e.worker.firstName + " " + e.worker.lastName,
      employeeNo: e.worker.employeeNo, bankAccount: e.worker.bankAccount,
      bankCode: e.worker.bankCode, mobile: e.worker.mobile,
    } },
    lineItems: [{ code: "BASIC", amount: 30000 }, { code: "WHT", amount: -2000 }],
  });
  return record;
}
async function oneEmployer(label, nonce) {
  const marker = "DL01-" + label + "-" + nonce;
  const [org] = await db.insert(s.organizations).values({
    name: marker, legalName: "Fictional " + marker,
  }).returning();
  const [entity] = await db.insert(s.legalEntities).values({
    organizationId: org.id, code: marker.slice(0, 40),
    legalName: "Fictional " + marker, displayName: marker, primaryEntity: true,
  }).returning();
  const operator = await account(org, label + "-maker", nonce);
  const checker = await account(org, label + "-checker", nonce);
  const [worker] = await db.insert(s.employees).values({
    organizationId: org.id, legalEntityId: entity.id,
    employeeNo: marker.slice(0, 32), firstName: label,
    lastName: "Synthetic", title: "CI worker", avatarInitials: "CI",
    basicRate: "60000.00", startDate: "2026-01-05", region: "NCR",
    bankCode: "BPI", bankAccount: encryptBankAccount("000000000001"),
  }).returning();
  await db.insert(s.employeePayProfiles).values({
    organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
    rateAmount: "60000.00", standardWorkDaysPerMonth: "22.00",
    standardHoursPerDay: "8.00",
  });
  await db.insert(s.subscriptions).values({
    organizationId: org.id, plan: "Scale", status: "active",
    provider: "pilot", seatLimit: 20,
  });
  const employer = { label, marker, org, entity, operator, checker, worker };
  employer.payoutRun = await run(employer, "PROVIDER");
  employer.manualRun = await run(employer, "MANUAL");
  return employer;
}
async function reserveHighIds() {
  // Constant tables only, isolated disposable PG16 only.
  for (const table of ["organizations", "employees", "payroll_runs", "documents",
    "import_batches", "year_end_prior_evidence", "bank_file_validations"]) {
    assert.match(table, /^[a-z_]+$/);
    await pool.query("SELECT setval(pg_get_serial_sequence($1, 'id')," +
      " GREATEST(6, COALESCE((SELECT max(id) FROM " + table + "),0)), true)", [table]);
  }
}
export async function fixture() {
  requireDisposable();
  assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
    "DL-01 refuses pre-existing organizations (disposable database only)");
  await reserveHighIds();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 9);
  const attackers = [await oneEmployer("ATTA", nonce), await oneEmployer("ATTB", nonce)];
  const victim = await oneEmployer("VICTIM", nonce);
  for (const field of ["org", "worker", "payoutRun", "manualRun"]) {
    const id = victim[field].id;
    assert.ok(Number.isSafeInteger(id) && id > 6 &&
      attackers.every(e => id > e[field].id),
      field + " requires a real, persisted higher-ID victim");
  }
  return { attackers, victim, all: [...attackers, victim], db, pool, s, request, exact, noVictim };
}
export async function victimSnapshot(victim) {
  const id = victim.org.id;
  const scoped = (table) => db.select().from(table).where(eq(table.organizationId, id));
  return {
    organization: await scoped(s.organizations),
    employees: await scoped(s.employees),
    payProfiles: await scoped(s.employeePayProfiles),
    priorEvidence: await scoped(s.yearEndPriorEvidence),
    documents: await scoped(s.documents),
    imports: await scoped(s.importBatches),
    payrollRuns: await scoped(s.payrollRuns),
    payrollEntries: await db.select().from(s.payrollEntries)
      .where(inArray(s.payrollEntries.payrollRunId, [victim.payoutRun.id, victim.manualRun.id])),
    payoutBatches: await scoped(s.payoutBatches),
    validation: await scoped(s.bankFileValidations),
    audit: await scoped(s.auditEvents),
  };
}
export async function foreignDenied(ctx, method, path, actor, body, status, label) {
  const before = await victimSnapshot(ctx.victim);
  const response = exact(await request(path, {
    method, cookie: actor.operator.cookie, body,
  }), status, label);
  noVictim(response, ctx.victim, label);
  assert.deepEqual(await victimSnapshot(ctx.victim), before,
    label + ": no victim rows or audit changed");
  return response;
}
