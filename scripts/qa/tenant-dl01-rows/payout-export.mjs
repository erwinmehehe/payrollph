/**
 * DL-01 payout-export POST: all three modes, with a loopback-only zero-money
 * provider for preflight/disburse, and independently seeded FICTIONAL bank UAT
 * for the complete-manual code path. Not a real bank confirmation or transfer.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { victimSnapshot } from "../tenant-dl01-closure-shared.mjs";

export const METHODS = Object.freeze(["POST /api/payroll-runs/[id]/exports"]);
const path = id => "/api/payroll-runs/" + id + "/exports";
const action = (ctx, actor, id, mode, selectors = {}) =>
  ctx.request(path(id), {
    method: "POST", cookie: actor.operator.cookie,
    body: { mode, confirm: true, ...selectors },
  });
const audits = (ctx, org) => ctx.db.select().from(ctx.s.auditEvents)
  .where(eq(ctx.s.auditEvents.organizationId, org));

async function mockStats(ctx) {
  const r = await fetch("http://127.0.0.1:3012/__proof");
  const text = await r.text();
  ctx.exact({ status: r.status, text }, 200, "Only loopback test receipt endpoint");
  const snapshot = JSON.parse(text);
  assert.ok(Array.isArray(snapshot.provider), "Mock provider receipt must be a real list");
  return snapshot;
}

export async function prepare(ctx) {
  // Only real test-process rows in disposable PostgreSQL. The manual UAT
  // acknowledgement is visibly labeled CI-only; it never asserts a bank or
  // receiving institution received or paid money.
  const [template] = await ctx.db.insert(ctx.s.bankTemplates).values({
    name: "DL01 SYNTHETIC NO BANK", version: "ci-no-money",
    format: "CSV", active: true, adapterStage: "draft",
    specSource: "internal_demo", specReference: "LOCAL-CI-ONLY-NOT-BANK-CONFIRMATION",
  }).returning();
  for (const e of ctx.all) {
    const hash = createHash("sha256").update(e.marker + "-fictional-bank-file").digest("hex");
    const [validation] = await ctx.db.insert(ctx.s.bankFileValidations).values({
      organizationId: e.org.id, payrollRunId: e.manualRun.id,
      templateName: template.name, templateVersion: template.version,
      fileName: "CI_NOT_BANK_" + e.label + ".csv",
      fileSha256: hash, status: "accepted", generatedBy: e.operator.user.name,
      portalReference: "CI_NO_BANK_SIMULATION",
      outcomeNote: "CI-only control-flow scenario; absolutely no real bank, payment, or UAT acceptance",
    }).returning();
    await ctx.db.insert(ctx.s.auditEvents).values({
      organizationId: e.org.id, actor: e.operator.user.name,
      action: "bank export generated", resource: e.manualRun.periodLabel,
      metadata: { runId: e.manualRun.id, kind: "bank",
        dryRun: false, template: template.name,
        ciOnlyNoBankConfirmation: true, fileSha256: hash },
    });
    e.manualValidation = validation;
  }
  assert.ok(ctx.victim.manualValidation.id > 6 &&
    ctx.attackers.every(e => ctx.victim.manualValidation.id > e.manualValidation.id),
    "Victim-only manual bank-validation DB evidence must exist with higher ID");
}

export async function verify(ctx) {
  const victimBefore = await victimSnapshot(ctx.victim);
  let providerPosts = 0;
  for (const e of ctx.attackers) {
    const selector = {
      organizationId: ctx.victim.org.id,
      legalEntityId: ctx.victim.entity.id,
      employeeId: ctx.victim.worker.id,
    };
    const prior = await mockStats(ctx);
    // Even a forged victim organization in the JSON body cannot reassign the
    // own persisted payroll run. The route derives its tenant from the URL id.
    const preflight = ctx.exact(await action(ctx, e, e.payoutRun.id, "preflight", selector),
      200, "DL-01 own released payroll provider preflight");
    assert.equal(preflight.json?.ready, true);
    assert.equal(preflight.json?.employeeCount, 1);
    assert.equal(preflight.json?.totalAmountCents, 2_800_000);
    assert.equal(preflight.json?.wallet?.id, "wallet_synthetic");
    ctx.noVictim(preflight, ctx.victim, "Own PayMongo preflight");

    const disburse = ctx.exact(await action(ctx, e, e.payoutRun.id, "disburse", selector),
      200, "DL-01 own zero-money PayMongo disburse sub-action");
    assert.equal(disburse.json?.completed, true);
    assert.equal(disburse.json?.transfers?.length, 1);
    assert.equal(disburse.json?.transfers?.[0]?.amountCents, 2_800_000);
    assert.match(disburse.json?.batchId ?? "", /^batch_tr_dl01_/);
    assert.equal(disburse.json?.transfers?.[0]?.status, "succeeded");
    ctx.noVictim(disburse, ctx.victim, "Own zero-money disburse");
    const submitAudit = await audits(ctx, e.org.id);
    assert.ok(submitAudit.some(row =>
      row.action === "Payroll payout submission initiated via PayMongo" &&
      Number(row.metadata?.runId) === e.payoutRun.id),
      "Real own database must record durable submission intent before mock POST");
    assert.ok(submitAudit.some(row =>
      row.action === "Payroll payout completed via PayMongo" &&
      Number(row.metadata?.runId) === e.payoutRun.id),
      "Mock result must be linked to own run and audit");

    const after = await mockStats(ctx);
    const newPosts = after.provider.filter(x => x.route === "batch_transfers").length -
      prior.provider.filter(x => x.route === "batch_transfers").length;
    assert.equal(newPosts, 1, "exactly one outbound POST to the LOOPBACK provider only");
    const posted = after.provider.filter(x => x.route === "batch_transfers").at(-1);
    assert.equal(posted.idempotencyKey, "payroll-run-" + e.payoutRun.id);
    assert.equal(posted.amount, 2_800_000);
    providerPosts += newPosts;

    // Complete-manual is a DIFFERENT released payroll to prevent cross-rail
    // duplicates. All bank acceptance rows are distinctly fictional CI UAT.
    const manual = ctx.exact(await action(ctx, e, e.manualRun.id,
      "complete-manual", { ...selector, confirmed: true,
        reference: "CI_NO_REAL_BANK_" + e.label }), 200,
    "DL-01 complete-manual control-flow acceptance on fictional evidence");
    assert.equal(manual.json?.completed, true);
    assert.equal(manual.json?.moneyMovedByLinaw, false);
    assert.equal(manual.json?.reference, "CI_NO_REAL_BANK_" + e.label);
    assert.equal(manual.json?.method, "bank-file");
    const manualAudit = await audits(ctx, e.org.id);
    assert.ok(manualAudit.some(row =>
      row.action === "Payroll payout completed manually" &&
      Number(row.metadata?.runId) === e.manualRun.id &&
      row.metadata?.bankValidationId === e.manualValidation.id),
      "Fictional manual confirmation must bind exactly to own UAT validation");

    for (const mode of ["preflight", "disburse", "complete-manual"]) {
      // A REAL, released higher-ID victim run must return 403 BEFORE any
      // provider lookup, money state disclosure or audit write.
      const victimResponse = ctx.exact(await action(ctx, e,
        ctx.victim.payoutRun.id, mode,
        { organizationId: e.org.id, employeeId: e.worker.id,
          confirmed: true, reference: "CI_FOREIGN_DENY" }), 403,
      "DL-01 " + mode + " victim run denies genuine cross-tenant actor");
      ctx.noVictim(victimResponse, ctx.victim, mode + " foreign victim denial");
    }
    const replay = ctx.exact(await action(ctx, e, e.payoutRun.id,
      "disburse", selector), 409, "DL-01 duplicate forged disburse blocked");
    ctx.noVictim(replay, ctx.victim, "Forged disburse replay");
    const noSecondPost = await mockStats(ctx);
    assert.equal(noSecondPost.provider.filter(x => x.route === "batch_transfers").length,
      after.provider.filter(x => x.route === "batch_transfers").length,
      "replay and victim denial cannot resend even to the zero-money mock");
    assert.deepEqual(await victimSnapshot(ctx.victim), victimBefore,
      "DL-01 all three POST sub-actions preserve the real victim payout and audit state");
  }
  assert.equal(providerPosts, 2, "Two independent legitimate attackers each used the synthetic PayMongo POST once");
}
