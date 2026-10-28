import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  JOURNAL_WINDOW, JOURNAL_COLUMNS, requireDisposableJournalEnv,
  fictionalJournalAmounts, parseQuotedJournalCsv, proveJournalResponse,
  assertJournalDenial, assertJournalAuditIncrement,
} from "../scripts/qa/tenant-v1-journal-contract.mjs";

const cell = v => '"' + String(v).replaceAll('"', '""') + '"';
const csv = rows => rows.map(row => row.map(cell).join(",")).join("\n");
const a = { rank: 1, runId: 51, entityId: 11,
  periodLabel: "TTBL-ATTA-fixture-JOURNAL",
  forbiddenMarkers: ["TTBL-ATTB-fixture", "TTBL-VICTIM-fixture",
    "TTBL-ATTA-fixture-DRAFT", "TTBL-ATTA-fixture-OUTSIDE"],
  forbiddenTokens: ["sk_live_NEVER_LEAK_THIS"],
};
const b = { rank: 2, runId: 71, entityId: 15,
  periodLabel: "TTBL-ATTB-fixture-JOURNAL",
  forbiddenMarkers: ["TTBL-ATTA-fixture", "TTBL-VICTIM-fixture"],
};
function rowsFor(x) {
  const amounts = fictionalJournalAmounts(x.rank);
  const common = [String(x.runId), String(x.entityId), JOURNAL_WINDOW.payDate, x.periodLabel];
  return [
    [...common, "6000", "Payroll expense", amounts.grossPay, "0.00"],
    [...common, "2100", "Payroll deductions control", "0.00", amounts.deductions],
    [...common, "2200", "Net payroll payable", "0.00", amounts.netPay],
  ];
}
function response(x = a) {
  return { status: 200, text: csv([JOURNAL_COLUMNS, ...rowsFor(x)]),
    headers: new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=linaw-payroll-journal.csv",
      "Cache-Control": "no-store",
    }) };
}
function mutate(change, x = a) {
  const r = response(x);
  change(r);
  return r;
}

test("strict disposable GitHub Actions/PG16/localhost config refuses false or missing enablement", () => {
  const good = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PUBLIC_API_V1_EXTENDED_ENABLED: "true",
    API_V1_EXTENDED_READS_ENABLED: "true",
  };
  requireDisposableJournalEnv(good);
  for (const [key, expected] of Object.entries(good)) {
    // For disabled-provider flags "false" is the *required* safe value.
    // Flip each flag to its opposite instead of accidentally testing
    // the unchanged valid configuration and expecting it to throw.
    const unsafe = expected === "false" ? "true" : "false";
    assert.throws(() => requireDisposableJournalEnv({ ...good, [key]: unsafe }),
      /V1_JOURNAL_REFUSED/, key + " must fail when changed from " + expected);
    assert.throws(() => requireDisposableJournalEnv({ ...good, [key]: undefined }),
      /V1_JOURNAL_REFUSED/, key + " must fail when missing");
  }
});

test("fixture is an integer-centavo balanced source and discriminates real employer ranks", () => {
  assert.deepEqual(fictionalJournalAmounts(1),
    { grossPay: "1100.00", netPay: "875.00", deductions: "225.00" });
  assert.deepEqual(fictionalJournalAmounts(2),
    { grossPay: "1200.00", netPay: "950.00", deductions: "250.00" });
  assert.deepEqual(fictionalJournalAmounts(4),
    { grossPay: "1400.00", netPay: "1100.00", deductions: "300.00" });
  for (const rank of [1, 2, 4]) {
    const v = fictionalJournalAmounts(rank);
    assert.equal(Math.round(Number(v.grossPay) * 100),
      Math.round(Number(v.netPay) * 100) + Math.round(Number(v.deductions) * 100));
  }
  assert.throws(() => fictionalJournalAmounts(0));
});

test("strict quoted CSV parser preserves commas, escaped quotes, and embedded newlines", () => {
  const cells = rowsFor(a);
  cells[0][3] = 'Our "quoted",\nsecond-line payroll';
  const source = csv([JOURNAL_COLUMNS, ...cells]);
  assert.deepEqual(parseQuotedJournalCsv(source), cells);
  assert.deepEqual(parseQuotedJournalCsv(source + "\n"), cells);
  for (const malformed of [
    "", "not csv", '"unterminated', '"only","two"',
    csv([JOURNAL_COLUMNS]), csv([JOURNAL_COLUMNS, ...cells]) + ',',
    csv([JOURNAL_COLUMNS, ...cells]) + '"',
  ]) {
    assert.throws(() => parseQuotedJournalCsv(malformed), malformed);
  }
});

test("actual own CSV response proof requires exactly own released record, amounts and headers", () => {
  proveJournalResponse(response(a), a);
  proveJournalResponse(response(b), b);
  assert.throws(() => proveJournalResponse(response(a), b),
    "attacker A's own CSV must never count as B's proof");
  assert.throws(() => proveJournalResponse(response(b), a),
    "attacker B's own CSV must never count as A's proof");
});

test("normalized no-store journal headers are accepted, cacheable headers fail closed", () => {
  for (const safe of [
    "no-store", "private, no-store", "no-store, max-age=0",
    "NO-STORE, MAX-AGE=0", "no-store, max-age = 0", "no-cache, no-store",
  ]) {
    const r = response(a);
    r.headers.set("cache-control", safe);
    assert.doesNotThrow(() => proveJournalResponse(r, a), safe);
  }
  for (const unsafe of [
    "", "private", "no-cache", "public, no-store", "no-store, public",
    "no-store, max-age=1", "no-store, max-age=60", "no-store, max-age",
    "no-store, s-maxage=0", "no-store, s-maxage=600",
    "no-store, stale-while-revalidate=60", "no-store, stale-if-error=60",
    "no-store, immutable",
  ]) {
    const r = response(a);
    r.headers.set("cache-control", unsafe);
    assert.throws(() => proveJournalResponse(r, a), unsafe || "missing directives");
  }
});

test("forged journal, entity, dates, draft/foreign rows or header omissions are caught", () => {
  const mutations = [
    r => { r.status = 403; },
    r => { r.headers.delete("content-disposition"); },
    r => { r.headers.set("cache-control", "public"); },
    r => { r.headers.set("content-type", "application/json"); },
    r => { r.text = csv([JOURNAL_COLUMNS]); },
    r => { r.text = csv([JOURNAL_COLUMNS, ...rowsFor(a), ...rowsFor(b)]); },
    r => { const lines = rowsFor(a); lines[0][0] = "999"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { const lines = rowsFor(a); lines[0][1] = "999"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { const lines = rowsFor(a); lines[1][7] = "200.00"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { const lines = rowsFor(a); lines[2][4] = "6000"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { const lines = rowsFor(a); lines[0][3] = "TTBL-VICTIM-fixture"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { const lines = rowsFor(a); lines[2][3] = "TTBL-ATTA-fixture-DRAFT"; r.text = csv([JOURNAL_COLUMNS, ...lines]); },
    r => { r.text += "\nsk_live_NEVER_LEAK_THIS"; },
  ];
  for (const change of mutations) assert.throws(() => proveJournalResponse(mutate(change), a));
});

test("denials reject key theft, scope absence and legal employer expansion without CSV or token data", () => {
  for (const status of [401, 403, 409]) {
    const r = { status, text: '{"error":"Access denied."}', headers: new Headers() };
    assertJournalDenial(r, status, [a.periodLabel, "sk_live_NEVER_LEAK_THIS"]);
  }
  for (const text of [csv([JOURNAL_COLUMNS, ...rowsFor(a)]),
    '{"error":"TTBL-VICTIM-fixture"}', '{"error":"sk_live_NEVER_LEAK_THIS"}']) {
    assert.throws(() => assertJournalDenial({ status: 403, text },
      403, ["TTBL-VICTIM-fixture", "sk_live_NEVER_LEAK_THIS"]));
  }
  assert.throws(() => assertJournalDenial({ status: 200, text: "{}" }, 403));
});

test("audit source requires exact own key, employer, legal entity and no early write", () => {
  const old = { id: 10, organizationId: 11, actor: "api_key:4",
    action: "API payroll accounting journal exported",
    resource: "payroll-journal",
    metadata: { startDate: JOURNAL_WINDOW.startDate, endDate: JOURNAL_WINDOW.endDate,
      legalEntityId: 11, runCount: 1, lineCount: 3 } };
  const before = [old];
  const created = { ...structuredClone(old), id: 11 };
  const after = [structuredClone(old), created];
  const opts = { orgId: 11, entityId: 11, keyId: 4, count: 1 };
  assertJournalAuditIncrement(before, after, opts);
  assert.throws(() => assertJournalAuditIncrement(before, before, opts));
  for (const field of ["organizationId", "actor", "action", "resource", "metadata"]) {
    const bad = structuredClone(after);
    bad[1][field] = field === "metadata" ? { source: "forged" } : "foreign";
    assert.throws(() => assertJournalAuditIncrement(before, bad, opts));
  }
  const changedPrior = structuredClone(after);
  changedPrior[0].metadata.runCount = 999;
  assert.throws(() => assertJournalAuditIncrement(before, changedPrior, opts));
});

test("dedicated source preserves production API and has separately reconciled provisional method credit", () => {
  const source = readFileSync("src/app/api/v1/journal-entries/route.ts", "utf8");
  const proof = readFileSync("scripts/qa/tenant-v1-journal-http.mjs", "utf8");
  const routeLib = readFileSync("src/lib/api-v1-extended.ts", "utf8");
  assert.match(source, /authorizeExtendedV1Read\(request, "payroll:read"\)/);
  assert.match(source, /scopedJournalEntityId/);
  assert.match(source, /eq\(payrollRuns\.status, "Released"\)/);
  assert.match(source, /eq\(payrollRuns\.legalEntityId, legalEntityId\)/);
  assert.match(routeLib, /apiV1ExtendedReads/);
  for (const term of ["victimSnapshot", "mintApiKey", "seedEmployer",
    "sk_live_", "keyRows(victim)", "await runs(victim)",
    "await audit(victim)", "revokedAt", "legalEntities"]) {
    assert.ok(proof.includes(term), "missing strict integration evidence: " + term);
  }
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(manifest.allApiRouteFiles)
    .find(item => item.route === "v1/journal-entries");
  const evidence = record?.methods?.find(m => m.name === "GET");
  assert.equal(evidence?.status, "COVERED", "exact-head PG16 bearer-key proof was separately reviewed");
  assert.equal(evidence?.testedBy?.file, "scripts/qa/tenant-v1-journal-http.mjs");
  assert.equal(evidence?.testedBy?.prNumber, 1484);
  assert.match(evidence?.testedBy?.evidence ?? "", /actions\/runs\/40514472303/);
});
