// Fictional-only Spend metadata and rejection probes. No card charging, approvals, payouts, or providers.
// Loaded automatically by the shared two-attacker / higher-ID-victim PG16 HTTP runner.
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, auditEvents, auditBusinessSnapshot }) {
  // Defer TypeScript schema loading until an actual tsx-backed PostgreSQL proof run.
  // Pure source-contract tests can exercise row expectations without a database.
  let schema;
  const tables = () => (schema ??= import("../../../../src/db/schema"));
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => {
    const { spendCards, spendCardTransactions, expenseReports, expenseReportItems, expenseClaims } = await tables();
    const [cards, transactions, reports, items, claims, audit] = await Promise.all([
      byOrg(spendCards, orgId), byOrg(spendCardTransactions, orgId),
      byOrg(expenseReports, orgId), byOrg(expenseReportItems, orgId),
      byOrg(expenseClaims, orgId), byOrg(auditEvents, orgId),
    ]);
    return { cards, transactions, reports, items, claims, audit: auditBusinessSnapshot(audit) };
  };
  const untouched = (before, after, ...keys) => {
    for (const key of keys) assert.deepEqual(after[key], before[key], key + " must not change");
  };
  const auditAdded = (before, after, c, action, resource) => {
    assert.equal(after.length, before.length + 1, "one new actor-bound audit record");
    const added = after.filter(row => !before.some(old => old.id === row.id));
    assert.equal(added.length, 1);
    assert.deepEqual(after.filter(row => row.id !== added[0].id), before, "prior audit history unchanged");
    const event = added[0];
    assert.equal(event.organizationId, c.orgId);
    assert.equal(event.actor, c.owner.name);
    assert.equal(event.action, action);
    assert.equal(event.resource, resource);
    return event;
  };
  const changedOnly = (before, after, id, allowed) => {
    assert.equal(after.length, before.length, "update cannot insert or delete rows");
    const old = before.find(row => row.id === id);
    const updated = after.find(row => row.id === id);
    assert.ok(old && updated, "existing owned target row must remain present");
    assert.deepEqual(after.filter(row => row.id !== id), before.filter(row => row.id !== id),
      "unrelated owned rows must remain unchanged");
    for (const [field, value] of Object.entries(old)) {
      if (!allowed.includes(field)) assert.deepEqual(updated[field], value, "immutable " + field);
    }
    assert.notDeepEqual(updated, old, "mutation must change target");
    return { old, updated };
  };
  return [
    {
      key: "POST spend", status: 201,
      seed: async employer => {
        const { spendCards } = await tables();
        const [card] = await db.insert(spendCards).values({
          organizationId: employer.org.id, employeeId: employer.worker.id,
          issuer: employer.marker + " existing fictional issuer", lastFour: "9000",
          reference: employer.marker + "-previous",
        }).returning();
        return card;
      },
      state,
      ownBody: c => ({ organizationId: c.orgId, action: "card", employeeId: c.workerId,
        issuer: c.marker + " fictional issuer", lastFour: "42" + String(c.rank).padStart(2, "0"),
        reference: c.marker + "-new-card" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, action: "card", employeeId: c.victim.worker.id,
        issuer: c.marker + " unauthorized", lastFour: "1234", reference: c.marker + "-foreign" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, action: "card", employeeId: c.victim.worker.id,
        issuer: c.marker + " forged", lastFour: "1234", reference: c.marker + "-forged" }) },
      expect: (before, after, c, response) => {
        assert.equal(after.cards.length, before.cards.length + 1);
        const added = after.cards.filter(row => !before.cards.some(old => old.id === row.id));
        assert.equal(added.length, 1, "one persisted card-metadata row");
        const card = added[0], body = c.marker + "-new-card";
        assert.deepEqual(after.cards.filter(row => row.id !== card.id), before.cards);
        assert.equal(card.organizationId, c.orgId);
        assert.equal(card.employeeId, c.workerId);
        assert.equal(card.issuer, c.marker + " fictional issuer");
        assert.equal(card.reference, body);
        assert.equal(card.lastFour, "42" + String(c.rank).padStart(2, "0"));
        assert.equal(card.status, "registered");
        assert.equal(response.json?.id, card.id);
        assert.equal(response.json?.organizationId, c.orgId);
        assert.equal(response.json?.employeeId, c.workerId);
        assert.equal(response.json?.lastFour, card.lastFour);
        untouched(before, after, "transactions", "reports", "items", "claims");
        const event = auditAdded(before.audit, after.audit, c,
          "Corporate card registered (metadata only)", String(card.id));
        assert.deepEqual(event.metadata, { cardId: card.id, employeeId: c.workerId });
      },
    },
    {
      key: "PATCH spend",
      seed: async employer => {
        const { users, expenseClaims, expenseReports, expenseReportItems } = await tables();
        // A different fictional submitter enforces the maker/checker constraint.
        const [submitter] = await db.insert(users).values({
          email: employer.marker.toLowerCase() + "-spend@example.invalid",
          name: employer.marker + " fictional submitter", role: "employee",
          passwordHash: "fictional-test-account-not-a-login",
        }).returning();
        const [claim] = await db.insert(expenseClaims).values({
          organizationId: employer.org.id, employeeId: employer.worker.id,
          submittedByUserId: submitter.id, category: "Travel",
          description: employer.marker + " fictional travel", amount: "150.00", incurredOn: "2026-10-12",
        }).returning();
        const [report] = await db.insert(expenseReports).values({
          organizationId: employer.org.id, employeeId: employer.worker.id,
          title: employer.marker + " fictional report", totalAmount: "150.00",
          status: "submitted", submittedByUserId: submitter.id,
        }).returning();
        await db.insert(expenseReportItems).values({
          organizationId: employer.org.id, reportId: report.id, claimId: claim.id,
        });
        return { id: report.id, claimId: claim.id, submitterId: submitter.id };
      },
      state,
      ownBody: c => ({ id: c.seeded.id, status: "rejected", note: c.marker + " fictional decision" }),
      foreignBody: c => ({ id: c.victimSeeded.id, status: "rejected", note: c.marker + " foreign decision" }),
      // The route derives employer identity from the report, ignoring forged organizationId.
      forged: { status: 403, body: c => ({ organizationId: c.orgId, id: c.victimSeeded.id,
        status: "rejected", note: c.marker + " forged employer" }) },
      expect: (before, after, c, response) => {
        const { old: reportBefore, updated: report } = changedOnly(before.reports, after.reports,
          c.seeded.id, ["status", "decidedByUserId", "decidedAt", "decisionNote"]);
        assert.equal(reportBefore.organizationId, c.orgId);
        assert.equal(reportBefore.status, "submitted");
        assert.equal(reportBefore.submittedByUserId, c.seeded.submitterId);
        assert.notEqual(reportBefore.submittedByUserId, c.owner.id);
        assert.equal(report.employeeId, c.workerId);
        assert.equal(report.status, "rejected");
        assert.equal(report.decidedByUserId, c.owner.id);
        assert.ok(Number.isFinite(Date.parse(report.decidedAt)));
        assert.equal(report.decisionNote, c.marker + " fictional decision");
        assert.equal(response.json?.id, report.id);
        assert.equal(response.json?.organizationId, c.orgId);
        assert.equal(response.json?.status, "rejected");
        assert.equal(response.json?.decidedByUserId, c.owner.id);
        const { old: claimBefore, updated: claim } = changedOnly(before.claims, after.claims,
          c.seeded.claimId, ["status", "decidedBy"]);
        assert.equal(claimBefore.organizationId, c.orgId);
        assert.equal(claimBefore.employeeId, c.workerId);
        assert.equal(claimBefore.status, "pending");
        assert.equal(claim.status, "rejected");
        assert.equal(claim.decidedBy, c.owner.name);
        untouched(before, after, "cards", "transactions", "items");
        const event = auditAdded(before.audit, after.audit, c, "Expense report rejected", String(report.id));
        assert.deepEqual(event.metadata, { reportId: report.id, employeeId: c.workerId,
          decidedByUserId: c.owner.id });
      },
    },
  ];
}
