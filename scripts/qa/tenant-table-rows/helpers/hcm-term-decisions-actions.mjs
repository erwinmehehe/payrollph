/**
 * POST hcm/employment-term-decisions: every decision kind except continue_current (the row's own kind).
 * Each kind needs its own worker and active employment term, seeded here so the row's seed stays on the same lines.
 * Fictional employers only; every refusal must leave the own employer and the victim byte-identical.
 * Lives outside write/ so the family loader does not treat it as a row file.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

const KINDS = {
  confirm_regular: { term: { termKind: "probationary", employmentType: "Probationary", probationReviewDate: "2026-06-30" }, extra: {},
    expect: { nextTermKind: "regular", nextEmploymentType: "Regular" } },
  renew_term: { term: { termKind: "fixed_term", employmentType: "Fixed-term", contractEndDate: "2026-12-31", effectiveUntil: "2026-12-31" },
    extra: { nextTermKind: "fixed_term", nextEmploymentType: "Fixed-term", nextContractEndDate: "2027-12-31", nextEffectiveUntil: "2027-12-31" },
    expect: { nextTermKind: "fixed_term", nextEmploymentType: "Fixed-term", nextContractEndDate: "2027-12-31" } },
  extend_term: { term: { termKind: "fixed_term", employmentType: "Fixed-term", contractEndDate: "2026-12-31", effectiveUntil: "2026-12-31" },
    extra: { nextTermKind: "fixed_term", nextEmploymentType: "Fixed-term", nextContractEndDate: "2027-06-30", nextEffectiveUntil: "2027-06-30" },
    expect: { nextTermKind: "fixed_term", nextEmploymentType: "Fixed-term", nextContractEndDate: "2027-06-30" } },
  convert_terms: { term: { termKind: "regular", employmentType: "Regular" }, extra: { nextTermKind: "regular", nextEmploymentType: "Contractual" },
    expect: { nextTermKind: "regular", nextEmploymentType: "Contractual" } },
  non_renew: { term: { termKind: "fixed_term", employmentType: "Fixed-term", contractEndDate: "2026-12-31", effectiveUntil: "2026-12-31" },
    extra: { proposedSeparationLastDay: "2026-08-05", separationReason: "Fictional non-renewal" }, expect: { proposedSeparationLastDay: "2026-08-05" } },
};

/** Called from the row's seed: keeps the row's own term and adds one worker and active term per decision kind. */
export async function withDecisionTerms({ addWorker, db, hcmEmploymentTerms }, e, base) {
  const kinds = {};
  for (const [kind, spec] of Object.entries(KINDS)) {
    const worker = await addWorker(e, "D" + kind.slice(0, 6).toUpperCase());
    const [term] = await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: worker.id, effectiveFrom: "2026-01-05",
      status: "active", reason: e.marker, requestedBy: e.owner.name, ...spec.term }).returning();
    kinds[kind] = { employeeId: worker.id, termId: term.id };
  }
  return { ...base, kinds };
}

export async function termDecisionActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, { request, expectStatus, cookie }) {
  const s = await tables();
  const url = "/api/hcm/employment-term-decisions";
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => JSON.parse(JSON.stringify({
    decisions: await read(s.hcmEmploymentTermDecisions, orgId),
    events: await read(s.hcmEmploymentDecisionEvents, orgId),
    terms: await read(s.hcmEmploymentTerms, orgId),
    workers: await read(s.employees, orgId),
    audit: auditBusinessSnapshot(await read(s.auditEvents, orgId)),
  }));
  const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
  const bodyFor = (organizationId, target, kind) => ({ organizationId, employeeId: target.employeeId, employmentTermId: target.termId,
    decisionKind: kind, effectiveDate: "2026-07-05", reason: c.marker + " " + kind, ...KINDS[kind].extra });
  const victimBefore = await snapshot(c.victim.org.id);
  const refused = async (body, status, label) => {
    const own = await snapshot(c.orgId);
    const response = await post(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await snapshot(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };

  for (const kind of Object.keys(KINDS)) {
    const target = c.seeded.kinds[kind], victimTarget = c.victimSeeded.kinds[kind];
    // A victim term under the own employer, and the victim employer named directly, are refused first.
    await refused(bodyFor(c.orgId, { employeeId: target.employeeId, termId: victimTarget.termId }, kind), 404, "forged victim term " + kind);
    await refused(bodyFor(c.victim.org.id, victimTarget, kind), 403, "victim employer " + kind);

    const before = await snapshot(c.orgId);
    const response = await post(bodyFor(c.orgId, target, kind), 201, "own " + kind);
    const after = await snapshot(c.orgId);
    assert.equal(after.decisions.length, before.decisions.length + 1, kind + ": exactly one decision is created");
    const row = after.decisions.at(-1);
    assert.equal(row.organizationId, c.orgId);
    assert.equal(row.employeeId, target.employeeId);
    assert.equal(row.employmentTermId, target.termId);
    assert.equal(row.decisionKind, kind);
    assert.equal(row.status, "pending_approval", kind + ": a decision is only requested, never applied");
    assert.equal(row.requestedByUserId, c.owner.id);
    for (const [field, value] of Object.entries(KINDS[kind].expect)) assert.equal(String(row[field]), value, kind + ": " + field);
    assert.equal(response.json?.decision?.id, row.id, kind + ": the response names the committed decision");
    assert.deepEqual(after.decisions.filter((d) => d.id !== row.id), before.decisions, kind + ": other decisions are untouched");
    assert.equal(after.events.length, before.events.length + 1, kind + ": one requested event");
    const event = after.events.at(-1);
    assert.equal(event.decisionId, row.id); assert.equal(event.eventType, "requested"); assert.equal(event.actorUserId, c.owner.id);
    assert.deepEqual(after.terms, before.terms, kind + ": a request never changes the employment term");
    assert.deepEqual(after.workers, before.workers, kind + ": a request never changes the worker");
    assert.equal(after.audit.length, before.audit.length + 1, kind + ": exactly one audit receipt");
    assert.deepEqual(after.audit.slice(0, -1), before.audit);
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId); assert.equal(audit.actor, c.owner.name);
    assert.equal(audit.action, "HCM employment-term decision requested");
    assert.equal(audit.metadata.decisionKind, kind);
  }
  // A second request on a term that already has one open is refused and writes nothing.
  await refused(bodyFor(c.orgId, c.seeded.kinds.non_renew, "non_renew"), 409, "second open decision on the same term");
  return { actions: Object.keys(KINDS), forgedReferences: Object.keys(KINDS).length, victimEmployerDenials: Object.keys(KINDS).length };
}
