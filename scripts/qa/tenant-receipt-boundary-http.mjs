import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { requireReceiptProof, assertReceiptBytes } from "./receipt-http-proof-contract.mjs";
requireReceiptProof();
const [{ db, pool }, s, { eq, and, asc }, fixture] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"), import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const origin = "http://127.0.0.1:3000";
const control = async (input) => {
  const r = await fetch("https://127.0.0.1:9443/control", {
    method: input ? "POST" : "GET", headers: { Authorization: "Bearer fictional-receipt-scanner" },
    body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(5000),
  }); assert.equal(r.status, 200); return r.json();
};
async function request(f, id, bytes, organizationSelector = 2147483647) {
  requireReceiptProof();
  const form = new FormData();
  if (bytes) { form.set("claimId", String(id)); form.set("organizationId", String(organizationSelector)); form.set("file", new Blob([bytes], { type: "application/pdf" }), "fictional.pdf"); }
  const r = await fetch(origin + "/api/expenses/receipts" + (bytes ? "" : "?claimId=" + id), {
    method: bytes ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Cookie: f.cookie, Origin: origin, "Sec-Fetch-Site": "same-origin" }, body: bytes ? form : undefined,
  });
  const data = Buffer.from(await r.arrayBuffer());
  return { status: r.status, bytes: data, text: data.toString(), cache: r.headers.get("cache-control") };
}
async function snapshot(f) {
  const rows = async t => (await db.select().from(t).where(eq(t.organizationId, f.org.id)))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { claims: await rows(s.expenseClaims), evidence: await rows(s.expenseClaimEvidence),
    documents: await rows(s.documents), audit: await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, f.org.id)).orderBy(asc(s.auditEvents.id)),
    employees: await rows(s.employees), payroll: await rows(s.payrollRuns),
    entries: await db.select({ entry: s.payrollEntries }).from(s.payrollEntries).innerJoin(s.payrollRuns,
      eq(s.payrollRuns.id, s.payrollEntries.payrollRunId)).where(eq(s.payrollRuns.organizationId, f.org.id)).orderBy(asc(s.payrollEntries.id)) };
}
async function claim(f, label) {
  const [row] = await db.insert(s.expenseClaims).values({ organizationId: f.org.id, employeeId: f.worker.id,
    category: "Fictional travel", description: "Fictional " + label, amount: "100", incurredOn: "2026-01-10", status: "pending" }).returning();
  await db.insert(s.expenseClaimEvidence).values({ claimId: row.id, organizationId: f.org.id, employeeId: f.worker.id,
    categoryPolicyId: f.policy.id, taxable: false });
  return row;
}
async function prepare(label, nonce) {
  const f = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
  const [policy] = await db.insert(s.expenseCategoryPolicies).values({ organizationId: f.org.id, category: "Fictional travel",
    taxable: false, reviewReference: "FICTIONAL-CATEGORY-REVIEW", reviewedByUserId: f.owner.id }).returning();
  f.policy = policy;
  const [run] = await db.insert(s.payrollRuns).values({ organizationId: f.org.id, legalEntityId: f.entity.id,
    periodLabel: "Fictional receipt payroll", periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-20",
    employeeCount: 1, grossPay: "1000", netPay: "900" }).returning();
  await db.insert(s.payrollEntries).values({ payrollRunId: run.id, employeeId: f.worker.id, grossPay: "1000", deductions: "100", netPay: "900" });
  f.claim = await claim(f, label);
  f.bytes = Buffer.from("%PDF-1.7\nFictional receipt " + f.marker);
  return f;
}
async function verify() {
  const nonce = randomUUID().slice(0, 8);
  assert.equal((await db.select().from(s.organizations).limit(1)).length, 0, "fresh disposable database required");
  const a = await prepare("ATTA", nonce), b = await prepare("ATTB", nonce);
  for (let i = 0; i < 7; i++) await claim(a, "filler " + i);
  const v = await prepare("VICTIM", nonce);
  assert.ok(v.claim.id > b.claim.id && v.claim.id > 6);
  assert.equal((await request(v, v.claim.id, v.bytes)).status, 201, "real victim receipt upload must be reachable");
  assertReceiptBytes(await request(v, v.claim.id), v.bytes, "victim control");
  const victimBefore = await snapshot(v);
  for (const f of [a, b]) {
    for (const bytes of [undefined, f.bytes]) {
      const before = await snapshot(f), storageBefore = await control();
      const foreign = await request(f, v.claim.id, bytes, f.org.id), missing = await request(f, 2147483647, bytes, f.org.id);
      assert.equal(foreign.status, 404); assert.equal(foreign.text, missing.text); assert.equal(foreign.cache, missing.cache);
      assert.ok(!foreign.text.includes(v.marker)); assert.deepEqual(await snapshot(f), before);
      assert.deepEqual(await control(), storageBefore, "denied upload must not access storage");
      assert.deepEqual(await snapshot(v), victimBefore);
    }
    const uploaded = await request(f, f.claim.id, f.bytes, v.org.id); assert.equal(uploaded.status, 201, uploaded.text);
    const saved = (await snapshot(f)).evidence.find(e => e.claimId === f.claim.id);
    assert.equal(saved.receiptSha256, createHash("sha256").update(f.bytes).digest("hex"));
    assert.match(saved.receiptStorageKey, new RegExp("^private-documents/" + f.org.id + "/" + f.worker.id + "/"));
    assert.equal((await snapshot(f)).documents.length, 0, "successful upload consumes staged intent");
    const ownRead = await request(f, f.claim.id); assertReceiptBytes(ownRead, f.bytes, "own control");
    assert.throws(() => assertReceiptBytes(ownRead, v.bytes, "foreign receipt"), /accepts another employer's data/);
    const beforeDuplicate = await snapshot(f); assert.equal((await request(f, f.claim.id, f.bytes)).status, 409);
    assert.deepEqual(await snapshot(f), beforeDuplicate);
    await db.update(s.userOrganizations).set({ active: false }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    for (const bytes of [undefined, f.bytes]) assert.equal((await request(f, f.claim.id, bytes)).status, 404);
    assert.deepEqual(await snapshot(f), beforeDuplicate);
    await db.update(s.userOrganizations).set({ active: true }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    // Observe actual remote-I/O suspension before revoking the grant.
    await control({ hold: true });
    const pending = request(f, f.claim.id);
    let waiting = false;
    for (let i = 0; i < 100; i++) { if ((await control()).waiting > 0) { waiting = true; break; } await new Promise(r => setTimeout(r, 30)); }
    await db.update(s.userOrganizations).set({ active: false }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    await control({ hold: false });
    const denied = await pending; assert.equal(waiting, true, "real readback race not exercised"); assert.equal(denied.status, 404, denied.text);
    assert.deepEqual(await snapshot(f), beforeDuplicate);
    await db.update(s.userOrganizations).set({ active: true }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    await control({ corrupt: true }); const corruptBefore = await snapshot(f);
    assert.equal((await request(f, f.claim.id)).status, 503, "changed stored bytes must not download");
    assert.deepEqual(await snapshot(f), corruptBefore);
    await control({});
    // Staff scope and wrong-worker identity cannot discover the known claim.
    const [otherUnit] = await db.insert(s.orgUnits).values({ organizationId: f.org.id, type: "department", code: f.marker + "-deny", name: "Fictional other unit" }).returning();
    await db.update(s.userOrganizations).set({ role: "hr", orgUnitId: otherUnit.id }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    for (const bytes of [undefined, f.bytes]) assert.equal((await request(f, f.claim.id, bytes)).status, 404);
    assert.deepEqual(await snapshot(f), corruptBefore);
    await db.update(s.userOrganizations).set({ role: "owner", orgUnitId: null }).where(and(eq(s.userOrganizations.organizationId, f.org.id), eq(s.userOrganizations.userId, f.owner.id)));
    const [otherWorker] = await db.insert(s.employees).values({ ...f.worker, id: undefined, employeeNo: f.marker + "-other", firstName: "Other" }).returning();
    const [self] = await db.insert(s.users).values({ email: f.marker + "-self@example.invalid", name: "Fictional other worker", passwordHash: "fictional-session-only", role: "employee", employeeId: otherWorker.id, totpEnabled: true }).returning();
    await db.insert(s.userOrganizations).values({ organizationId: f.org.id, userId: self.id, role: "employee", workerEmployeeId: otherWorker.id, active: true });
    const session = await fixture.standaloneMakeSession(self.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, session.id));
    const otherSelf = { cookie: session.cookie };
    const beforeSelf = await snapshot(f);
    for (const bytes of [undefined, f.bytes]) assert.equal((await request(otherSelf, f.claim.id, bytes)).status, 404);
    assert.deepEqual(await snapshot(f), beforeSelf);
    // Receipt replacement and worker reassignment during a held real GET.
    const originalEvidence = (await snapshot(f)).evidence.find(e => e.claimId === f.claim.id);
    for (const kind of ["replacement", "reassignment"]) {
      await control({ hold: true }); const pendingRead = request(f, f.claim.id);
      let suspended = false;
      for (let i = 0; i < 100; i++) { if ((await control()).waiting > 0) { suspended = true; break; } await new Promise(r => setTimeout(r, 30)); }
      if (kind === "replacement") {
        await db.update(s.expenseClaimEvidence).set({ receiptSha256: "0".repeat(64) }).where(eq(s.expenseClaimEvidence.claimId, f.claim.id));
      } else {
        await db.transaction(async tx => {
          await tx.delete(s.expenseClaimEvidence).where(eq(s.expenseClaimEvidence.claimId, f.claim.id));
          await tx.update(s.expenseClaims).set({ employeeId: otherWorker.id }).where(eq(s.expenseClaims.id, f.claim.id));
          await tx.insert(s.expenseClaimEvidence).values({ ...originalEvidence, employeeId: otherWorker.id });
        });
      }
      const changed = await snapshot(f);
      await control({}); const response = await pendingRead;
      assert.equal(suspended, true, kind + " race not exercised"); assert.equal(response.status, 404, response.text);
      assert.deepEqual(await snapshot(f), changed, "read after " + kind + " must not write an audit or return bytes");
      await db.transaction(async tx => {
        await tx.delete(s.expenseClaimEvidence).where(eq(s.expenseClaimEvidence.claimId, f.claim.id));
        await tx.update(s.expenseClaims).set({ employeeId: f.worker.id }).where(eq(s.expenseClaims.id, f.claim.id));
        await tx.insert(s.expenseClaimEvidence).values(originalEvidence);
      });
    }
    // An unverified PUT must keep its unreadable recovery intent, not attach.
    const failedClaim = await claim(f, "corrupt staged upload");
    await control({ corrupt: true });
    const badUpload = await request(f, failedClaim.id, Buffer.from("%PDF-1.7\nFictional failed upload " + f.marker));
    assert.equal(badUpload.status, 503, badUpload.text);
    assert.equal((await snapshot(f)).evidence.find(e => e.claimId === failedClaim.id).receiptStorageKey, null);
    assert.ok((await snapshot(f)).documents.some(d => d.scannedClean === false && d.objectStorageKey && !d.content));
    await control({});
    const auditClaim = await claim(f, "audit-fault upload");
    try {
      await pool.query("CREATE FUNCTION qa_receipt_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'Expense receipt scanned and uploaded' THEN RAISE EXCEPTION 'fictional receipt audit fault'; END IF; RETURN NEW; END $$");
      await pool.query("CREATE TRIGGER qa_receipt_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_receipt_audit_fault()");
      const auditFailure = await request(f, auditClaim.id, Buffer.from("%PDF-1.7\nFictional audit failure " + f.marker));
      assert.equal(auditFailure.status, 409, auditFailure.text);
      const faultState = await snapshot(f);
      assert.equal(faultState.evidence.find(e => e.claimId === auditClaim.id).receiptStorageKey, null);
      assert.ok(!faultState.audit.some(e => e.action === "Expense receipt scanned and uploaded" && e.metadata?.claimId === auditClaim.id));
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS qa_receipt_audit_fault ON audit_events");
      await pool.query("DROP FUNCTION IF EXISTS qa_receipt_audit_fault()");
    }
    assert.deepEqual(await snapshot(v), victimBefore);
  }
  console.log(JSON.stringify({ kind: "RECEIPT_BOUNDARY_HTTP", result: "PASS", attackers: 2, ownGet: 2, ownPost: 2,
    revokedDuringReadback: 2, corruptReadbackDenied: 2, newCoverageCredits: 0,
    realS3OrAntivirusAccepted: false, productionCertified: false, replacementAndReassignmentRaces: 4, uploadAuditFaults: 2 }));
}
try { await verify(); } finally { await control({}).catch(() => {}); await pool.end(); }
