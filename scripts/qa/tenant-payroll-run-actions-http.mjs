/**
 * Dedicated proof for three payroll-run methods that acted on a run id from the path:
 *   POST payroll-runs/[id]/pilot-signoff, GET payroll-runs/[id]/xendit-payout, and (evidence only) POST payroll-runs/[id]/exports
 *   in complete-manual mode.
 * Two independent attacker employers and a higher-ID victim (three fictional employers plus seven fillers so the victim's IDs
 * exceed six), each with a Released run per method, behind production-mode localhost HTTP on disposable PG16. Each attacker proves
 * a REAL own success (pilot sign-off recorded with system-derived figures; xendit status ledger with the own seeded row; manual
 * payout completion tied to the own bank validation) while forged organization/run/entity selectors are ignored, and then every
 * action aimed at the victim's run is refused with the victim's organization rows, owner and sessions byte-identical.
 * No payout provider is configured, reachable or called; nothing here moves money. Exports preflight/disburse need a provider and
 * are therefore NOT proven (their cross-tenant refusal is); the exports method receives no credit from this harness.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  FICTIONAL_FIGURES, FICTIONAL_LINE_ITEMS, PILOT_SIGNOFF_METHOD, RUN_ACTIONS_TITLE, XENDIT_STATUS_METHOD,
  assertPilotSignedOff, assertRefusal, assertRowsUnchanged, requireDisposablePayrollRunActions,
} from "./tenant-payroll-run-actions-contract.mjs";

export async function verifyPayrollRunActionsTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposablePayrollRunActions();
  const [{ db, pool }, schema, { eq, and }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { auditEvents, bankFileValidations, bankTemplates, payoutBatchTransfers, payoutBatches, payoutTransfers, payrollEntries, payrollRuns,
    payslips, users } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const sha = (text) => createHash("sha256").update(text).digest("hex");

  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "PAYROLL_RUN_ACTIONS_PROOF_REFUSED: genuinely empty disposable users required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);

    // One Released run per method, each seeded only with what that method reads.
    async function seedRuns(e) {
      // The database forbids overlapping Released runs per employer, so each run gets its own period.
      const makeRun = async (suffix, month) => {
        const [run] = await db.insert(payrollRuns).values({
          organizationId: e.org.id, legalEntityId: e.entity.id, scopeOrgUnitId: e.unit.id, periodLabel: e.marker + "-" + suffix,
          periodStart: "2026-" + month + "-01", periodEnd: "2026-" + month + "-15", payDate: "2026-" + month + "-16", status: "Released",
          employeeCount: 1, grossPay: "20000.00", netPay: "18000.00", processedChunks: 1, totalChunks: 1,
        }).returning();
        const [entry] = await db.insert(payrollEntries).values({
          payrollRunId: run.id, employeeId: e.worker.id, grossPay: "20000.00", deductions: "2000.00", netPay: "18000.00",
          lineItems: FICTIONAL_LINE_ITEMS,
        }).returning();
        return { run, entry };
      };
      const audit = (run, action, metadata = {}) => db.insert(auditEvents).values({
        organizationId: e.org.id, actor: e.marker + " owner", action, resource: run.periodLabel, metadata: { runId: run.id, ...metadata },
      });
      // Pilot run: every piece of system evidence the sign-off requires (release receipt, completed payout, payslip, journal).
      const pilot = await makeRun("PILOT", "07");
      await db.insert(payslips).values({ payrollEntryId: pilot.entry.id, organizationId: e.org.id, employeeId: e.worker.id,
        periodLabel: pilot.run.periodLabel, content: "Fictional payslip " + e.marker });
      await audit(pilot.run, "Payroll release receipt");
      await audit(pilot.run, "Payroll payout completed manually", { method: "bank-file", reference: "FICT-" + e.marker });
      await audit(pilot.run, "journal export generated", { kind: "journal" });
      // Exports run: a final bank export, an active template and an accepted bank validation for that template version.
      const exportsRun = await makeRun("EXPORTS", "08");
      const templateName = ("TPL-" + e.marker).slice(0, 100);
      await db.insert(bankTemplates).values({ name: templateName, version: "1", format: "csv", bankCode: "BPI", active: true, mappings: {} });
      const [validation] = await db.insert(bankFileValidations).values({ organizationId: e.org.id, payrollRunId: exportsRun.run.id,
        templateName, templateVersion: "1", fileName: "fictional-" + e.marker + ".csv", fileSha256: sha("bank-" + e.marker),
        status: "accepted", generatedBy: e.marker + " owner" }).returning();
      await audit(exportsRun.run, "bank export generated", { kind: "bank", dryRun: false, template: templateName });
      // Ledger run: purely pre-populated fictional Xendit ledger rows. Nothing is submitted anywhere.
      const ledger = await makeRun("LEDGER", "09");
      const amountCents = 1800000;
      const [batch] = await db.insert(payoutBatches).values({ organizationId: e.org.id, payrollRunId: ledger.run.id, provider: "xendit",
        idempotencyKey: "fictional-ledger-" + e.marker, requestHash: sha(e.marker), transferCount: 1, totalAmountCents: amountCents,
        status: "prepared" }).returning();
      const [transfer] = await db.insert(payoutTransfers).values({ organizationId: e.org.id, payrollRunId: ledger.run.id,
        payrollEntryId: ledger.entry.id, employeeId: e.worker.id, referenceNumber: e.marker + "-UNSENT", amountCents, status: "prepared" }).returning();
      await db.insert(payoutBatchTransfers).values({ organizationId: e.org.id, payoutBatchId: batch.id, payoutTransferId: transfer.id, status: "prepared" });
      return { pilot, exportsRun, ledger, templateName, validation, batch };
    }

    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    a.runs = await seedRuns(a);
    b.runs = await seedRuns(b);
    // Filler employers consume low IDs so the victim's org, user and run IDs exceed both attackers' and six.
    for (let i = 0; i < 7; i++) {
      const filler = await seedEmployer("FILL" + i, nonce, standaloneMakeSession);
      await seedRuns(filler);
    }
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    victim.runs = await seedRuns(victim);
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6) && victim.org.id > Math.max(a.org.id, b.org.id));
    for (const key of ["pilot", "exportsRun", "ledger"]) {
      assert.ok(victim.runs[key].run.id > Math.max(a.runs[key].run.id, b.runs[key].run.id, 6), "the victim run must be a real higher-ID row");
    }

    const orgTables = (await pool.query(`SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name`)).rows.map((row) => row.table_name);
    assert.ok(orgTables.includes("audit_events") && orgTables.includes("payroll_runs") && orgTables.includes("payout_batches"));
    const snapshot = async (e) => {
      const state = {};
      for (const name of orgTables) {
        assert.match(name, /^[a-z_0-9]+$/);
        state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [e.org.id])).rows.map((row) => row.row);
      }
      state.payroll_entries = (await pool.query(`SELECT to_jsonb(x) AS row FROM payroll_entries x JOIN payroll_runs r ON r.id=x.payroll_run_id
        WHERE r.organization_id=$1 ORDER BY x.id`, [e.org.id])).rows.map((row) => row.row);
      state.owner = (await pool.query(`SELECT to_jsonb(u) AS row FROM users u WHERE u.id=$1`, [e.owner.id])).rows.map((row) => row.row);
      state.sessions = (await pool.query(`SELECT to_jsonb(s) AS row FROM sessions s WHERE s.user_id=$1 ORDER BY s.id`, [e.owner.id])).rows.map((row) => row.row);
      state.bank_templates = (await pool.query(`SELECT to_jsonb(t) AS row FROM bank_templates t WHERE t.name=$1`, [("TPL-" + e.marker).slice(0, 100)])).rows.map((row) => row.row);
      return state;
    };
    const countAudit = async (e, action, runId) => (await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, e.org.id), eq(auditEvents.action, action))))
      .filter((row) => Number(row.metadata?.runId) === runId).length;
    const forbidden = [victim.marker, victim.owner.email, victim.worker.employeeNo];

    const run = (id, route) => "/api/payroll-runs/" + id + "/" + route;
    const signoffBody = (e, overrides = {}) => ({
      evidenceReference: "EVIDENCE-" + e.marker, independentPreparedBy: "Fictional Independent Preparer",
      reconciliationReportSha256: sha("report-" + e.marker), independentSourceConfirmed: true,
      employeeLevelReconciliationConfirmed: true, operatorCompletedWithoutDeveloper: true, reconciledEmployeeCount: 1,
      independentFigures: FICTIONAL_FIGURES, ...overrides,
    });
    const forgedFor = (victimEmployer) => ({
      organizationId: victimEmployer.org.id, legalEntityId: victimEmployer.entity.id, runId: victimEmployer.runs.pilot.run.id,
      userId: victimEmployer.owner.id, employeeId: victimEmployer.worker.id,
    });
    const crossSite = async (path, cookie, body) => {
      const response = await fetch(new URL(path, process.env.SECURITY_SMOKE_URL), {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: { cookie, origin: "https://attacker.example.test", "sec-fetch-site": "cross-site", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text(), headers: response.headers, json: null };
    };

    const journeys = {};
    for (const [attacker, other, key] of [[a, b, "A"], [b, a, "B"]]) {
      const victimBefore = await snapshot(victim);
      const otherBefore = await snapshot(other);
      const own = attacker.runs;

      // ---- GET xendit-payout: a real own ledger, forged selectors ignored ----
      const status = await standaloneRequest(run(own.ledger.run.id, "xendit-payout") + "?organizationId=" + victim.org.id
        + "&runId=" + victim.runs.ledger.run.id, { cookie: attacker.cookie });
      assert.equal(status.status, 200, "own xendit ledger read: " + status.text.slice(0, 300));
      assert.equal(status.json?.ledger?.batchId, own.batch.id, "the ledger belongs to the own batch");
      assert.equal(status.json.ledger.rows.length, 1);
      assert.equal(status.json.ledger.rows[0].employeeNo, attacker.worker.employeeNo);
      assert.equal(status.json.ledger.rows[0].referenceNumber, attacker.marker + "-UNSENT");
      assert.equal(status.json.ledger.rows[0].status, "prepared");
      assert.ok(!status.text.includes(victim.marker) && !status.text.includes(other.marker), "the ledger names only the own employer");
      assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + key + "'s ledger read");

      // ---- POST pilot-signoff: incomplete / mismatching attempts write nothing, then the real own sign-off ----
      const auditBeforeSignoff = await countAudit(attacker, "Production payroll pilot signed off", own.pilot.run.id);
      assert.equal(auditBeforeSignoff, 0);
      const pilotPath = run(own.pilot.run.id, "pilot-signoff");
      const unconfirmed = await standaloneRequest(pilotPath, { method: "POST", cookie: attacker.cookie, body: signoffBody(attacker, { independentSourceConfirmed: false }) });
      assertRefusal(unconfirmed, 400, forbidden);
      const wrongNet = await standaloneRequest(pilotPath, { method: "POST", cookie: attacker.cookie,
        body: signoffBody(attacker, { independentFigures: { ...FICTIONAL_FIGURES, netPay: 18000.5 } }) });
      assertRefusal(wrongNet, 409, forbidden);
      assert.ok(String(wrongNet.json?.error).includes("netPay"), "a mismatching independent figure is refused by name");
      assert.equal(await countAudit(attacker, "Production payroll pilot signed off", own.pilot.run.id), 0, "refused attempts write no sign-off");
      const signedOff = assertPilotSignedOff(await standaloneRequest(pilotPath, { method: "POST", cookie: attacker.cookie,
        body: signoffBody(attacker, forgedFor(victim)) }), own.pilot.run.id);
      assert.equal(await countAudit(attacker, "Production payroll pilot signed off", own.pilot.run.id), 1, "exactly one own sign-off row");
      const signoffRow = (await db.select().from(auditEvents).where(eq(auditEvents.id, signedOff.auditEventId)))[0];
      assert.equal(signoffRow.organizationId, attacker.org.id, "the sign-off belongs to the own employer");
      assert.equal(Number(signoffRow.metadata.runId), own.pilot.run.id);
      assert.equal(signoffRow.metadata.payoutEvidenceMode, "completed-payout");
      const replay = await standaloneRequest(pilotPath, { method: "POST", cookie: attacker.cookie, body: signoffBody(attacker) });
      assert.equal(replay.status, 200);
      assert.equal(replay.json?.alreadyRecorded, true, "a replayed sign-off is the same single record");
      assert.equal(replay.json.auditEventId, signedOff.auditEventId);
      assert.equal(await countAudit(attacker, "Production payroll pilot signed off", own.pilot.run.id), 1, "a replay writes nothing");

      // ---- POST exports, complete-manual: tied to the OWN bank validation and template (evidence only; no credit) ----
      const exportsPath = run(own.exportsRun.run.id, "exports");
      const completed = await standaloneRequest(exportsPath, { method: "POST", cookie: attacker.cookie,
        body: { mode: "complete-manual", reference: "BANKREF-" + attacker.marker, confirmed: true, organizationId: victim.org.id } });
      assert.equal(completed.status, 200, "own manual completion: " + completed.text.slice(0, 300));
      assert.equal(completed.json?.completed, true);
      assert.equal(completed.json.moneyMovedByLinaw, false);
      const completion = (await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, attacker.org.id), eq(auditEvents.action, "Payroll payout completed manually"))))
        .filter((row) => Number(row.metadata?.runId) === own.exportsRun.run.id);
      assert.equal(completion.length, 1, "exactly one own manual completion row");
      assert.equal(completion[0].metadata.bankValidationId, own.validation.id, "the completion is tied to the own accepted bank validation");
      assert.equal(completion[0].metadata.bankTemplateName, own.templateName);
      assert.equal(completion[0].metadata.completionRecordedByUserId, attacker.owner.id);
      assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + key + "'s own journey");

      // ---- Every action aimed at the victim's runs is refused and changes nothing ----
      const denials = [
        ["pilot-signoff", victim.runs.pilot.run.id, "POST", signoffBody(attacker, forgedFor(attacker))],
        ["exports preflight", victim.runs.exportsRun.run.id, "POST", { mode: "preflight", organizationId: attacker.org.id }],
        ["exports disburse", victim.runs.exportsRun.run.id, "POST", { mode: "disburse", confirm: true, organizationId: attacker.org.id }],
        ["exports complete-manual", victim.runs.exportsRun.run.id, "POST", { mode: "complete-manual", reference: "BANKREF-FORGED-" + key, confirmed: true, organizationId: attacker.org.id }],
        ["xendit-payout GET", victim.runs.ledger.run.id, "GET"],
        ["xendit-payout POST preflight", victim.runs.ledger.run.id, "POST", { action: "preflight", organizationId: attacker.org.id }],
      ];
      for (const [label, id, method, body] of denials) {
        const route = label.startsWith("pilot") ? "pilot-signoff" : label.startsWith("exports") ? "exports" : "xendit-payout";
        const refused = await standaloneRequest(run(id, route), { method, cookie: attacker.cookie, body });
        assertRefusal(refused, 403, forbidden);
        assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + key + "'s " + label + " refusal");
      }
      // No session and a cross-site request with a valid cookie are refused before anything is read or written.
      const anonymous = await standaloneRequest(pilotPath, { method: "POST", body: signoffBody(attacker) });
      assertRefusal(anonymous, 401, forbidden);
      assertRefusal(await standaloneRequest(run(own.ledger.run.id, "xendit-payout")), 401, forbidden);
      const siteBefore = await snapshot(attacker);
      assertRefusal(await crossSite(exportsPath, attacker.cookie, { mode: "complete-manual", reference: "BANKREF-CROSS-" + key, confirmed: true }), 403, forbidden);
      assertRowsUnchanged(siteBefore, await snapshot(attacker), "the own employer after a cross-site manual completion");

      // The victim and the other attacker are byte-identical after this attacker's complete journey.
      assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + key + "'s complete journey");
      assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + key + "'s complete journey");
      journeys[key] = { signoffAuditId: signedOff.auditEventId, completionAuditId: completion[0].id, ledgerBatchId: status.json.ledger.batchId };
    }
    assert.notEqual(journeys.A.signoffAuditId, journeys.B.signoffAuditId, "A's sign-off evidence cannot satisfy B's");
    assert.notEqual(journeys.A.ledgerBatchId, journeys.B.ledgerBatchId, "A's ledger cannot satisfy B's");
    // The victim's own pilot run was never signed off by anyone but the victim, and has no sign-off, completion or ledger change.
    assert.equal(await countAudit(victim, "Production payroll pilot signed off", victim.runs.pilot.run.id), 0, "no sign-off was ever recorded for the victim");

    console.log(JSON.stringify({
      kind: RUN_ACTIONS_TITLE, methods: [PILOT_SIGNOFF_METHOD, XENDIT_STATUS_METHOD], independentAttackers: 2, higherIdVictim: true,
      own: ["pilot sign-off recorded with system-derived figures", "replayed sign-off is one record", "xendit ledger shows only the own row",
        "manual completion tied to the own bank validation"],
      refusals: ["pilot-signoff", "exports preflight", "exports disburse", "exports complete-manual", "xendit GET", "xendit POST", "anonymous", "cross-site"],
      forgedSelectorsIgnored: true, victimByteIdentical: true, providersContacted: 0, moneyMoved: false,
      productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { methods: [PILOT_SIGNOFF_METHOD, XENDIT_STATUS_METHOD], credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-payroll-run-actions-http.mjs")) {
  verifyPayrollRunActionsTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Payroll run actions isolation proof failed");
    process.exitCode = 1;
  });
}
