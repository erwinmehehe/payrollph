import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableSelfAvailability, requireSensitiveNoStoreCache } from "../scripts/qa/tenant-self-availability-guard.mjs";

const safe = Object.freeze({
  CI: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production",
  WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "",
  XENDIT_SECRET_KEY: "",
  RESEND_API_KEY: "",
});

test("the fixture-only HTTP proof explicitly requires disposable local PG16 and a local server", () => {
  assert.equal(requireDisposableSelfAvailability(safe), true);
  for (const [name, value] of [
    ["CI", "false"], ["NODE_ENV", "development"],
    ["TENANT_SECOND_PASS_MODE", "local"], ["WFM_EMPLOYEE_AVAILABILITY_ENABLED", "false"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/other_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5433/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "provider-secret"],
    ["XENDIT_SECRET_KEY", "provider-secret"],
    ["RESEND_API_KEY", "provider-secret"],
  ]) {
    assert.throws(() => requireDisposableSelfAvailability({ ...safe, [name]: value }),
      /SELF_AVAILABILITY_PROOF_REFUSED/, name);
  }
  assert.throws(() => requireDisposableSelfAvailability({ ...safe, DATABASE_URL: undefined }),
    /SELF_AVAILABILITY_PROOF_REFUSED/);
});

test("self-availability API keeps the session authoritative for both reads and writes", () => {
  const source = readFileSync("src/app/api/self/availability/route.ts", "utf8");
  assert.match(source, /const session = await getSessionUser\(\)/);
  assert.match(source, /session\.role !== "employee" \|\| !session\.employeeId/);
  assert.match(source, /assertMembership\(session\.id, employee\.organizationId\)/);
  assert.match(source, /if \(new URL\(request\.url\)\.search\) return respond/);
  assert.match(source, /eq\(employeeAvailabilityRules\.organizationId, scope\.employee!\.organizationId\)/);
  assert.match(source, /eq\(employeeAvailabilityRules\.employeeId, scope\.employee!\.id\)/);
  assert.match(source, /eq\(employeeAvailabilityRules\.organizationId, employee\.organizationId\)/);
  assert.match(source, /eq\(employeeAvailabilityRules\.employeeId, employee\.id\)/);
  assert.match(source, /enforceSameOriginMutation\(request\)/);
  assert.match(source, /publicDemoMutationDenied\(session\.email/);
  assert.doesNotMatch(source, /export async function PATCH/);
});

test("standalone workflow runs real signed-in HTTP against fictional PG16 only", () => {
  const wf = readFileSync(".github/workflows/tenant-self-availability-http.yml", "utf8");
  const proof = readFileSync("scripts/qa/tenant-self-availability-http.mjs", "utf8");
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /npm run db:push/);
  assert.match(wf, /apply-isolated-baseline\.mjs/);
  assert.match(wf, /npm run build/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-self-availability-http\.mjs/);
  assert.match(proof, /requireDisposableSelfAvailability\(\)/);
  assert.match(proof, /seedEmployeeEmployer\("VICTIM"/);
  // The strengthened runner wraps HTTP denials in deniedSource(), which
  // compares every employer's persisted availability, workforce, audit and
  // payroll rows before and after each forged selector. Require that wrapper
  // instead of the older unverified bare expect() call.
  assert.match(proof, /await deniedSource\(ENDPOINT \+ "\?organizationId="/);
  assert.match(proof, /await deniedSource\(ENDPOINT \+ "\?employeeId="/);
  assert.match(proof, /const before = await Promise\.all\(\[attackerA, attackerB, victim\]/);
  assert.match(proof, /assertUnchanged\(before\[i\], after\[i\]/);
  assert.match(proof, /assertPrivateDenial\(response, status, forbidden\)/);
  assert.match(proof, /victimRowsAfter, victimRowsBefore/);
  assert.doesNotMatch(proof, /https:\/\//);
});

test("authenticated availability GET must be non-cacheable even after Next.js header normalization", () => {
  for (const value of [
    "private, no-store",
    "no-store, max-age=0",
    "NO-STORE, MAX-AGE=0",
    "no-store, private, max-age=0",
  ]) {
    assert.equal(requireSensitiveNoStoreCache(new Headers({ "cache-control": value })), true, value);
  }
  for (const value of [
    undefined,
    "private, max-age=0",
    "no-cache",
    "public, no-store",
    "no-store, max-age=60",
    "no-store, s-maxage=0",
    "no-store, immutable",
    "no-store-but-actually-cacheable",
    "no-store, max-age",
  ]) {
    const headers = new Headers(value === undefined ? undefined : { "cache-control": value });
    assert.throws(() => requireSensitiveNoStoreCache(headers), /SELF_AVAILABILITY_CACHE_UNSAFE/, String(value));
  }
});
