/**
 * Pure source contracts for a separate API-key based v1 journal tenant test.
 * Only genuine production-mode localhost HTTP + disposable PG16 can satisfy
 * the integration proof. Never return API tokens or employer markers in logs.
 */
import assert from "node:assert/strict";

export const JOURNAL_WINDOW = Object.freeze({
  startDate: "2026-09-01", endDate: "2026-09-30", payDate: "2026-09-15",
});
export const JOURNAL_COLUMNS = Object.freeze([
  "Payroll run ID", "Legal entity ID", "Pay date", "Period",
  "Account code", "Account name", "Debit PHP", "Credit PHP",
]);

export function requireDisposableJournalEnv(env = process.env) {
  for (const [name, expected] of Object.entries({
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PUBLIC_API_V1_EXTENDED_ENABLED: "true",
    API_V1_EXTENDED_READS_ENABLED: "true",
  })) {
    assert.equal(env[name], expected,
      "V1_JOURNAL_REFUSED: " + name + " must match disposable HTTP/PG16 configuration");
  }
}

export function fictionalJournalAmounts(rank) {
  assert.ok([1, 2, 4].includes(rank), "real fictional employer rank required");
  return {
    grossPay: (1000 + rank * 100).toFixed(2),
    netPay: (800 + rank * 75).toFixed(2),
    deductions: (200 + rank * 25).toFixed(2),
  };
}

// A strict quoted-CSV reader, including escaped embedded quotes and newlines.
// The endpoint quotes every field. Reject partial, malformed and extra columns.
export function parseQuotedJournalCsv(input) {
  assert.equal(typeof input, "string", "CSV body must be text");
  assert.ok(input.length > 0 && input.length < 128_000, "CSV body size must be bounded");
  const rows = [], row = [];
  let value = "", quoted = false, expectingQuote = true, justClosed = false;
  const finishCell = () => {
    row.push(value);
    value = "";
    quoted = false;
    expectingQuote = true;
    justClosed = false;
  };
  const finishRow = () => {
    assert.equal(row.length, 8, "CSV must have exactly eight source columns");
    rows.push([...row]);
    row.length = 0;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (expectingQuote) {
      assert.equal(ch, '"', "CSV field must be quoted");
      expectingQuote = false;
      quoted = true;
      continue;
    }
    if (quoted) {
      if (ch !== '"') { value += ch; continue; }
      if (input[i + 1] === '"') { value += '"'; i++; continue; }
      quoted = false;
      justClosed = true;
      continue;
    }
    assert.ok(justClosed, "CSV field must be terminated");
    if (ch === ",") { finishCell(); continue; }
    if (ch === "\r" && input[i + 1] === "\n") i++;
    else assert.equal(ch, "\n", "CSV delimiter must be comma or line ending");
    finishCell();
    finishRow();
  }
  if (justClosed) { finishCell(); finishRow(); }
  else assert.ok(expectingQuote && row.length === 0,
    "CSV must end on a complete field, not an empty or partial row");
  assert.ok(rows.length >= 2, "CSV must contain a header and real journal lines");
  assert.deepEqual(rows[0], JOURNAL_COLUMNS);
  return rows.slice(1);
}

export function proveJournalResponse(response, expected) {
  assert.equal(response?.status, 200, "own token must reach real authorized journal HTTP");
  assert.match(response.headers.get("content-type") ?? "", /^text\/csv(?:;|$)/i);
  assert.match(response.headers.get("content-disposition") ?? "",
    /^attachment; filename=linaw-payroll-journal\.csv$/);
  // Next may normalize "no-store" to "no-store, max-age=0" in production.
  // Require the actual no-store directive and refuse any cacheable or shared-
  // cache allowance instead of relying on byte-for-byte header equality.
  const cacheDirectives = (response.headers.get("cache-control") ?? "")
    .toLowerCase().split(",").map(value => value.trim());
  assert.ok(cacheDirectives.includes("no-store"), "journal response must be no-store");
  for (const directive of cacheDirectives) {
    assert.ok(!/^(public|immutable)$/.test(directive) &&
      !/^(s-maxage|stale-while-revalidate|stale-if-error)(?:\s*=|$)/.test(directive),
    "journal response cannot allow shared or stale caching");
    if (/^max-age(?:\s*=|$)/.test(directive)) {
      assert.match(directive, /^max-age\s*=\s*0$/,
        "journal max-age must be precisely zero");
    }
  }
  for (const forbidden of expected.forbiddenMarkers ?? []) {
    assert.ok(forbidden && !response.text.includes(forbidden),
      "journal must not return another employer or an excluded run");
  }
  for (const forbidden of expected.forbiddenTokens ?? []) {
    assert.ok(forbidden && !response.text.includes(forbidden),
      "journal must never contain authentication tokens");
  }
  const rows = parseQuotedJournalCsv(response.text);
  const amount = fictionalJournalAmounts(expected.rank);
  const common = [
    String(expected.runId), String(expected.entityId), JOURNAL_WINDOW.payDate,
    expected.periodLabel,
  ];
  assert.deepEqual(rows, [
    [...common, "6000", "Payroll expense", amount.grossPay, "0.00"],
    [...common, "2100", "Payroll deductions control", "0.00", amount.deductions],
    [...common, "2200", "Net payroll payable", "0.00", amount.netPay],
  ], "CSV must bind exactly one own released run and centavo-exact balanced entries");
  return rows;
}

export function assertJournalDenial(response, status, forbidden = []) {
  assert.equal(response?.status, status, "unauthorized token/scope/entity must be refused");
  assert.ok(response.text.length < 2000, "denial must be bounded and uninformative");
  assert.ok(!response.text.includes('"Payroll run ID"'),
    "a rejected request must never return a payroll journal");
  for (const text of forbidden) {
    assert.ok(text && !response.text.includes(text),
      "denial must not disclose payroll or bearer markers");
  }
}

export function assertJournalAuditIncrement(before, after, { orgId, entityId, keyId, count }) {
  assert.ok(Array.isArray(before) && Array.isArray(after));
  assert.equal(after.length, before.length + count, "export audit count must be exact");
  assert.deepEqual(after.slice(0, before.length), before,
    "old journal audit evidence must be retained");
  const additions = after.slice(before.length);
  for (const row of additions) {
    assert.equal(row.organizationId, orgId);
    assert.equal(row.actor, "api_key:" + keyId);
    assert.equal(row.action, "API payroll accounting journal exported");
    assert.equal(row.resource, "payroll-journal");
    assert.deepEqual(row.metadata, {
      startDate: JOURNAL_WINDOW.startDate, endDate: JOURNAL_WINDOW.endDate,
      legalEntityId: entityId, runCount: 1, lineCount: 3,
    });
  }
}
