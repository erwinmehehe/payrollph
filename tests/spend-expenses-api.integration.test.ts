import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { spendIsolatedDatabase } from "./helpers/spend-isolated-database";
import { organizations, employees, users, userOrganizations, orgUnits,
  expenseCategoryPolicies, expenseClaimEvidence, expenseClaims, expenseReports, expenseReportItems, auditEvents, documents } from "../src/db/schema";
const require = createRequire(import.meta.url);

test("expense API enforces maker-checker, MFA, employer scope, exact approval and legacy compatibility", async () => {
  const fixture = await spendIsolatedDatabase(), { db, pool } = fixture;
  const prior = { ...process.env }, authId = require.resolve("../src/lib/auth"), originalAuth = require(authId);
  const originalFetch = globalThis.fetch;
  let actor: Record<string, unknown> | null = null;
  require.cache[authId]!.exports = { ...originalAuth, getSessionUser: async () => actor };
  Object.assign(process.env, { SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true", APP_BASE_URL: "http://127.0.0.1:3000" });
  const api = await import("../src/app/api/expenses/route");
  const receipts = await import("../src/app/api/expenses/receipts/route");
  const spend = await import("../src/app/api/spend/route");
  const recovery = await import("../src/lib/spend-receipt-object-reconciliation");
  const documentApi = await import("../src/app/api/documents/[id]/route");
  const request = (method: string, body?: Record<string, unknown>, query = "") => new Request(
    "http://127.0.0.1:3000/api/expenses" + query, { method, headers: {
      "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const orgs = await db.insert(organizations).values([{ name: "Synthetic A", legalName: "Synthetic A", plan: "Core" },
      { name: "Synthetic B", legalName: "Synthetic B", plan: "Core" }]).returning();
    const [unit] = await db.insert(orgUnits).values({ organizationId: orgs[0].id, name: "Scoped unit", type: "branch", code: "SCOPED" }).returning();
    const staff = await db.insert(employees).values([{ organizationId: orgs[0].id, employeeNo: "A",
      firstName: "Synthetic", lastName: "Claimant", title: "Associate", avatarInitials: "SC", basicRate: "30000", startDate: "2025-01-01" },
    { organizationId: orgs[1].id, employeeNo: "B", firstName: "Other", lastName: "Employer", title: "Associate", avatarInitials: "OE", basicRate: "30000", startDate: "2025-01-01" }]).returning();
    const accounts = await db.insert(users).values(["maker", "checker", "outsider", "scoped", "employee"].map((name, index) => ({
      name, email: name + "@example.invalid", passwordHash: "synthetic", role: index === 4 ? "employee" : "owner",
      employeeId: index === 0 || index === 4 ? staff[0].id : null }))).returning();
    await db.insert(userOrganizations).values(accounts.map((user, index) => ({ userId: user.id,
      organizationId: index === 2 ? orgs[1].id : orgs[0].id, role: user.role,
      orgUnitId: index === 3 ? unit.id : null })));
    const signed = (index: number) => { actor = { ...accounts[index], totpEnabled: true, mfaVerifiedAt: new Date() }; };
    signed(1);
    const [policy] = await db.insert(expenseCategoryPolicies).values({ organizationId: orgs[0].id,
      category: "Travel", taxable: false, reviewedByUserId: accounts[1].id,
      reviewReference: "Synthetic reviewed business travel policy" }).returning();
    const body = { organizationId: orgs[0].id, employeeId: staff[0].id, category: "Travel",
      amount: "500.00", description: "Synthetic travel only", incurredOn: "2026-09-08" };
    actor = null;
    assert.equal((await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).status, 401);
    signed(0);
    assert.equal((await api.POST(request("POST", { ...body, amount: "0.001" }))).status, 422);
    assert.equal((await api.POST(request("POST", { ...body, incurredOn: "2026-02-31" }))).status, 422);
    assert.equal((await api.POST(request("POST", { ...body, category: "Unreviewed" }))).status, 422);
    const created = await api.POST(request("POST", body)); assert.equal(created.status, 201);
    const claim = await created.json();
    signed(1);
    assert.equal((await api.PATCH(request("PATCH", { id: claim.id, status: "approved" }))).status, 409);
    const bytes = Buffer.from("%PDF-1.7"), hash = createHash("sha256").update(bytes).digest("hex");
    Object.assign(process.env, { DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
      DOCUMENT_OBJECT_STORAGE_BUCKET: "synthetic-receipts", DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
      DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic", DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-not-live",
      MALWARE_SCAN_URL: "https://scanner.example.invalid/scan", MALWARE_SCAN_TOKEN: "synthetic" });
    const objects = new Map<string, Uint8Array>();
    let tamper = false, ambiguousPut = false, failDelete = false;
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input)); assert.ok(url.hostname.endsWith("example.invalid"));
      if (url.hostname === "scanner.example.invalid") return Response.json({ clean: true, engine: "synthetic-contract" });
      if (options?.method === "PUT") {
        assert.equal((await db.select().from(documents)).filter(row => row.sourceKey?.startsWith(recovery.SPEND_PENDING_RECEIPT_PREFIX)).length, 1,
          "Durable unreadable SQL intent must exist before external PUT");
        assert.equal(new Headers(options.headers).get("If-None-Match"), "*");
        objects.set(url.pathname, new Uint8Array(options.body as Uint8Array)); return new Response(null, { status: ambiguousPut ? 503 : 200 });
      }
      if (options?.method === "DELETE") {
        if (failDelete) return new Response(null, { status: 503 });
        objects.delete(url.pathname); return new Response(null, { status: 204 });
      }
      const stored = objects.get(url.pathname); assert.ok(stored);
      return new Response(tamper ? new Uint8Array(Buffer.from("%PDF-1.8")) : new Uint8Array(stored));
    };
    signed(0);
    const upload = (claimId: number) => {
      const form = new FormData(); form.set("claimId", String(claimId));
      form.set("file", new File([bytes], "synthetic.pdf", { type: "application/pdf" }));
      return receipts.POST(new Request("http://127.0.0.1:3000/api/expenses/receipts", {
        method: "POST", headers: { Origin: "http://127.0.0.1:3000" }, body: form }));
    };
    assert.equal((await upload(claim.id)).status, 201);
    assert.equal((await upload(claim.id)).status, 409, "Receipt is immutable");
    const download = await receipts.GET(request("GET", undefined, "?claimId=" + claim.id));
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(download.headers.get("Cache-Control"), "private, no-store");
    tamper = true; assert.equal((await receipts.GET(request("GET", undefined, "?claimId=" + claim.id))).status, 503);
    tamper = false;
    const repeated = await (await api.POST(request("POST", body))).json();
    assert.equal((await upload(repeated.id)).status, 409, "Same worker cannot reuse identical receipt bytes");
    const [verified] = await db.select().from(expenseClaimEvidence).where(eq(expenseClaimEvidence.claimId, claim.id));
    assert.equal(verified.receiptSha256, hash); assert.equal(verified.receiptByteSize, bytes.length);
    assert.equal(objects.size, 1, "Failed database attachment deletes the orphan object");
    signed(4);
    const ess = await (await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).json();
    assert.equal(ess.employees.length, 1); assert.equal(ess.employees[0].id, staff[0].id);
    assert.ok(ess.claims.every((row: { employeeId: number; canDecide: boolean }) => row.employeeId === staff[0].id && !row.canDecide));
    assert.equal((await api.PATCH(request("PATCH", { id: claim.id, status: "approved" }))).status, 403);
    assert.equal((await api.GET(request("GET", undefined, "?organizationId=" + orgs[1].id))).status, 403);
    const selfClaim = await api.POST(request("POST", { ...body, employeeId: staff[1].id }));
    assert.equal(selfClaim.status, 201); const selfRow = await selfClaim.json(); assert.equal(selfRow.employeeId, staff[0].id);
    ambiguousPut = true;
    assert.equal((await upload(selfRow.id)).status, 503);
    const [intent] = await db.select().from(documents); assert.ok(intent); assert.equal(intent.scannedClean, false);
    assert.equal(objects.size, 2, "Ambiguous PUT does not race an immediate DELETE");
    const unreadable = await documentApi.GET(request("GET"), { params: Promise.resolve({ id: String(intent.id) }) });
    assert.equal(unreadable.status, 409, "Pending object can never be exposed through document download");
    const sweepTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "false"; failDelete = true;
    const retry = await recovery.sweepPendingSpendReceipts(sweepTime);
    assert.equal(retry.retryRequired, 1); assert.equal((await db.select().from(documents)).length, 1);
    failDelete = false;
    const cleaned = await recovery.sweepPendingSpendReceipts(sweepTime);
    assert.equal(cleaned.deleted, 1); assert.equal(objects.size, 1);
    assert.equal((await db.select().from(documents)).length, 0);
    assert.equal((await recovery.sweepPendingSpendReceipts(sweepTime)).deleted, 0, "Retry is idempotent");
    ambiguousPut = false; process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "true";
    // Even a stale intent cannot delete bytes referenced by a reviewed claim.
    const [attachedIntent] = await db.insert(documents).values({ organizationId: orgs[0].id, employeeId: staff[0].id,
      kind: "expense_receipt", fileName: "Synthetic stale intent", mimeType: "application/pdf", byteSize: 8,
      sha256: hash, scannedClean: false, sourceType: "upload", sourceKey: recovery.SPEND_PENDING_RECEIPT_PREFIX + "synthetic",
      uploadedBy: "Synthetic", content: "", objectStorageKey: verified.receiptStorageKey }).returning();
    assert.equal(await recovery.reconcilePendingSpendReceipt(attachedIntent.id), "referenced");
    assert.equal(objects.size, 1); await db.delete(documents).where(eq(documents.id, attachedIntent.id));
    signed(0);
    assert.equal((await api.PATCH(request("PATCH", { id: claim.id, status: "approved" }))).status, 403);
    signed(2);
    assert.equal((await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).status, 403);
    assert.equal((await receipts.GET(request("GET", undefined, "?claimId=" + claim.id))).status, 403);
    signed(3);
    assert.equal((await api.PATCH(request("PATCH", { id: claim.id, status: "approved" }))).status, 403);
    signed(1);
    const env: Record<string, string | undefined> = process.env;
    const oldNodeEnv = env.NODE_ENV; env.NODE_ENV = "production";
    process.env.APP_BASE_URL = "https://app.example.invalid";
    actor = { ...accounts[1], totpEnabled: false, mfaVerifiedAt: null };
    const secureRequest = new Request("https://app.example.invalid/api/expenses", { method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: "https://app.example.invalid" },
      body: JSON.stringify({ id: claim.id, status: "approved" }) });
    const mfa = await api.PATCH(secureRequest); assert.equal(mfa.status, 403); assert.equal((await mfa.json()).code, "MFA_REQUIRED");
    if (oldNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = oldNodeEnv;
    process.env.APP_BASE_URL = "http://127.0.0.1:3000"; signed(1);
    assert.equal((await api.PATCH(request("PATCH", { id: claim.id, status: "approved", approvedAmount: "500.01" }))).status, 422);
    const concurrent = await Promise.all([api.PATCH(request("PATCH", { id: claim.id, status: "approved", approvedAmount: "450.01" })),
      api.PATCH(request("PATCH", { id: claim.id, status: "approved", approvedAmount: "450.01" }))]);
    assert.deepEqual(concurrent.map(res => res.status).sort(), [200, 409]);
    const [evidence] = await db.select().from(expenseClaimEvidence).where(eq(expenseClaimEvidence.claimId, claim.id));
    assert.equal(evidence.approvedAmount, "450.01"); assert.equal(evidence.approvedByUserId, accounts[1].id);
    const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, orgs[0].id),
      eq(auditEvents.action, "Expense claim approved"))); assert.equal(audits.length, 1);
    // Report approval must inspect every underlying maker, not only the report submitter.
    const checkerClaim = await (await api.POST(request("POST", body))).json();
    await db.update(expenseClaimEvidence).set({ receiptStorageKey: `private-documents/${orgs[0].id}/${staff[0].id}/00000000-0000-4000-8000-000000000002`,
      receiptSha256: "b".repeat(64), receiptByteSize: 8, receiptVerifiedAt: new Date() }).where(eq(expenseClaimEvidence.claimId, checkerClaim.id));
    const [report] = await db.insert(expenseReports).values({ organizationId: orgs[0].id, employeeId: staff[0].id,
      submittedByUserId: accounts[0].id, title: "Synthetic report", totalAmount: "500.00", status: "submitted" }).returning();
    await db.insert(expenseReportItems).values({ organizationId: orgs[0].id, reportId: report.id, claimId: checkerClaim.id });
    assert.equal((await spend.PATCH(request("PATCH", { id: report.id, status: "approved" }))).status, 409);
    assert.equal((await db.select().from(expenseReports).where(eq(expenseReports.id, report.id)))[0].status, "submitted");
    assert.equal((await db.select().from(expenseClaims).where(eq(expenseClaims.id, checkerClaim.id)))[0].status, "pending");
    // Required audit write and the claim/evidence creation commit together.
    await pool.query("CREATE FUNCTION reject_spend_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'Expense claim submitted' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_spend_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_spend_audit()");
    const countBefore = (await db.select().from(expenseClaims)).length;
    await assert.rejects(api.POST(request("POST", body)));
    assert.equal((await db.select().from(expenseClaims)).length, countBefore);
    await pool.query("DROP TRIGGER reject_spend_audit ON audit_events; DROP FUNCTION reject_spend_audit()");
    // Database keys reject cross-employer attribution rather than relying only on route code.
    const [otherClaim] = await db.insert(expenseClaims).values({ ...body, organizationId: orgs[1].id,
      employeeId: staff[1].id, submittedByUserId: accounts[2].id, status: "pending" }).returning();
    await assert.rejects(db.insert(expenseClaimEvidence).values({ claimId: otherClaim.id, organizationId: orgs[1].id,
      employeeId: staff[1].id, categoryPolicyId: policy.id, taxable: false }), error =>
      (error as { cause?: { code?: string } }).cause?.code === "23503");
    // Rollback holds governed rows, but legacy reads keep their original JSON shape.
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "false";
    assert.equal((await spend.PATCH(request("PATCH", { id: report.id, status: "approved" }))).status, 409);
    const off = await (await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).json();
    assert.equal("reimbursementReviewEnabled" in off, false); assert.equal("approvedAmount" in off.claims[0], false);
    actor = null; assert.equal((await receipts.GET(request("GET", undefined, "?claimId=" + claim.id))).status, 404);
    // Rehearse the unnumbered proposal only in this generated schema, twice.
    await pool.query("DROP TABLE expense_claim_evidence; DROP TABLE expense_category_policies");
    assert.equal((await recovery.sweepPendingSpendReceipts()).enabled, false, "Pre-migration recovery does not query additive tables");
    signed(0);
    assert.equal((await api.POST(request("POST", { ...body, category: "Legacy" }))).status, 201);
    assert.equal((await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).status, 200);
    const proposal = readFileSync("docs/engineering/migration-proposals/spend-payroll-reimbursements.sql", "utf8");
    await pool.query(proposal); await pool.query(proposal);
    assert.equal((await api.GET(request("GET", undefined, "?organizationId=" + orgs[0].id))).status, 200);
  } finally {
    require.cache[authId]!.exports = originalAuth;
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior); await fixture.close();
  }
});
