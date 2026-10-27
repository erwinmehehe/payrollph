import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TAKE_HOME_RATES, requireDisposableTakeHome,
  assertOwnTakeHome, assertTakeHomeDenied, assertNoForeignSalary,
} from "../scripts/qa/tenant-self-take-home-contract.mjs";

const safe = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production",
  TZ: "Asia/Manila", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "",
});

const good = (amount = 24000, cache = "private, no-store") => ({
  status: 200,
  headers: { get: (key) => key === "cache-control" ? cache : null },
  text: JSON.stringify({ estimate: { netPay: amount - 3000 } }),
  json: {
    asOf: "2026-10-28", baseline: { monthlyBasic: amount, payBasis: "monthly", mwe: false },
    estimate: { netPay: amount - 3000 }, note: "An estimate, not a released payslip.",
  },
});
const denied = (status = 403) => ({
  status, headers: { get: () => null },
  text: '{"error":"You do not have access to this workspace."}',
  json: { error: "You do not have access to this workspace." },
});

test("only empty fictional localhost PG16 in CI can perform take-home privacy probes", () => {
  assert.equal(requireDisposableTakeHome(safe), true);
  const changes = [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"],
    ["TENANT_SECOND_PASS_MODE", "local"],
    ["NODE_ENV", "development"], ["TZ", "UTC"], ["DEMO_MODE", "true"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/neondb"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.com:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "sk_live_fake"],
    ["RESEND_API_KEY", "re_fake"], ["SMTP_URL", "smtp://mail.example.test"],
  ];
  for (const [key, value] of changes) {
    assert.throws(() => requireDisposableTakeHome({ ...safe, [key]: value }), undefined,
      key + " must fail closed");
  }
  assert.throws(() => requireDisposableTakeHome({ ...safe, DATABASE_URL: undefined }));
});

test("positive salary is populated and employee-specific, never an empty success or another worker", () => {
  assert.equal(assertOwnTakeHome(good(24000), TAKE_HOME_RATES.ATTA,
    [TAKE_HOME_RATES.ATTB, TAKE_HOME_RATES.VICTIM, TAKE_HOME_RATES.PEER]).baseline.monthlyBasic, 24000);
  assert.throws(() => assertOwnTakeHome(good(24000), TAKE_HOME_RATES.ATTB));
  assert.throws(() => assertOwnTakeHome(good(52000), TAKE_HOME_RATES.ATTA));
  const empty = good(); empty.json.baseline = {};
  assert.throws(() => assertOwnTakeHome(empty, TAKE_HOME_RATES.ATTA));
  const peer = good(31500);
  assert.throws(() => assertOwnTakeHome(peer, TAKE_HOME_RATES.ATTA));
  assert.throws(() => assertNoForeignSalary(peer, [TAKE_HOME_RATES.PEER]));
});

test("private salary HTTP responses must be uncacheable and must not claim a payslip", () => {
  assert.doesNotThrow(() => assertOwnTakeHome(good(24000, "no-store, max-age=0"), TAKE_HOME_RATES.ATTA));
  for (const header of ["", "private, max-age=0", "public, no-store", "s-maxage=60, no-store"]) {
    assert.throws(() => assertOwnTakeHome(good(24000, header), TAKE_HOME_RATES.ATTA), undefined, header);
  }
  const asPayslip = good(); asPayslip.json.note = "Official payment released";
  assert.throws(() => assertOwnTakeHome(asPayslip, TAKE_HOME_RATES.ATTA));
  const withUser = good(); withUser.json.employeeId = 123;
  assert.throws(() => assertOwnTakeHome(withUser, TAKE_HOME_RATES.ATTA));
});

test("denials never include employee salary baseline, calculations or session cookie", () => {
  assert.doesNotThrow(() => assertTakeHomeDenied(denied(401), 401, [TAKE_HOME_RATES.VICTIM]));
  assert.doesNotThrow(() => assertTakeHomeDenied(denied(403), 403, [TAKE_HOME_RATES.VICTIM]));
  assert.throws(() => assertTakeHomeDenied(good(), 403));
  const leaking = denied(); leaking.json.baseline = { monthlyBasic: 52000 };
  assert.throws(() => assertTakeHomeDenied(leaking, 403, [TAKE_HOME_RATES.VICTIM]));
  const cookie = denied(); cookie.text += "__Host-linaw_session=anything";
  assert.throws(() => assertTakeHomeDenied(cookie, 403));
});

test("the production route gets employee ID only from session, checks exact employer membership and no-store", () => {
  const route = readFileSync("src/app/api/self/take-home-estimate/route.ts", "utf8");
  assert.match(route, /export async function GET\(\)/);
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /session\.role !== "employee"/);
  assert.match(route, /!session\.employeeId/);
  assert.match(route, /eq\(employees\.id, session\.employeeId\)/);
  assert.match(route, /assertMembership\(session\.id, employee\.organizationId\)/);
  assert.match(route, /eq\(employeePayProfiles\.employeeId, employee\.id\)/);
  assert.match(route, /Cache-Control": "no-store, private"/);
  assert.doesNotMatch(route, /searchParams|request\.json\(|body\.employeeId|body\.organizationId/);
});

test("the exact GET method is GAP and this provisional test cannot create coverage credit", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles["src/app/api/self/take-home-estimate/route.ts"]
    ?.methods?.find(item => item.name === "GET");
  assert.equal(method?.status, "GAP");
  assert.equal(method?.testedBy ?? null, null);
});

test("dedicated workflow and runner require two real attacker employers, higher-ID victim and peer", () => {
  const workflow = readFileSync(".github/workflows/tenant-self-take-home-http.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-self-take-home-http.mjs", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-self-take-home-http\.mjs/);
  assert.match(workflow, /node scripts\/qa\/prepare-hcm-work-item-fixture\.mjs/);
  assert.match(workflow, /cancel-in-progress:/);
  assert.match(runner, /requireDisposableTakeHome\(\)/);
  assert.match(runner, /seed\("ATTA"\)/);
  assert.match(runner, /seed\("ATTB"\)/);
  assert.match(runner, /seed\("VICTIM"\)/);
  assert.match(runner, /await addWorker\(e, "PEER"\)/);
  assert.match(runner, /victimSnapshot\(victim\.org\.id\)/);
  assert.match(runner, /standaloneRequest\(ENDPOINT \+ query/);
  assert.match(runner, /set\(\{ active: false \}\)/);
  assert.match(runner, /coverageCreditsAdded: 0/);
});
