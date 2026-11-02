/**
 * Proof only: PayMongo transfer callback, real localhost HTTP, fictional PG16.
 * A valid provider signature is PLATFORM-scoped: it may report genuine A, B or
 * victim transfers. Tenant isolation is the exact run + its own audit receipt
 * (transfer id, reference and amount). Cross-bound combinations must be ignored.
 * No payout call, bank connection, production data or coverage credit.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { requireDisposablePaymongoTransferWebhook } from "./tenant-webhook-paymongo-transfer-contract.mjs";

const ENDPOINT = "/api/webhooks/paymongo/transfers";

export async function provePaymongoTransferWebhook() {
  // No application or database imports are permitted before this hard refusal.
  requireDisposablePaymongoTransferWebhook();
  const [database, s, drizzle, helpers] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { db, pool } = database;
  const { eq, asc } = drizzle;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "PAYMONGO_WEBHOOK_REFUSED: PostgreSQL 16 is required");
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "Only a fresh empty disposable database may be used");

    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    const employers = [a, b, victim];
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id, "victim employer must have higher real ID");

    async function seedSubmittedTransfer(employer) {
      const [run] = await db.insert(s.payrollRuns).values({
        organizationId: employer.org.id,
        legalEntityId: employer.entity.id,
        periodLabel: "Fictional no-money PayMongo webhook " + employer.marker,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-15",
        payDate: "2026-10-20",
        status: "Released",
        employeeCount: 1,
        grossPay: "100.00",
        netPay: "100.00",
      }).returning();
      const transferId = "tr_synthetic_" + employer.label + "_" + nonce;
      const referenceNumber = "PAY-" + run.id + "-" + employer.worker.employeeNo;
      await db.insert(s.auditEvents).values({
        organizationId: employer.org.id,
        actor: "Fictional offline test fixture",
        action: "Payroll payout submitted via PayMongo",
        resource: run.periodLabel,
        metadata: { runId: run.id, transfers: [{
          id: transferId, referenceNumber, amountCents: 10000,
        }] },
      });
      return { run, transferId, referenceNumber, amountCents: 10000 };
    }
    for (const employer of employers) employer.payout = await seedSubmittedTransfer(employer);
    assert.ok(victim.payout.run.id > a.payout.run.id && victim.payout.run.id > b.payout.run.id,
      "real victim payroll run ID must exceed both attacker run IDs");

    async function employerState(employer) {
      const id = employer.org.id;
      const rows = async table => db.select().from(table).where(eq(table.organizationId, id)).orderBy(asc(table.id));
      return JSON.parse(JSON.stringify({
        payrollRuns: await rows(s.payrollRuns),
        auditEvents: await rows(s.auditEvents),
        providerEvents: await rows(s.providerEvents),
        employees: await rows(s.employees),
        payoutBatches: await rows(s.payoutBatches),
        payoutTransfers: await rows(s.payoutTransfers),
        payoutBatchTransfers: await rows(s.payoutBatchTransfers),
      }));
    }
    const snapshots = async () => Object.fromEntries(await Promise.all(
      employers.map(async e => [e.label, await employerState(e)])
    ));
    async function unchangedExcept(before, ...allowed) {
      const after = await snapshots();
      for (const e of employers) {
        if (!allowed.includes(e.label)) {
          assert.deepEqual(after[e.label], before[e.label], e.label + ": victim payroll and audit rows unchanged");
        }
      }
      return after;
    }

    function eventBody(employer, options = {}) {
      const transferId = options.transferId ?? employer.payout.transferId;
      const reference = options.reference ?? employer.payout.referenceNumber;
      const amount = options.amount ?? employer.payout.amountCents;
      return {
        data: {
          id: options.eventId ?? "evt_synthetic_" + randomBytes(12).toString("hex"),
          attributes: {
            type: "transfer.outward.successful",
            livemode: true,
            created_at: Math.floor(Date.now() / 1000),
            // Extra caller-supplied tenant selectors are not authority.
            organizationId: options.organizationId,
            data: {
              id: transferId,
              attributes: {
                transfer_id: transferId,
                reference_number: reference,
                amount,
                status: "succeeded",
                organizationId: options.organizationId,
                legalEntityId: options.legalEntityId,
                employeeId: options.employeeId,
                provider: "synthetic",
              },
            },
          },
        },
        organizationId: options.organizationId,
        runId: options.runId,
      };
    }
    function signature(raw, slot = "li") {
      const time = Math.floor(Date.now() / 1000);
      const digest = createHmac("sha256", secret).update(String(time) + "." + raw).digest("hex");
      return "t=" + time + "," + slot + "=" + digest;
    }
    async function send(body, { missingSignature = false, wrongSignature = false, testSlot = false } = {}) {
      const raw = JSON.stringify(body);
      const headers = { "content-type": "application/json" };
      if (!missingSignature) {
        headers["paymongo-signature"] = wrongSignature
          ? "t=" + Math.floor(Date.now() / 1000) + ",li=" + "0".repeat(64)
          : signature(raw, testSlot ? "te" : "li");
      }
      // Inbound callback only. No cookie and no Origin. No external provider fetch.
      const response = await fetch(new URL(ENDPOINT, process.env.SECURITY_SMOKE_URL), {
        method: "POST", headers, body: raw, redirect: "manual", cache: "no-store",
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json, eventId: body.data?.id };
    }
    const result = (response, expectedStatus, expectedBody, label) => {
      assert.equal(response.status, expectedStatus, label + ": " + response.text.slice(0, 200));
      assert.deepEqual(response.json, expectedBody, label + ": stable JSON response");
    };
    const counts = { ownRecorded: 0, crossBoundIgnored: 0, duplicates: 0, authNegatives: 0 };

    // Authentication failures cannot be used as tenant coverage credit.
    let before = await snapshots();
    for (const options of [{ missingSignature: true }, { wrongSignature: true }, { testSlot: true }]) {
      const denied = await send(eventBody(a), options);
      result(denied, 401, { error: "Invalid webhook signature." }, "signature negative");
      counts.authNegatives++;
    }
    await unchangedExcept(before);

    // Own, signed, real-row positive: the callback resolves A's run and its
    // exact stored A transfer receipt; only A's provider inbox and audit change.
    before = await snapshots();
    const ownEvent = eventBody(a);
    const own = await send(ownEvent);
    result(own, 200, { ok: true, recorded: true }, "A own provider event");
    let after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.providerEvents.length, before.ATTA.providerEvents.length + 1);
    assert.equal(after.ATTA.auditEvents.length, before.ATTA.auditEvents.length + 1);
    const ownStored = after.ATTA.providerEvents.at(-1);
    assert.deepEqual([ownStored.provider, ownStored.eventId, ownStored.organizationId, ownStored.payrollRunId],
      ["paymongo", own.eventId, a.org.id, a.payout.run.id]);
    assert.equal(after.ATTA.auditEvents.at(-1).action, "PayMongo transfer webhook received");
    counts.ownRecorded++;

    before = await snapshots();
    result(await send(ownEvent), 200, { ok: true, duplicate: true }, "same signed event replay");
    await unchangedExcept(before);
    counts.duplicates++;

    // A valid provider may report B's own transfer too; this platform-wide
    // capability must not attach B's event to A's or the victim's organization.
    before = await snapshots();
    const ownB = await send(eventBody(b));
    result(ownB, 200, { ok: true, recorded: true }, "B own provider event");
    after = await unchangedExcept(before, "ATTB");
    assert.equal(after.ATTB.providerEvents.length, before.ATTB.providerEvents.length + 1);
    assert.equal(after.ATTB.providerEvents.at(-1).organizationId, b.org.id);
    counts.ownRecorded++;

    // Forged selectors ignored: valid run/reference/transfer A wins even when
    // top-level and nested organization, legal entity, employee, run selectors
    // try to name the real higher-ID victim. Victim SQL must remain untouched.
    before = await snapshots();
    const forged = await send(eventBody(a, {
      organizationId: victim.org.id,
      legalEntityId: victim.entity.id,
      employeeId: victim.worker.id,
      runId: victim.payout.run.id,
    }));
    result(forged, 200, { ok: true, recorded: true }, "forged selectors ignored");
    after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.providerEvents.at(-1).organizationId, a.org.id);
    counts.ownRecorded++;

    // Concurrent duplicates are serialized by the provider event unique key.
    before = await snapshots();
    const simultaneous = eventBody(b);
    const raced = await Promise.all([send(simultaneous), send(simultaneous)]);
    assert.deepEqual(raced.map(r => r.status), [200, 200]);
    assert.deepEqual(raced.map(r => r.json?.duplicate ? "duplicate" : r.json?.recorded ? "recorded" : "error").sort(),
      ["duplicate", "recorded"], "concurrent duplicates must not double-write");
    after = await unchangedExcept(before, "ATTB");
    assert.equal(after.ATTB.providerEvents.length, before.ATTB.providerEvents.length + 1);
    assert.equal(after.ATTB.auditEvents.length, before.ATTB.auditEvents.length + 1);
    counts.duplicates++;

    // Cross-bound run/transfer data must not be recorded. All are validly
    // signed, target REAL existing run IDs and REAL other-employer transfers.
    // Missing receipt, mismatched employee reference and mismatched cents are
    // indistinguishable ignored results with no SQL mutation in ANY employer.
    before = await snapshots();
    const mismatches = [
      eventBody(a, { transferId: victim.payout.transferId }), // A run, victim transfer
      eventBody(victim, { transferId: a.payout.transferId }), // victim run, A transfer
      eventBody(b, { transferId: victim.payout.transferId }), // B run, victim transfer
      eventBody(a, { reference: "PAY-" + a.payout.run.id + "-" + victim.worker.employeeNo }),
      eventBody(victim, { amount: 10001 }),
    ];
    let unmatchedText = null;
    for (const payload of mismatches) {
      const ignored = await send(payload);
      result(ignored, 200, { ok: true, ignored: true, reason: "unmatched-payroll-transfer" },
        "cross-bound run/transfer data must not be recorded");
      unmatchedText ??= ignored.text;
      assert.equal(ignored.text, unmatchedText, "every cross-bound ignore must be byte-identical");
      counts.crossBoundIgnored++;
    }
    await unchangedExcept(before);

    // A signed unknown run must be indistinguishable from a real run that does not hold the
    // transfer, so the callback is not an existence oracle for payroll runs. Still not tenant credit alone.
    before = await snapshots();
    const nonexistentReference = "PAY-" + (victim.payout.run.id + 1000000) + "-" + victim.worker.employeeNo;
    const unknownRun = await send(eventBody(victim, { reference: nonexistentReference }));
    result(unknownRun, 200, { ok: true, ignored: true, reason: "unmatched-payroll-transfer" }, "unknown run");
    assert.equal(unknownRun.text, unmatchedText, "a real foreign run must not be distinguishable from a nonexistent run");
    await unchangedExcept(before);

    console.log(JSON.stringify({
      proof: "paymongo-transfer-webhook",
      ...counts,
      signedOwnAndCrossBoundRows: 3 + counts.crossBoundIgnored,
      productionTested: false,
      certified: false,
      methodCoverageCredit: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-webhook-paymongo-transfer-http.mjs")) {
  provePaymongoTransferWebhook().catch(error => {
    console.error("PAYMONGO_TRANSFER_WEBHOOK_PROOF_FAILED: " + (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
