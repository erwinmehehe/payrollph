/**
 * Proof candidate for POST and PATCH /api/spend.
 * Fictional PostgreSQL 16 + real production-mode Next HTTP, no provider calls.
 * Does NOT credit any method without independent review and exact-head success.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

function requireDisposable(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    APP_BASE_URL: "https://payroll.example.test",
    SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "false", DEMO_MODE: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    WFM_LOYVERSE_POS_ENABLED: "false", WFM_SQUARE_SANDBOX_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(env[key], value, "SPEND_PROOF_REFUSED: " + key);
  }
  for (const key of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY",
    "DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID", "DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "WFM_LOYVERSE_ACCESS_TOKEN", "WFM_SQUARE_SANDBOX_ACCESS_TOKEN",
  ]) assert.ok(!env[key], "SPEND_PROOF_REFUSED: provider or production secret " + key);
}
requireDisposable(); // MUST run before any application or database module loads.

const [
  { db, pool }, s, { and, eq, asc }, fixture, { auditBusinessSnapshot },
] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("drizzle-orm"),
  import("./tenant-table-http.mjs"),
  import("./tenant-table-invariants.mjs"),
]);
fixture.requireTenantTableDisposable();

const tables = [
  ["cards", s.spendCards], ["transactions", s.spendCardTransactions],
  ["policies", s.expenseCategoryPolicies],
  ["claims", s.expenseClaims], ["evidence", s.expenseClaimEvidence],
  ["reports", s.expenseReports], ["items", s.expenseReportItems],
  ["audit", s.auditEvents],
];
async function state(orgId) {
  const result = {};
  for (const [name, table] of tables) {
    const stableId = name === "evidence" ? s.expenseClaimEvidence.claimId : table.id;
    const rows = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(stableId));
    result[name] = name === "audit" ? auditBusinessSnapshot(rows) : rows;
  }
  return result;
}
async function insert(table, values) {
  const [row] = await db.insert(table).values(values).returning();
  assert.ok(row?.id || row?.claimId);
  return row;
}
async function setup(actor) {
  const submitter = await insert(s.users, {
    email: actor.marker.toLowerCase() + "-maker@example.invalid",
    name: actor.marker + " synthetic report maker",
    passwordHash: "non-login-fictional-fixture", role: "owner", totpEnabled: true,
  });
  await db.insert(s.userOrganizations).values({
    userId: submitter.id, organizationId: actor.org.id, role: "owner", active: true,
  });
  const makerSession = await fixture.standaloneMakeSession(submitter.id);
  const card = await insert(s.spendCards, {
    organizationId: actor.org.id, employeeId: actor.worker.id,
    issuer: actor.marker + " seeded card", lastFour: "9012",
    reference: actor.marker + "-existing-card",
  });
  const approveClaim = await insert(s.expenseClaims, {
    organizationId: actor.org.id, employeeId: actor.worker.id,
    submittedByUserId: submitter.id, category: "Travel",
    description: actor.marker + " independent reimbursement",
    amount: "150.00", incurredOn: "2026-10-12",
  });
  const rejectClaim = await insert(s.expenseClaims, {
    organizationId: actor.org.id, employeeId: actor.worker.id,
    submittedByUserId: submitter.id, category: "Travel",
    description: actor.marker + " rejection candidate",
    amount: "75.00", incurredOn: "2026-10-13",
  });
  const rejectReport = await insert(s.expenseReports, {
    organizationId: actor.org.id, employeeId: actor.worker.id,
    title: actor.marker + " previously submitted expense",
    totalAmount: "75.00", submittedByUserId: submitter.id,
    status: "submitted",
  });
  await db.insert(s.expenseReportItems).values({
    organizationId: actor.org.id, reportId: rejectReport.id, claimId: rejectClaim.id,
  });
  return { actor, submitter, makerCookie: makerSession.cookie, card,
    approveClaim, rejectClaim, rejectReport };
}
async function request(cookie, method, body) {
  return fixture.standaloneRequest("/api/spend", { cookie, method, body });
}
function good(response, status, label) {
  fixture.standaloneExpectStatus(response, status, label);
  assert.equal(typeof response.json, "object", label + ": expected JSON");
  return response.json;
}
async function denied(own, method, body, status, label) {
  const beforeOwn = await state(own.actor.org.id);
  const beforeVictim = await state(victim.actor.org.id);
  const response = await request(own.actor.cookie, method, body);
  good(response, status, label);
  assert.ok(!response.text.includes(victim.actor.marker), label + ": victim marker leaked");
  assert.deepEqual(await state(own.actor.org.id), beforeOwn, label + ": denied write changed attacker");
  assert.deepEqual(await state(victim.actor.org.id), beforeVictim, label + ": denied write changed victim");
}

let victim;
try {
  for (const table of [s.organizations, s.users, s.auditEvents, s.expenseReports]) {
    assert.equal((await db.select().from(table).limit(1)).length, 0,
      "SPEND_PROOF_REFUSED: fictional database must start empty");
  }
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const employers = [];
  for (const label of ["ATTA", "ATTB", "VICTIM"]) {
    const actor = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
    employers.push(await setup(actor));
  }
  const [a,b,v] = employers; victim = v;
  for (const own of [a,b]) {
    assert.ok(v.actor.org.id > own.actor.org.id && v.actor.worker.id > own.actor.worker.id &&
      v.card.id > own.card.id && v.approveClaim.id > own.approveClaim.id &&
      v.rejectReport.id > own.rejectReport.id, "real victim IDs must be higher than attacker IDs");
  }
  const victimBefore = await state(v.actor.org.id);
  const results = [];
  for (const own of [a,b]) {
    const actor = own.actor;
    const other = own === a ? b : a;
    const otherBefore = await state(other.actor.org.id);
    const category = {
      organizationId: actor.org.id, action: "category_policy", category: "Travel",
      taxable: false, reviewReference: actor.marker + " reviewed travel policy",
    };
    const policy = good(await request(actor.cookie, "POST", category), 201, "own category review");
    assert.equal(policy.organizationId, actor.org.id);
    assert.equal(policy.reviewedByUserId, actor.owner.id);
    assert.equal(policy.category, "Travel");
    await denied(own, "POST", { ...category, organizationId: v.actor.org.id },
      403, "foreign category review");
    const evidence = await insert(s.expenseClaimEvidence, {
      claimId: own.approveClaim.id,
      organizationId: actor.org.id, employeeId: actor.worker.id,
      categoryPolicyId: policy.id, taxable: false,
      receiptStorageKey: "private-documents/" + actor.org.id + "/" + actor.worker.id + "/" + randomUUID(),
      receiptSha256: createHash("sha256").update(actor.marker).digest("hex"),
      receiptByteSize: 5, receiptVerifiedAt: new Date(),
      receiptMime: "application/pdf", receiptFileName: "fictional-scan.pdf",
    });
    assert.equal(evidence.organizationId, actor.org.id);

    const cardBody = {
      organizationId: actor.org.id, action: "card",
      employeeId: actor.worker.id, issuer: actor.marker + " verified card",
      lastFour: "4321", reference: actor.marker + "-new-card",
    };
    const card = good(await request(actor.cookie, "POST", cardBody), 201, "own card");
    assert.equal(card.organizationId, actor.org.id);
    assert.equal(card.employeeId, actor.worker.id);
    await denied(own, "POST", { ...cardBody, organizationId: v.actor.org.id },
      403, "foreign card registration");
    await denied(own, "POST", { ...cardBody, employeeId: v.actor.worker.id },
      404, "forged victim employee");

    const chargeBody = {
      organizationId: actor.org.id, action: "transaction",
      cardId: card.id, amount: "12.34", spentOn: "2026-10-14",
      merchant: actor.marker + " synthetic merchant",
      externalReference: actor.marker + "-tx-" + nonce,
    };
    const tx = good(await request(actor.cookie, "POST", chargeBody), 201, "own card transaction");
    assert.equal(tx.organizationId, actor.org.id);
    assert.equal(tx.cardId, card.id);
    await denied(own, "POST", { ...chargeBody, organizationId: v.actor.org.id },
      403, "foreign card transaction");
    await denied(own, "POST", { ...chargeBody, cardId: v.card.id },
      404, "forged foreign card");

    const reportBody = {
      organizationId: actor.org.id, action: "report", employeeId: actor.worker.id,
      claimIds: [own.approveClaim.id], title: actor.marker + " actual report",
    };
    const report = good(await request(actor.cookie, "POST", reportBody), 201, "own report");
    assert.equal(report.organizationId, actor.org.id);
    assert.equal(report.employeeId, actor.worker.id);
    await denied(own, "POST", {
      ...reportBody, organizationId: v.actor.org.id, employeeId: v.actor.worker.id,
      claimIds: [v.approveClaim.id],
    }, 403, "foreign expense report");
    await denied(own, "POST", { ...reportBody, claimIds: [v.approveClaim.id] },
      409, "forged victim claim in own report");

    // A report maker is an actual active employer owner, but cannot approve
    // the report they submitted. Checking before approval proves separation.
    const maker = await request(own.makerCookie, "PATCH", {
      id: report.id, status: "approved", note: "should never pass",
    });
    good(maker, 403, "maker-checker separation");
    const beforeDecision = await state(actor.org.id);
    const approve = good(await request(actor.cookie, "PATCH", {
      id: report.id, status: "approved", note: actor.marker + " independent review",
    }), 200, "own independent approval");
    assert.equal(approve.id, report.id);
    assert.equal(approve.organizationId, actor.org.id);
    assert.equal(approve.status, "approved");
    const afterDecision = await state(actor.org.id);
    const approved = afterDecision.claims.find(row => row.id === own.approveClaim.id);
    const approvedEvidence = afterDecision.evidence.find(row => row.claimId === own.approveClaim.id);
    assert.equal(approved.status, "approved");
    assert.equal(approved.decidedBy, actor.owner.name);
    assert.equal(approvedEvidence.approvedByUserId, actor.owner.id);
    assert.equal(approvedEvidence.approvedAmount, "150.00");
    assert.ok(approvedEvidence.approvedAt instanceof Date);
    assert.ok(afterDecision.audit.length === beforeDecision.audit.length + 1);
    await denied(own, "PATCH", { id: v.rejectReport.id, status: "rejected" },
      403, "foreign report decision");
    await denied(own, "PATCH", {
      organizationId: actor.org.id, id: v.rejectReport.id, status: "rejected",
    }, 403, "forged employer in victim report decision");

    const reject = good(await request(actor.cookie, "PATCH", {
      id: own.rejectReport.id, status: "rejected",
      note: actor.marker + " rejection reason",
    }), 200, "own independent rejection");
    assert.equal(reject.status, "rejected");
    const ownAfter = await state(actor.org.id);
    const rejectedClaim = ownAfter.claims.find(row => row.id === own.rejectClaim.id);
    assert.equal(rejectedClaim.status, "rejected");
    assert.equal(rejectedClaim.payrollRunId, null);
    assert.equal(ownAfter.transactions.length, 1, "one card charge metadata only");
    assert.equal(ownAfter.reports.length, 2, "one seeded and one newly submitted report");
    assert.equal(ownAfter.policies.length, 1);
    assert.equal(ownAfter.cards.length, 2, "one seeded and one newly registered card");
    assert.equal(ownAfter.audit.length, 6,
      "policy, card, charge, submission, independent approval and rejection each require an audit");
    assert.deepEqual(await state(other.actor.org.id), otherBefore,
      "an attacker may never mutate the other independent employer");
    assert.deepEqual(await state(v.actor.org.id), victimBefore,
      "no positive or refused operation may mutate the higher-ID victim");
    results.push({ attackerOrgId: actor.org.id,
      created: ["category_policy", "card", "transaction", "report"],
      decided: ["approved", "rejected"], foreignAndForgedDenied: true,
      makerCheckerDenied: true, auditEvents: ownAfter.audit.length });
  }
  assert.equal(results.length, 2);
  console.log(JSON.stringify({
    target: "POST and PATCH /api/spend",
    runner: "fictional-pg16-production-next-real-http",
    realHigherIdVictim: true, independentAttackers: 2,
    postActions: ["category_policy", "card", "transaction", "report"],
    patchDecisions: ["approved", "rejected"],
    foreignAndForgedDenied: true, actualSqlStateVerified: true,
    higherIdVictimImmutable: true, providerCalls: 0, payouts: 0,
    methodCredits: 0, independentlyAccepted: false, productionCertified: false,
  }));
} finally {
  await pool.end();
}
