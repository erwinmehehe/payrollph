import assert from "node:assert/strict";

/**
 * This is a read-only loan preview, not a loan approval or deduction.
 * CI must refuse any deployed/nonempty target and all payout credentials.
 */
export function requireDisposableLoanPreview(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("LOAN_PREVIEW_PROOF_REFUSED: local targets required");
  }
  const safe =
    env.CI === "true" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" &&
    env.DEMO_MODE === "false" &&
    env.LOAN_SCHEDULE_PREVIEW_ENABLED === "true" &&
    env.PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED === "false" &&
    env.EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED === "false" &&
    app.href === "http://127.0.0.1:3000/" &&
    database.protocol === "postgresql:" &&
    database.hostname === "127.0.0.1" &&
    database.port === "5432" &&
    database.pathname === "/app_db" &&
    database.username === "postgres" &&
    database.password === "postgres" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    !env.PAYMONGO_SECRET_KEY &&
    !env.XENDIT_SECRET_KEY &&
    !env.RESEND_API_KEY;
  if (!safe) {
    throw new Error("LOAN_PREVIEW_PROOF_REFUSED: fictional localhost PostgreSQL 16 with money gates OFF required");
  }
  return true;
}

export function requirePrivateNoStore(headers) {
  const raw = headers?.get?.("cache-control");
  const parts = typeof raw === "string"
    ? raw.toLowerCase().split(",").map(p => p.trim()).filter(Boolean) : [];
  const unsafe = parts.some(p => p === "public" || p === "immutable" ||
    /^s-maxage(?:\s*=|$)/.test(p) ||
    (/^max-age(?:\s*=|$)/.test(p) && !/^max-age\s*=\s*0$/.test(p)));
  if (!parts.includes("no-store") || unsafe) throw new Error("LOAN_PREVIEW_CACHE_UNSAFE");
  return true;
}

const exact = (value, fields, label) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), label + " must be object");
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), label + " unexpected fields");
};

export function previewInputs(rank, marker) {
  assert.ok(Number.isSafeInteger(rank) && rank > 0 && rank < 100);
  assert.match(marker, /^TTBL-(?:ATTA|ATTB|VICTIM)-[a-f0-9]{10}$/);
  return {
    company: {
      kind: "company", principal: String(rank * 1000) + ".01",
      months: 2, installmentsPerMonth: 2, annualFlatInterestBasisPoints: 0,
    },
    agency: {
      kind: "agency", agency: "SSS", loanReference: marker + "-LOAN",
      rows: [{ dueDate: "2099-01-15", amount: String(100 + rank) + ".25",
        sourceRowId: marker + "-ROW1" }],
    },
    floor: {
      kind: "floor", disposablePayCents: 12000 + 2000 * rank,
      minimumNetPayCents: 8000, remainingLoanCents: 20000, requestedCents: 10000,
    },
  };
}

export function proveCompany(body, rank) {
  exact(body, ["mode", "interestBasis", "schedule"], "company preview");
  assert.equal(body.mode, "preview_only");
  assert.match(body.interestBasis, /NOT automatic payroll deduction/);
  exact(body.schedule, ["totalPrincipalCents", "totalInterestCents", "totalPayableCents", "installments"], "schedule");
  const principal = rank * 100000 + 1;
  assert.equal(body.schedule.totalPrincipalCents, principal, "company principal must be employer-distinct and centavo-exact");
  assert.equal(body.schedule.totalInterestCents, 0);
  assert.equal(body.schedule.totalPayableCents, principal);
  assert.ok(Array.isArray(body.schedule.installments) && body.schedule.installments.length === 4);
  const installments = body.schedule.installments;
  assert.equal(installments.reduce((n, x) => n + x.principalCents, 0), principal);
  assert.equal(installments.reduce((n, x) => n + x.dueCents, 0), principal);
  assert.equal(installments.at(-1)?.remainingPayableCents, 0);
  assert.equal(installments.at(-1)?.remainingPrincipalCents, 0);
  return true;
}

export function proveAgency(body, rank, marker) {
  exact(body, ["mode", "imported"], "agency preview");
  assert.equal(body.mode, "preview_only");
  exact(body.imported, ["agency", "loanReference", "rows", "scheduledTotalCents"], "imported agency schedule");
  assert.equal(body.imported.agency, "SSS");
  assert.equal(body.imported.loanReference, marker + "-LOAN");
  assert.equal(body.imported.scheduledTotalCents, (100 + rank) * 100 + 25);
  assert.ok(Array.isArray(body.imported.rows) && body.imported.rows.length === 1);
  assert.deepEqual(body.imported.rows[0], {
    dueDate: "2099-01-15", amount: String(100 + rank) + ".25",
    sourceRowId: marker + "-ROW1", cents: (100 + rank) * 100 + 25,
  });
  return true;
}

export function proveFloor(body, rank) {
  exact(body, ["mode", "deductedCents", "deferredCents", "netAfterCents", "overrideUsed"], "floor preview");
  assert.equal(body.mode, "preview_only");
  const disposable = 12000 + 2000 * rank;
  const deduction = Math.min(10000, 4000 + 2000 * rank);
  assert.equal(body.deductedCents, deduction);
  assert.equal(body.deferredCents, 10000 - deduction);
  assert.equal(body.netAfterCents, disposable - deduction);
  assert.equal(body.overrideUsed, false, "the preview must never authorize a net-pay floor override");
  return true;
}
