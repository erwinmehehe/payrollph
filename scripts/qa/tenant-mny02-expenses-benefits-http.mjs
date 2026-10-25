/**
 * MNY-02 follow-up: actual own/foreign two-attacker HTTP/PG16 method proof
 * for legacy expense claims and de minimis benefits. Disposable fixture only.
 * No reimbursement payout, statutory filing, live employee or provider.
 * Expense claim proof here covers flag-OFF mode; reviewed Spend feature-ON
 * requires its separate full-path acceptance and is not certified by this suite.
 * Never claim all of MNY-02 or the 338 original gaps are accepted.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, deMinimisGrants, expenseClaims, payrollRuns, userOrganizations, users } from "../../src/db/schema";
import { spendPayrollEnabled } from "../../src/lib/spend-claim-evidence";

export const PROVED_METHODS = Object.freeze([
  "GET expenses", "POST expenses", "PATCH expenses",
  "GET de-minimis", "POST de-minimis", "DELETE de-minimis",
]);
const INCURRED = "2026-10-20";
const BENEFIT_DATE = "2026-10-20";

function requireDisposable() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
  assert.equal(spendPayrollEnabled(), false,
    "This specific legacy expenses proof must never claim reviewed Spend feature-ON acceptance");
}
async function victimSnapshot(organizationId) {
  return {
    expenses: await db.select().from(expenseClaims)
      .where(eq(expenseClaims.organizationId, organizationId)).orderBy(expenseClaims.id),
    benefits: await db.select().from(deMinimisGrants)
      .where(eq(deMinimisGrants.organizationId, organizationId)).orderBy(deMinimisGrants.id),
    audit: await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId)).orderBy(auditEvents.id),
    payroll: await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId)).orderBy(payrollRuns.id),
  };
}
function noVictimLeak(response, sentinel) {
  assert.ok(!response.text.includes(sentinel),
    "Victim-only employee/financial description leaked into response");
  assert.ok(![...response.headers].some(([key, value]) =>
    (key + ": " + value).includes(sentinel)), "Victim-only identity leaked in header");
}
async function createExpense({ request, expectStatus }, org, employeeId, cookie, label) {
  const response = expectStatus(await request("/api/expenses", {
    method: "POST", cookie, body: {
      organizationId: org.id, employeeId, description: label,
      amount: 127.25, incurredOn: INCURRED, category: "Other",
    },
  }), 201, "Own real expense claim POST must persist (not an anonymous denial)");
  assert.equal(response.json?.organizationId, org.id);
  assert.equal(response.json?.employeeId, employeeId);
  assert.equal(response.json?.description, label);
  const [saved] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, response.json.id));
  assert.equal(saved?.organizationId, org.id);
  assert.equal(saved?.employeeId, employeeId);
  assert.equal(saved?.status, "pending");
  return saved;
}
async function createBenefit({ request, expectStatus }, org, employeeId, cookie) {
  const response = expectStatus(await request("/api/de-minimis", {
    method: "POST", cookie, body: {
      organizationId: org.id, employeeId, benefitType: "riceSubsidy",
      amount: 150, effectiveOn: BENEFIT_DATE,
    },
  }), 201, "Own valid 2026 de minimis POST must persist a real benefit grant");
  assert.equal(response.json?.grant?.organizationId, org.id);
  assert.equal(response.json?.grant?.employeeId, employeeId);
  assert.equal(response.json?.grant?.benefitType, "riceSubsidy");
  const [saved] = await db.select().from(deMinimisGrants)
    .where(eq(deMinimisGrants.id, response.json.grant.id));
  assert.equal(saved?.organizationId, org.id);
  assert.equal(saved?.employeeId, employeeId);
  assert.equal(saved?.active, true);
  return saved;
}
async function makeIndependentChecker(org, makeSession) {
  const [checker] = await db.insert(users).values({
    email: "mny02-checker-" + randomUUID() + "@example.invalid",
    name: "Fictional independent expense checker",
    passwordHash: "fictional-test-session-only", role: "owner",
    totpEnabled: true,
  }).returning({ id: users.id });
  await db.insert(userOrganizations).values({
    userId: checker.id, organizationId: org.id, role: "owner", active: true,
  });
  const session = await makeSession(checker.id, { privileged: true });
  return { userId: checker.id, cookie: session.cookie };
}
export async function verifyMny02ExpensesBenefitsIsolation(f, { request, expectStatus, makeSession }) {
  requireDisposable();
  const http = { request, expectStatus };
  const victim = f.orgs[0];
  const victimEmployee = f.victimEmployee;
  const sentinel = "MNY02-EXPENSE-VICTIM-ONLY-" + randomUUID();
  const attackers = [];
  // Two independent authenticated employers first create populated own records.
  for (const idx of [1, 2]) {
    const org = f.orgs[idx], cookie = f.ownerSessions[idx].cookie;
    const employeeId = f.ownedEmployees[idx - 1].id;
    const checker = await makeIndependentChecker(org, makeSession);
    const ownExpenses = [];
    const ownBenefits = [];
    for (let k = 0; k < 3; k++) {
      ownExpenses.push(await createExpense(http, org, employeeId, cookie,
        "MNY02-OWN-" + idx + "-" + k));
      ownBenefits.push(await createBenefit(http, org, employeeId, cookie));
    }
    attackers.push({ org, cookie, checker, employeeId, ownExpenses, ownBenefits });
  }
  // Seed genuine victim-only high IDs, not a guessed ID or an empty row set.
  const victimExpenses = [], victimBenefits = [];
  for (let k = 0; k < 7; k++) {
    victimExpenses.push(await createExpense(http, victim, victimEmployee.id,
      f.ownerSessions[0].cookie, sentinel + "-" + k));
    victimBenefits.push(await createBenefit(http, victim, victimEmployee.id,
      f.ownerSessions[0].cookie));
  }
  const victimExpense = victimExpenses.at(-1);
  const victimGrant = victimBenefits.at(-1);
  assert.ok(victimExpense.id > 6 && victimGrant.id > 6,
    "Actual victim expense and benefit IDs must both be high real persisted IDs");
  assert.ok(attackers.every(a => a.ownExpenses.every(e => e.id < victimExpense.id) &&
    a.ownBenefits.every(g => g.id < victimGrant.id)));
  const [savedVictimExpense] = await db.select().from(expenseClaims)
    .where(eq(expenseClaims.id, victimExpense.id));
  const [savedVictimGrant] = await db.select().from(deMinimisGrants)
    .where(eq(deMinimisGrants.id, victimGrant.id));
  assert.equal(savedVictimExpense.organizationId, victim.id);
  assert.equal(savedVictimGrant.organizationId, victim.id);
  const baseline = await victimSnapshot(victim.id);

  for (const a of attackers) {
    const { org, cookie, checker, employeeId, ownExpenses, ownBenefits } = a;
    const ownExpenseGet = expectStatus(await request("/api/expenses?organizationId=" + org.id, {
      cookie,
    }), 200, "Own expense GET must return populated real claim data");
    assert.ok(ownExpenses.every(item => ownExpenseGet.json?.claims?.some(row =>
      row.id === item.id && row.organizationId === org.id && row.employeeId === employeeId)));
    assert.ok(!ownExpenseGet.json?.claims?.some(row => row.id === victimExpense.id));
    const foreignExpenseGet = expectStatus(await request("/api/expenses?organizationId=" + victim.id, {
      cookie,
    }), 403, "Foreign employer expense claim GET denied");
    noVictimLeak(foreignExpenseGet, sentinel);
    const forgedExpenseGet = expectStatus(await request("/api/expenses?organizationId=" +
      org.id + "&employeeId=" + victimEmployee.id, { cookie }),
    200, "Forged victim employee selector cannot escape own employer");
    assert.ok(forgedExpenseGet.json?.claims?.some(row => row.id === ownExpenses[0].id));
    assert.ok(!forgedExpenseGet.json?.claims?.some(row => row.id === victimExpense.id));
    const foreignExpensePost = expectStatus(await request("/api/expenses", {
      method: "POST", cookie, body: {
        organizationId: victim.id, employeeId: victimEmployee.id,
        amount: 99.25, description: "FORGED-VICTIM-EXPENSE", category: "Other", incurredOn: INCURRED,
      },
    }), 403, "Foreign expense POST denied before insert");
    noVictimLeak(foreignExpensePost, sentinel);
    const wrongEmployeePost = expectStatus(await request("/api/expenses", {
      method: "POST", cookie, body: {
        organizationId: org.id, employeeId: victimEmployee.id,
        amount: 99.25, description: "FORGED-FOREIGN-WORKER", category: "Other", incurredOn: INCURRED,
      },
    }), 404, "Owned organization cannot create expense for foreign employee ID");
    noVictimLeak(wrongEmployeePost, sentinel);

    const selfReview = expectStatus(await request("/api/expenses", {
      method: "PATCH", cookie, body: { id: ownExpenses[0].id, status: "rejected" },
    }), 403, "Maker cannot approve or reject their own expense");
    assert.match(selfReview.json?.error ?? "", /cannot approve or reject/i);
    const ownExpensePatch = expectStatus(await request("/api/expenses", {
      method: "PATCH", cookie: checker.cookie, body: {
        id: ownExpenses[0].id, organizationId: victim.id, status: "rejected",
      },
    }), 200, "Independent same-employer checker can reject own claim despite forged employer");
    assert.equal(ownExpensePatch.json?.organizationId, org.id);
    assert.equal(ownExpensePatch.json?.status, "rejected");
    const [storedOwnDecision] = await db.select().from(expenseClaims)
      .where(eq(expenseClaims.id, ownExpenses[0].id));
    assert.equal(storedOwnDecision?.status, "rejected");
    assert.equal(storedOwnDecision?.organizationId, org.id);
    const foreignExpensePatch = expectStatus(await request("/api/expenses", {
      method: "PATCH", cookie: checker.cookie, body: {
        id: victimExpense.id, organizationId: org.id, status: "rejected",
      },
    }), 403, "Actual foreign claim PATCH denied before modifying victim row");
    noVictimLeak(foreignExpensePatch, sentinel);

    const ownBenefitGet = expectStatus(await request("/api/de-minimis?organizationId=" + org.id, {
      cookie,
    }), 200, "Own de minimis GET must return persisted benefits");
    assert.ok(ownBenefits.every(grant => ownBenefitGet.json?.grants?.some(row =>
      row.id === grant.id && row.organizationId === org.id && row.employeeId === employeeId)));
    assert.ok(!ownBenefitGet.json?.grants?.some(row => row.id === victimGrant.id));
    const foreignBenefitGet = expectStatus(await request("/api/de-minimis?organizationId=" + victim.id, {
      cookie,
    }), 403, "Foreign de minimis benefits GET denied");
    noVictimLeak(foreignBenefitGet, sentinel);
    const foreignBenefitPost = expectStatus(await request("/api/de-minimis", {
      method: "POST", cookie, body: {
        organizationId: victim.id, employeeId: victimEmployee.id,
        benefitType: "riceSubsidy", amount: 150, effectiveOn: BENEFIT_DATE,
      },
    }), 403, "Foreign de minimis benefit POST denied");
    noVictimLeak(foreignBenefitPost, sentinel);
    const crossWorkerBenefitPost = expectStatus(await request("/api/de-minimis", {
      method: "POST", cookie, body: {
        organizationId: org.id, employeeId: victimEmployee.id,
        benefitType: "riceSubsidy", amount: 150, effectiveOn: BENEFIT_DATE,
      },
    }), 404, "Employer cannot award de minimis benefit to victim-only employee");
    noVictimLeak(crossWorkerBenefitPost, sentinel);

    const foreignBenefitDelete = expectStatus(await request(
      "/api/de-minimis?id=" + victimGrant.id + "&organizationId=" + org.id, {
        method: "DELETE", cookie,
      }),
    403, "Real victim-only de minimis grant DELETE denied");
    noVictimLeak(foreignBenefitDelete, sentinel);
    const ownBenefitDelete = expectStatus(await request(
      "/api/de-minimis?id=" + ownBenefits[0].id + "&organizationId=" + victim.id, {
        method: "DELETE", cookie,
      }),
    200, "Owned grant can be ended, ignoring forged organization selector");
    assert.equal(ownBenefitDelete.json?.ok, true);
    const [endedOwned] = await db.select().from(deMinimisGrants)
      .where(eq(deMinimisGrants.id, ownBenefits[0].id));
    assert.equal(endedOwned?.organizationId, org.id);
    assert.equal(endedOwned?.active, false);
    assert.equal(endedOwned?.endedOn, new Date().toISOString().slice(0, 10));
  }
  assert.deepEqual(await victimSnapshot(victim.id), baseline,
    "Every denied/forged expense and de minimis request leaves victim financial rows, audit and payroll exactly unchanged");
  console.log("MNY02-EXPENSES-BENEFITS PASS: 6 actual methods, 2 attacker employers, real victim high IDs, own 201/200, foreign 403/404 and immutable victim PG16 snapshots; legacy expenses flag-OFF only");
}
