// Disposable fictional loan evidence only. Never activate a deduction or record a real payment.
export const fixtureOrder = {};
export function createRows({ assert, db, eq, asc, employeeLoans, loanPayments, payrollRuns, payrollEntries,
  employees, employeePayProfiles, employeePayRevisions, auditEvents, auditBusinessSnapshot, users, userOrganizations }) {
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => ({
    loans: await read(employeeLoans, orgId),
    payments: await db.select({ payment: loanPayments }).from(loanPayments)
      .innerJoin(employeeLoans, eq(employeeLoans.id, loanPayments.loanId)).where(eq(employeeLoans.organizationId, orgId)).orderBy(asc(loanPayments.id)),
    runs: await read(payrollRuns, orgId),
    entries: await db.select({ entry: payrollEntries }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollEntries.payrollRunId)).where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
    workers: await read(employees, orgId), profiles: await read(employeePayProfiles, orgId), revisions: await read(employeePayRevisions, orgId),
    audits: auditBusinessSnapshot(await read(auditEvents, orgId)),
  });
  const retained = (before, after, c) => {
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const key of Object.keys(before)) if (!["loans", "audits"].includes(key)) assert.deepEqual(after[key], before[key], key + " must not change");
    assert.ok(before.profiles.some(row => row.employeeId === c.workerId && row.organizationId === c.orgId), "a real existing pay profile is required");
  };
  const audit = (before, after, c, action, resource, metadata) => {
    assert.equal(after.audits.length, before.audits.length + 1);
    const added = after.audits.filter(row => !before.audits.some(old => old.id === row.id)); assert.equal(added.length, 1);
    const row = added[0]; assert.equal(row.organizationId, c.orgId); assert.equal(row.actor, c.owner.name);
    assert.equal(row.action, action); assert.equal(row.resource, resource); assert.deepEqual(row.metadata, metadata);
    assert.deepEqual(after.audits.filter(item => item.id !== row.id), before.audits);
  };
  const requestBody = (c, organizationId, employeeId) => ({ organizationId, employeeId, loanType: "Company Emergency Loan",
    referenceNo: c.marker + "-REQUEST", deductionAuthorizationReference: c.marker + " fictional source authority",
    principal: "1200.00", monthlyAmortization: "200.00", cutoffDeduction: "100.00", startDate: "2099-01-01", endDate: "2099-12-31", notes: c.marker + " pending only" });
  return [
    { key: "POST loans", status: 201, state: state,
      ownBody: c => requestBody(c, c.orgId, c.workerId),
      foreignBody: c => requestBody(c, c.victim.org.id, c.victim.worker.id),
      forged: { status: 409, body: c => requestBody(c, c.orgId, c.victim.worker.id) },
      expect: (before, after, c, response) => {
        retained(before, after, c); assert.equal(after.loans.length, before.loans.length + 1);
        const added = after.loans.filter(row => !before.loans.some(old => old.id === row.id)); assert.equal(added.length, 1);
        const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
        assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId); assert.equal(row.requestedByUserId, c.owner.id);
        assert.equal(row.loanType, "Company Emergency Loan"); assert.equal(row.referenceNo, c.marker + "-REQUEST");
        assert.equal(row.deductionAuthorizationReference, c.marker + " fictional source authority"); assert.equal(row.notes, c.marker + " pending only");
        assert.equal(row.principal, "1200.00"); assert.equal(row.remainingBalance, "1200.00"); assert.equal(row.totalPaid, "0.00");
        assert.equal(row.monthlyAmortization, "200.00"); assert.equal(row.cutoffDeduction, "100.00");
        assert.equal(row.startDate, "2099-01-01"); assert.equal(row.endDate, "2099-12-31"); assert.equal(row.status, "pending_approval");
        for (const field of ["reviewedByUserId", "reviewedAt", "reviewEvidenceReference", "reviewReason"]) assert.equal(row[field], null);
        assert.deepEqual(after.loans.filter(item => item.id !== row.id), before.loans);
        const { nextAction, ...returned } = response.json ?? {}; assert.deepEqual(returned, row); assert.match(nextAction, /Independent payroll checker/);
        audit(before, after, c, "Employee loan deduction submitted for independent review", `${row.loanType} #${row.id}`, {
          loanId: row.id, employeeId: c.workerId, makerUserId: c.owner.id, externalReference: row.referenceNo,
          sourceAuthorizationReference: row.deductionAuthorizationReference, principal: "1200.00", monthlyAmortization: "200.00", cutoffDeduction: "100.00",
          startDate: "2099-01-01", endDate: "2099-12-31", activated: false,
        });
      } },
    { key: "PATCH loans", state,
      seed: async e => {
        // This is an already-approved *fictional* historical source record,
        // not a live approval endpoint. A distinct checker with an actual
        // same-employer membership satisfies the independent-deduction CHECK.
        const [checker] = await db.insert(users).values({
          email: "loan-reviewer-" + e.marker.toLowerCase() + "@example.invalid",
          name: e.marker + " fictional independent reviewer",
          role: "checker", passwordHash: "synthetic-only-no-login",
          // Historical fictional reviewer never logs in. Keep this account out of
          // enterprise MFA readiness checks for active local-password members.
          localPasswordEnabled: false,
        }).returning({ id: users.id });
        await db.insert(userOrganizations).values({
          organizationId: e.org.id, userId: checker.id, role: "checker", active: true,
        });
        assert.notEqual(checker.id, e.owner.id, "historical reviewer must not be the loan maker");
        const [loan] = await db.insert(employeeLoans).values({ organizationId: e.org.id, employeeId: e.worker.id, loanType: "Company Emergency Loan",
          referenceNo: e.marker + "-PAUSE", principal: "1500.00", monthlyAmortization: "200.00", cutoffDeduction: "100.00",
          remainingBalance: "1000.00", totalPaid: "500.00", status: "active", requestedByUserId: e.owner.id,
          reviewedByUserId: checker.id, reviewedAt: new Date("2026-01-05T00:00:00.000Z"),
          reviewEvidenceReference: e.marker + " fictional independent review evidence",
          reviewReason: e.marker + " fictitious historical reviewer acceptance",
          deductionAuthorizationReference: e.marker + " fictional historical authority", startDate: "2026-01-05", notes: e.marker + " pause fixture" }).returning();
        await db.insert(loanPayments).values({ loanId: loan.id, amount: "500.00", paymentDate: "2026-01-05", reference: e.marker + " fictional historical receipt" });
        return loan;
      },
      ownBody: c => ({ id: c.seeded.id, action: "pause", reviewReason: c.marker + " fictional precautionary pause" }),
      foreignBody: c => ({ id: c.victimSeeded.id, action: "pause", reviewReason: c.marker + " fictional precautionary pause" }),
      expect: (before, after, c, response) => {
        retained(before, after, c); assert.equal(after.loans.length, before.loans.length);
        const old = before.loans.find(row => row.id === c.seeded.id), row = after.loans.find(row => row.id === c.seeded.id);
        assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId);
        assert.equal(old.status, "active"); assert.equal(row.status, "paused"); assert.equal(row.referenceNo, c.marker + "-PAUSE");
        assert.equal(old.requestedByUserId, c.owner.id);
        assert.ok(Number.isSafeInteger(old.reviewedByUserId) && old.reviewedByUserId > 0 && old.reviewedByUserId !== c.owner.id,
          "historical active loan must have a distinct recorded fictional reviewer");
        assert.ok(old.reviewedAt && old.reviewEvidenceReference?.includes(c.marker),
          "fictional reviewer timestamp and source reference must be retained");
        const withoutStatus = ({ status: _status, ...fields }) => fields;
        assert.deepEqual(withoutStatus(row), withoutStatus(old)); assert.deepEqual(after.loans.filter(item => item.id !== row.id), before.loans.filter(item => item.id !== row.id));
        assert.ok(before.payments.some(item => item.payment.loanId === row.id && item.payment.amount === "500.00"), "existing fictional repayment evidence must be retained");
        assert.equal(response.json?.id, row.id); assert.equal(response.json.action, "pause"); assert.equal(response.json.status, "paused"); assert.equal(response.json.paymentAmount, null);
        audit(before, after, c, "Employee loan: pause", `${row.loanType} #${row.id}`, { loanId: row.id, employeeId: c.workerId,
          previousStatus: "active", actorUserId: c.owner.id, makerUserId: old.requestedByUserId, originalAuthorizationReference: old.deductionAuthorizationReference,
          pauseReason: c.marker + " fictional precautionary pause", nextStatus: "paused" });
      } },
  ];
}
