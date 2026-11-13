/**
 * Dedicated POST /api/payroll-runs/[id]/exports proof: all three modes (preflight, disburse, complete-manual).
 *
 * Real production-mode HTTP against disposable PostgreSQL 16. PayMongo is a LOOPBACK-ONLY SYNTHETIC server on
 * 127.0.0.1:3012 reached through scripts/qa/paymongo-http-proof-preload.mjs with the credential
 * sk_test_synthetic_no_network: no real provider is contacted and no real money can move. This proves the tenant
 * boundary of the route, never real PayMongo behavior or a real payout.
 *
 * Two attacker employers each run their OWN preflight, own disbursement and own manual completion; the higher-ID
 * victim's released runs are refused for every mode and every attacker actor, the synthetic provider is never
 * contacted for a refusal, and the victim's payroll, payout and audit rows are compared before and after.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { assertPaymongoHttpProofTarget } from "./paymongo-http-proof-target.mjs";
import {
  EXPORTS_POST_METHOD, EXPORTS_POST_TITLE, assertDisbursementPayload, assertExportsDenial, assertRowsUnchanged,
} from "./tenant-payroll-exports-post-contract.mjs";

export async function verifyPayrollExportsPostTenantIsolation() {
  // No database or application import may run before this guard.
  assertPaymongoHttpProofTarget(process.env);
  assert.equal(process.env.MONEY_PROOF_TRANSPORT, "http", "EXPORTS_POST_PROOF_REFUSED: real HTTP only");
  const { db, pool } = await import("../../src/db/index.ts");
  const s = await import("../../src/db/schema.ts");
  const { eq } = await import("drizzle-orm");
  const { encryptBankAccount } = await import("../../src/lib/bank-account-crypto.ts");
  const base = process.env.MONEY_PROOF_URL;

  // Loopback-only synthetic PayMongo. Every call is recorded; a POST is honored only while an own submission is open.
  const providerCalls = [];
  let openSubmission = null;
  const provider = createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      assert.equal(req.headers.authorization, "Basic " + Buffer.from("sk_test_synthetic_no_network:").toString("base64"));
      let body = "";
      for await (const chunk of req) { body += chunk; assert.ok(body.length <= 1_000_000); }
      providerCalls.push({ method: req.method, url: req.url });
      if (req.method === "GET" && req.url.startsWith("/v2/transfers/receiving_institutions?")) {
        return reply(200, { data: [{ attributes: { name: "BPI", bic: "BOPIPHMM" } }] });
      }
      if (req.method === "GET" && req.url === "/v2/wallets/wallet_synthetic") {
        return reply(200, { data: { id: "wallet_synthetic", attributes: { status: "active",
          balance: { available: 100000000, pending: 0 }, account: { account_number: "0000000001", account_name: "Fictional Wallet" } } } });
      }
      if (req.method === "POST" && req.url === "/v2/batch_transfers" && openSubmission) {
        const payload = JSON.parse(body);
        openSubmission.posts.push({ payload, idempotencyKey: req.headers["idempotency-key"] });
        return reply(200, { data: { id: "batch_tr_exports_" + openSubmission.runId, transfers: payload.transfers.map((t, i) => ({
          id: "tr_exports_" + openSubmission.runId + "_" + i, reference_number: t.reference_number, amount: t.amount,
          provider: "pesonet", status: "pending" })) } });
      }
      return reply(500, { errors: [{ detail: "Unregistered synthetic provider call " + req.method + " " + req.url }] });
    } catch (error) {
      return reply(500, { errors: [{ detail: error.message }] });
    }
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(3012, "127.0.0.1", resolve); });

  try {
    for (const [name, table] of [["organizations", s.organizations], ["payroll_runs", s.payrollRuns], ["audit_events", s.auditEvents]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "EXPORTS_POST_PROOF_REFUSED: genuinely empty disposable " + name + " required");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);

    async function request(path, cookie, method = "GET", body, headers = {}) {
      const response = await fetch(new URL(path, base), {
        method, redirect: "manual", cache: "no-store",
        headers: { ...(cookie ? { cookie } : {}), origin: base, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json, headers: [...response.headers] };
    }
    async function login(org, label, role = "owner") {
      const [user] = await db.insert(s.users).values({ email: `${label}-${nonce}@example.invalid`.toLowerCase(),
        name: `${label}-${nonce}`, role, passwordHash: "synthetic-no-password-login", totpEnabled: true }).returning();
      await db.insert(s.userOrganizations).values({ userId: user.id, organizationId: org.id, role, active: true });
      const raw = randomBytes(32).toString("hex");
      const [session] = await db.insert(s.sessions).values({ userId: user.id,
        tokenHash: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 3600000),
        lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc" }).returning();
      return { user, session, cookie: "__Host-linaw_session=" + raw };
    }
    async function releasedRun(org, entity, worker, label, start, end, payDate) {
      const [run] = await db.insert(s.payrollRuns).values({ organizationId: org.id, legalEntityId: entity.id,
        periodLabel: label, periodStart: start, periodEnd: end, payDate, status: "Released",
        employeeCount: 1, grossPay: "30000.00", netPay: "28000.00" }).returning();
      await db.insert(s.payrollEntries).values({ payrollRunId: run.id, employeeId: worker.id,
        grossPay: "30000.00", deductions: "2000.00", netPay: "28000.00",
        trace: { payment: { employeeName: worker.firstName + " " + worker.lastName, employeeNo: worker.employeeNo,
          bankAccount: worker.bankAccount, bankCode: worker.bankCode, mobile: worker.mobile } },
        lineItems: [{ code: "BASIC", label: "Basic pay", amount: 30000 }, { code: "WHT", label: "Withholding tax", amount: -2000 }] });
      return run;
    }
    async function seed(label) {
      const [org] = await db.insert(s.organizations).values({ name: `EXP ${label} ${nonce}`, legalName: `Fictional ${label}` }).returning();
      const [entity] = await db.insert(s.legalEntities).values({ organizationId: org.id, code: label.slice(0, 12),
        legalName: `Fictional ${label}`, displayName: label, primaryEntity: true }).returning();
      const owner = await login(org, label + "owner");
      const second = await login(org, label + "second");
      const employeeUser = await login(org, label + "employee", "employee");
      const [worker] = await db.insert(s.employees).values({ organizationId: org.id, legalEntityId: entity.id,
        employeeNo: `EXP-${label}-${nonce}`, firstName: label, lastName: "Synthetic", title: "Fictional worker",
        avatarInitials: "ES", basicRate: "60000.00", startDate: "2025-01-01", region: "NCR",
        bankCode: "BPI", bankAccount: encryptBankAccount("000000000001") }).returning();
      await db.insert(s.employeePayProfiles).values({ organizationId: org.id, employeeId: worker.id,
        payBasis: "monthly", rateAmount: "60000.00", standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00" });
      const provider = await releasedRun(org, entity, worker, `EXP ${label} provider run`, "2025-12-01", "2025-12-15", "2025-12-16");
      const manual = await releasedRun(org, entity, worker, `EXP ${label} manual run`, "2025-12-16", "2025-12-31", "2026-01-02");
      const [draft] = await db.insert(s.payrollRuns).values({ organizationId: org.id, legalEntityId: entity.id,
        periodLabel: `EXP ${label} draft`, periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-16", status: "Draft" }).returning();
      return { label, org, entity, owner, second, employeeUser, worker, provider, manual, draft };
    }
    async function snapshot(e) {
      const tables = (await pool.query(`SELECT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='organization_id'
        AND table_name ~ '^(payroll|payout|approval|audit|bank|treasury|employee|outbox|webhook)' ORDER BY table_name`)).rows.map((r) => r.table_name);
      const state = {};
      for (const name of tables) {
        assert.match(name, /^[a-z_]+$/);
        state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [e.org.id])).rows;
      }
      state.payroll_entries = (await pool.query(`SELECT to_jsonb(x) AS row FROM payroll_entries x JOIN payroll_runs r
        ON r.id=x.payroll_run_id WHERE r.organization_id=$1 ORDER BY x.id`, [e.org.id])).rows;
      return state;
    }
    const audits = async (e, action, runId) => (await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, e.org.id)))
      .filter((row) => row.action === action && Number(row.metadata?.runId) === runId);

    const a = await seed("ATTA"), b = await seed("ATTB");
    for (let i = 0; i < 7; i++) await seed("PAD" + i);
    const v = await seed("VICTIM");
    for (const [name, victimId, attackerMax] of [
      ["organization", v.org.id, Math.max(a.org.id, b.org.id)], ["provider run", v.provider.id, Math.max(a.provider.id, b.provider.id, a.manual.id, b.manual.id)],
      ["manual run", v.manual.id, Math.max(a.manual.id, b.manual.id)], ["worker", v.worker.id, Math.max(a.worker.id, b.worker.id)],
    ]) assert.ok(victimId > Math.max(attackerMax, 6), "victim " + name + " must be a real persisted row with an ID above both attackers and six");

    const path = (run) => `/api/payroll-runs/${run.id}/exports`;
    const forbidden = [v.worker.employeeNo, v.org.name, v.provider.periodLabel, v.manual.periodLabel,
      v.owner.cookie.split("=")[1], a.owner.cookie.split("=")[1], b.owner.cookie.split("=")[1]];
    const modes = [
      { mode: "preflight" }, { mode: "disburse", confirm: true },
      { mode: "complete-manual", reference: "FICTIONAL-BANK-REF-1", confirmed: true },
    ];
    let refusals = 0;
    async function refused(promise, status, label) {
      const calls = providerCalls.length;
      const response = await promise;
      assertExportsDenial(response, status, forbidden, label);
      assert.equal(providerCalls.length, calls, label + ": a refusal must never contact the synthetic provider");
      refusals++;
      return response;
    }

    // A manual completion needs a real final bank file and a recorded accepted bank validation for its template.
    const templateName = "FICTIONAL-EXPORTS-" + nonce;
    await db.insert(s.bankTemplates).values({ name: templateName, version: "fictional-v1", format: "CSV",
      mappings: { columns: ["employee_no", "account_number", "amount"], includeHeader: true }, adapterStage: "draft", specSource: "unknown" });
    async function prepareManual(e, withValidation = true) {
      const bank = await request(path(e.manual) + "?kind=bank&dryRun=false&template=" + encodeURIComponent(templateName), e.owner.cookie);
      assert.equal(bank.status, 200, "own final bank file must be generated over HTTP: " + bank.text.slice(0, 300));
      const [exportAudit] = (await audits(e, "bank export generated", e.manual.id)).filter((row) => row.metadata?.kind === "bank" && row.metadata?.dryRun !== true);
      assert.ok(exportAudit?.metadata?.template, "the real bank export audit names its template");
      const [template] = (await db.select().from(s.bankTemplates)).filter((t) => t.name === exportAudit.metadata.template && t.active);
      assert.ok(template, "the exported template is a real active template");
      if (!withValidation) return template;
      await db.insert(s.bankFileValidations).values({ organizationId: e.org.id, templateName: template.name,
        templateVersion: template.version, fileName: "fictional-uat.txt", fileSha256: "a".repeat(64), status: "accepted",
        portalReference: "FICTIONAL-UAT-" + e.label, generatedBy: e.owner.user.name, recordedBy: e.second.user.name, recordedAt: new Date() });
      return template;
    }
    for (const e of [a, b, v]) e.template = await prepareManual(e);
    // An employer with a real final bank file but NO accepted validation of its own cannot borrow the victim's or an
    // attacker's accepted validation of the same shared template.
    const borrower = await seed("BORROW");
    await prepareManual(borrower, false);
    const borrowed = await request(path(borrower.manual), borrower.owner.cookie, "POST",
      { mode: "complete-manual", reference: "FICTIONAL-BORROWED-REF", confirmed: true });
    assert.equal(borrowed.status, 409, "another employer's accepted bank validation must not be borrowed: " + borrowed.text.slice(0, 300));
    assert.ok(String(borrowed.json?.error).includes("has not passed recorded bank-portal UAT"), "refused for the wrong reason: " + borrowed.text.slice(0, 200));
    assert.equal((await audits(borrower, "Payroll payout completed manually", borrower.manual.id)).length, 0);

    // Victim positive: its own preflight on its control run proves the provider path is reachable. Its attacked run stays untouched.
    const victimPreflight = await request(path(v.manual), v.owner.cookie, "POST", { mode: "preflight" });
    assert.equal(victimPreflight.status, 200, "victim own preflight: " + victimPreflight.text.slice(0, 300));
    assert.equal(victimPreflight.json.moneyMoved, false);
    const baseline = new Map(await Promise.all([a, b, v].map(async (e) => [e.org.id, await snapshot(e)])));
    const unchanged = async (label, employers = [a, b, v]) => {
      for (const e of employers) assertRowsUnchanged(baseline.get(e.org.id), await snapshot(e), e.label + " " + label);
    };

    // Refusals. None may reach the synthetic provider, leak a victim marker or change any employer's rows.
    for (const attacker of [a, b]) {
      for (const actor of [attacker.owner, attacker.second, attacker.employeeUser]) {
        for (const run of [v.provider, v.manual]) {
          for (const body of modes) {
            await refused(request(path(run), actor.cookie, "POST", { ...body, organizationId: attacker.org.id, legalEntityId: attacker.entity.id }), 404,
              "foreign " + body.mode + " on the victim run");
          }
        }
      }
      for (const body of modes) {
        await refused(request(path(attacker.provider), attacker.employeeUser.cookie, "POST", body), 403, "own employee role " + body.mode);
        await refused(request(path(attacker.provider), undefined, "POST", body), 401, "anonymous " + body.mode);
        await refused(request(path(attacker.provider), attacker.owner.cookie, "POST", body,
          { origin: "https://attacker.example.test", "sec-fetch-site": "cross-site" }), 403, "cross-site " + body.mode);
        await refused(request(`/api/payroll-runs/not-a-number/exports`, attacker.owner.cookie, "POST", body), 400, "malformed run ID " + body.mode);
        await refused(request(path(attacker.draft), attacker.owner.cookie, "POST", body), 409, "unreleased own run " + body.mode);
      }
      await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, attacker.second.session.id));
      for (const body of modes) await refused(request(path(attacker.provider), attacker.second.cookie, "POST", body), 403, "missing MFA " + body.mode);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, attacker.second.session.id));
      await refused(request(path(attacker.provider), attacker.owner.cookie, "POST", { mode: "disburse" }), 400, "disburse without explicit confirmation");
      await refused(request(path(attacker.provider), attacker.owner.cookie, "POST", { mode: "disburse", confirm: true }), 409, "disburse before a passed preflight");
      await refused(request(path(attacker.manual), attacker.owner.cookie, "POST", { mode: "complete-manual", reference: "x", confirmed: true }), 400, "manual completion with a short reference");
      await refused(request(path(attacker.manual), attacker.owner.cookie, "POST", { mode: "complete-manual", reference: "FICTIONAL-REF" }), 400, "manual completion without confirmation");
    }
    // The session rows changed (MFA toggled and restored with a new timestamp) are not in the snapshot; nothing else may differ.
    await unchanged("after every refusal");

    // Own journeys. Untrusted body selectors that name the victim must be ignored.
    const forgedBody = { organizationId: v.org.id, legalEntityId: v.entity.id, runId: v.provider.id, employeeId: v.worker.id };
    const receipts = [];
    for (const e of [a, b]) {
      const others = new Map();
      for (const other of [a, b, v].filter((x) => x !== e)) others.set(other, await snapshot(other));

      // 1. Preflight: provider reads only, an own audit, no transfer.
      let calls = providerCalls.length;
      const pre = await request(path(e.provider), e.second.cookie, "POST", { mode: "preflight", ...forgedBody });
      assert.equal(pre.status, 200, e.label + " own preflight: " + pre.text.slice(0, 300));
      assert.equal(pre.json.ready, true); assert.equal(pre.json.moneyMoved, false);
      assert.ok(providerCalls.slice(calls).length > 0 && providerCalls.slice(calls).every((c) => c.method === "GET"), "preflight performs provider reads only");
      assert.equal((await audits(e, "PayMongo payroll preflight passed", e.provider.id)).length, 1);
      assert.ok(!pre.text.includes(v.worker.employeeNo), "own preflight leaked the victim worker");

      // 2. Disbursement: exactly one synthetic batch, for the own run and the own worker only.
      openSubmission = { runId: e.provider.id, posts: [] };
      calls = providerCalls.length;
      const paid = await request(path(e.provider), e.owner.cookie, "POST", { mode: "disburse", confirm: true, ...forgedBody });
      assert.equal(paid.status, 200, e.label + " own disbursement: " + paid.text.slice(0, 300));
      assert.equal(openSubmission.posts.length, 1, "exactly one synthetic batch transfer is created");
      assertDisbursementPayload(openSubmission.posts[0], { runId: e.provider.id, employeeNo: e.worker.employeeNo, amountCents: 2800000, account: "000000000001" });
      assert.equal(paid.json.batchId, "batch_tr_exports_" + e.provider.id);
      assert.equal(paid.json.transfers.length, 1);
      assert.equal(paid.json.transfers[0].referenceNumber, `PAY-${e.provider.id}-${e.worker.employeeNo}`);
      assert.ok(!paid.text.includes(v.worker.employeeNo), "own disbursement leaked the victim worker");
      assert.equal((await audits(e, "Payroll payout submission initiated via PayMongo", e.provider.id)).length, 1);
      const submitted = await audits(e, "Payroll payout submitted via PayMongo", e.provider.id);
      assert.equal(submitted.length, 1);
      assert.equal(submitted[0].metadata.batchId, paid.json.batchId);
      // A replay never sends a second batch.
      const replay = await request(path(e.provider), e.owner.cookie, "POST", { mode: "disburse", confirm: true });
      assert.equal(replay.status, 409, "disbursement replay: " + replay.text.slice(0, 300));
      assert.equal(openSubmission.posts.length, 1, "a replay must not create a second batch transfer");
      openSubmission = null;
      // A provider-paid run cannot also be recorded as a manual completion.
      const crossRail = await request(path(e.provider), e.owner.cookie, "POST", { mode: "complete-manual", reference: "FICTIONAL-BANK-REF-1", confirmed: true });
      assert.equal(crossRail.status, 409, "manual completion on a provider-paid run: " + crossRail.text.slice(0, 300));

      // 3. Manual completion of the second released run, bound to the real bank export and accepted validation.
      calls = providerCalls.length;
      const manual = await request(path(e.manual), e.owner.cookie, "POST", { mode: "complete-manual", reference: "FICTIONAL-BANK-REF-" + e.label, confirmed: true, ...forgedBody });
      assert.equal(manual.status, 200, e.label + " own manual completion: " + manual.text.slice(0, 300));
      assert.equal(manual.json.completed, true); assert.equal(manual.json.moneyMovedByLinaw, false);
      assert.equal(manual.json.reference, "FICTIONAL-BANK-REF-" + e.label);
      assert.equal(providerCalls.length, calls, "a manual completion never contacts the provider");
      const completed = await audits(e, "Payroll payout completed manually", e.manual.id);
      assert.equal(completed.length, 1);
      assert.equal(completed[0].metadata.bankTemplateName, e.template.name);
      assert.equal(completed[0].metadata.completionRecordedByUserId, e.owner.user.id);
      const again = await request(path(e.manual), e.owner.cookie, "POST", { mode: "complete-manual", reference: "FICTIONAL-OTHER-REF", confirmed: true });
      assert.equal(again.status, 200); assert.equal(again.json.alreadyRecorded, true);
      assert.equal(again.json.reference, "FICTIONAL-BANK-REF-" + e.label, "a replay returns the first recorded reference");
      assert.equal((await audits(e, "Payroll payout completed manually", e.manual.id)).length, 1);

      for (const [other, snap] of others) assertRowsUnchanged(snap, await snapshot(other), other.label + " after " + e.label + " journey");
      for (const action of ["PayMongo payroll preflight passed", "Payroll payout submitted via PayMongo", "Payroll payout completed manually"]) {
        assert.equal((await audits(v, action, v.provider.id)).length, 0, "no " + action + " may exist for the attacked victim run");
      }
      receipts.push({ organizationId: e.org.id, preflight: true, disbursedBatch: paid.json.batchId, manualReference: manual.json.reference });
    }
    assert.notEqual(receipts[0].disbursedBatch, receipts[1].disbursedBatch, "each attacker's batch is bound to its own run");
    assertRowsUnchanged(baseline.get(v.org.id), await snapshot(v), "victim after both complete attacker journeys");
    assert.equal(providerCalls.filter((c) => c.method === "POST").length, 2, "exactly two synthetic batch transfers in the whole proof");

    console.log(JSON.stringify({
      kind: EXPORTS_POST_TITLE, method: EXPORTS_POST_METHOD, independentAttackers: 2, employers: 3, higherIdVictim: true,
      modes: ["preflight", "disburse", "complete-manual"], ownJourneys: receipts.length, refusals,
      syntheticProviderOnly: true, syntheticBatchTransfers: 2, realProviderContacted: false, realMoneyMoved: false,
      victimOwnPositive: true, fullSnapshotsUnchanged: true, productionTested: false, coverageCredits: 0, independentlyAccepted: false,
      knownFindingsNotClosedByThisProof: ["full run-ID oracle closure is tracked by the separate nineteen-method comparison and renewal cohort"],
    }));
    return { method: EXPORTS_POST_METHOD, credited: 0 };
  } finally {
    await new Promise((resolve) => provider.close(resolve));
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-payroll-exports-post-http.mjs")) {
  verifyPayrollExportsPostTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.message : "Payroll exports POST proof failed");
    process.exitCode = 1;
  });
}
