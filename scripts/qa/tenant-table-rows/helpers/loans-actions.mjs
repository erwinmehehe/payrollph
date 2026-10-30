/**
 * PATCH loans: every action except pause (the row's own action): approve, reject, resume, record_payment, close.
 * approve and resume are locked unless PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED is true, so this runs only in the
 * disposable flagged profile with fictional employers; no payroll run is created, processed or released.
 * Lives outside write/ so the family loader does not treat it as a row file.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

/** Called from the row's seed: one loan per action, so each action has its own untouched target. */
export async function seedActionLoans({ db, employeeLoans, loanPayments }, e, checkerId) {
  const base = { organizationId: e.org.id, employeeId: e.worker.id, loanType: "Company Emergency Loan", monthlyAmortization: "200.00", cutoffDeduction: "100.00",
    deductionAuthorizationReference: e.marker + " fictional source authority", startDate: "2099-01-01", notes: e.marker };
  const reviewed = (reviewerId) => ({ reviewedByUserId: reviewerId, reviewedAt: new Date("2026-01-05T00:00:00.000Z"),
    reviewEvidenceReference: e.marker + " fictional independent review evidence", reviewReason: e.marker + " fictitious historical reviewer acceptance" });
  const insert = async (name, values) => (await db.insert(employeeLoans).values({ ...base, referenceNo: e.marker + "-" + name, ...values }).returning())[0].id;
  // The maker is the other user, so the signed-in owner is an independent decision-maker for approve, reject and resume.
  const approve = await insert("APPROVE", { principal: "1200.00", remainingBalance: "1200.00", totalPaid: "0.00", status: "pending_approval", requestedByUserId: checkerId });
  const self = await insert("SELF", { principal: "1200.00", remainingBalance: "1200.00", totalPaid: "0.00", status: "pending_approval", requestedByUserId: e.owner.id });
  const reject = await insert("REJECT", { principal: "1200.00", remainingBalance: "1200.00", totalPaid: "0.00", status: "pending_approval", requestedByUserId: checkerId });
  const resume = await insert("RESUME", { principal: "1500.00", remainingBalance: "1000.00", totalPaid: "500.00", status: "paused", requestedByUserId: checkerId, ...reviewed(e.owner.id) });
  const payment = await insert("PAYMENT", { principal: "1500.00", remainingBalance: "1000.00", totalPaid: "500.00", status: "active", requestedByUserId: e.owner.id, ...reviewed(checkerId) });
  const close = await insert("CLOSE", { principal: "1500.00", remainingBalance: "0.00", totalPaid: "1500.00", status: "active", requestedByUserId: e.owner.id, ...reviewed(checkerId) });
  await db.insert(loanPayments).values({ loanId: payment, amount: "500.00", paymentDate: "2026-01-05", reference: e.marker + " fictional historical receipt" });
  await db.insert(loanPayments).values({ loanId: close, amount: "1500.00", paymentDate: "2026-01-05", reference: e.marker + " fictional final receipt" });
  return { approve, self, reject, resume, payment, close };
}

export async function loanActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, { request, expectStatus, cookie }) {
  const s = await tables();
  const url = "/api/loans";
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => JSON.parse(JSON.stringify({
    loans: await read(s.employeeLoans, orgId),
    payments: (await db.select({ payment: s.loanPayments }).from(s.loanPayments).innerJoin(s.employeeLoans, eq(s.employeeLoans.id, s.loanPayments.loanId))
      .where(eq(s.employeeLoans.organizationId, orgId)).orderBy(asc(s.loanPayments.id))).map((r) => r.payment),
    runs: await read(s.payrollRuns, orgId),
    audit: auditBusinessSnapshot(await read(s.auditEvents, orgId)),
  }));
  const patch = async (body, status, label) => expectStatus(await request(url, { method: "PATCH", cookie, body }), status, label);
  const victimBefore = await snapshot(c.victim.org.id);
  const refused = async (body, status, label) => {
    const own = await snapshot(c.orgId);
    const response = await patch(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await snapshot(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };
  const evidence = { reviewEvidenceReference: c.marker + " fictional independent review evidence", reviewReason: c.marker + " fictional independent decision reason" };
  const bodyFor = (id, action, extra) => ({ id, action, ...extra });
  const oneAudit = (before, after, action, id) => {
    assert.equal(after.audit.length, before.audit.length + 1, action + ": exactly one audit receipt");
    assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId); assert.equal(audit.actor, c.owner.name);
    assert.equal(audit.action, "Employee loan: " + action);
    assert.equal(audit.metadata.loanId, id); assert.equal(audit.metadata.actorUserId, c.owner.id);
    return audit;
  };
  const only = (before, after, id) => {
    assert.deepEqual(after.loans.filter((l) => l.id !== id), before.loans.filter((l) => l.id !== id), "only the target loan changes");
    assert.deepEqual(after.runs, before.runs, "no payroll run is created, processed or released");
  };
  const loan = (snap, id) => snap.loans.find((l) => l.id === id);

  // Every action is first refused against the victim's matching loan (a different employer, so 403) and writes nothing.
  const targets = { approve: ["approve", evidence], reject: ["reject", evidence], resume: ["resume", evidence],
    record_payment: ["payment", { amount: "100.00", reference: c.marker + "-RECEIPT-1" }], close: ["close", { reviewReason: c.marker + " fictional close reason" }] };
  for (const [action, [key, extra]] of Object.entries(targets)) {
    await refused(bodyFor(c.victimSeeded.extras[key], action, extra), 403, "victim employer loan " + action);
  }

  // approve: an independent reviewer activates a pending loan.
  let before = await snapshot(c.orgId);
  const approved = await patch(bodyFor(c.seeded.extras.approve, "approve", evidence), 200, "own approve");
  let after = await snapshot(c.orgId);
  assert.equal(approved.json?.status, "active");
  let row = loan(after, c.seeded.extras.approve);
  assert.equal(loan(before, row.id).status, "pending_approval");
  assert.equal(row.status, "active"); assert.equal(row.organizationId, c.orgId); assert.equal(row.reviewedByUserId, c.owner.id);
  assert.notEqual(row.requestedByUserId, c.owner.id, "the maker is not the approver");
  assert.equal(row.reviewEvidenceReference, evidence.reviewEvidenceReference);
  only(before, after, row.id); oneAudit(before, after, "approve", row.id);

  // reject: the same reviewer rejects a different pending loan.
  before = after;
  await patch(bodyFor(c.seeded.extras.reject, "reject", { reviewReason: evidence.reviewReason }), 200, "own reject");
  after = await snapshot(c.orgId);
  row = loan(after, c.seeded.extras.reject);
  assert.equal(row.status, "rejected"); assert.equal(row.reviewedByUserId, c.owner.id); assert.equal(row.reviewReason, evidence.reviewReason);
  only(before, after, row.id); oneAudit(before, after, "reject", row.id);

  // resume: a paused loan is reactivated by someone other than its maker.
  before = after;
  await patch(bodyFor(c.seeded.extras.resume, "resume", evidence), 200, "own resume");
  after = await snapshot(c.orgId);
  row = loan(after, c.seeded.extras.resume);
  assert.equal(loan(before, row.id).status, "paused"); assert.equal(row.status, "active"); assert.equal(row.reviewedByUserId, c.owner.id);
  only(before, after, row.id); oneAudit(before, after, "resume", row.id);
  // The maker-checker rule holds: the owner cannot approve a loan the owner registered.
  await refused(bodyFor(c.seeded.extras.self, "approve", evidence), 409, "self-approval of an own-registered loan");

  // record_payment: an external payment reduces the balance once; a repeat reference or an overpayment is refused.
  before = await snapshot(c.orgId);
  const paymentBody = (amount, reference) => bodyFor(c.seeded.extras.payment, "record_payment", { amount, reference });
  const paid = await patch(paymentBody("100.00", c.marker + "-RECEIPT-1"), 200, "own record_payment");
  after = await snapshot(c.orgId);
  assert.equal(paid.json?.paymentAmount, "100.00");
  row = loan(after, c.seeded.extras.payment);
  assert.equal(row.remainingBalance, "900.00"); assert.equal(row.totalPaid, "600.00"); assert.equal(row.status, "active");
  assert.equal(after.payments.length, before.payments.length + 1, "exactly one payment is recorded");
  const payment = after.payments.at(-1);
  assert.equal(payment.loanId, row.id); assert.equal(payment.amount, "100.00"); assert.equal(payment.reference, c.marker + "-RECEIPT-1");
  only(before, after, row.id); oneAudit(before, after, "record_payment", row.id);
  await refused(paymentBody("100.00", c.marker + "-RECEIPT-1"), 409, "duplicate payment reference");
  await refused(paymentBody("999999.00", c.marker + "-RECEIPT-2"), 409, "payment above the balance");

  // close: only a zero-balance loan can be closed.
  await refused(bodyFor(c.seeded.extras.payment, "close", { reviewReason: c.marker + " fictional close reason" }), 409, "close with a balance");
  before = await snapshot(c.orgId);
  await patch(bodyFor(c.seeded.extras.close, "close", { reviewReason: c.marker + " fictional close reason" }), 200, "own close");
  after = await snapshot(c.orgId);
  row = loan(after, c.seeded.extras.close);
  assert.equal(loan(before, row.id).status, "active"); assert.equal(row.status, "paid_off");
  only(before, after, row.id); oneAudit(before, after, "close", row.id);
  return { actions: ["approve", "reject", "resume", "record_payment", "close"], victimEmployerDenials: 5, refusedControls: 5 };
}
