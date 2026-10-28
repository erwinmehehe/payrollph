import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHODS, ENDPOINT, requireDisposableProbation, assertNoPrivateMarkers,
  assertOwnReview, assertOwnAcknowledgment, assertPrivateDenial,
  assertUnchanged, assertOnlyOwnWrite,
} from "../scripts/qa/tenant-self-probation-contract.mjs";

const safe = {
  CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_PROBATION_MODE: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WORKER_TOKEN: "ci-worker-token-fictional-probation",
};
const actor = {
  marker: "TTBL-ATTA-FICTIONAL", org: { id: 12 }, worker: { id: 31 },
  term: { id: 60 }, review: { id: 90 },
  self: { userId: 17, name: "Fictional A employee" },
};
const makeRead = (who = actor, ack = false) => {
  const json = {
    reviews: [{
      review: {
        id: who.review.id, employeeId: who.worker.id,
        employmentTermId: who.term.id, status: "submitted",
        recommendation: "needs_hr_review",
        summary: who.marker + " PRIVATE submitted review",
      },
      term: { id: who.term.id, organizationId: who.org.id, employeeId: who.worker.id },
      acknowledgment: ack ? {
        reviewId: who.review.id, employeeId: who.worker.id,
        organizationId: who.org.id, acknowledgedByUserId: who.self.userId,
      } : null,
    }],
    acknowledgmentStatement: "Acknowledgment does not mean you agree with the review.",
  };
  return { status: 200, json, text: JSON.stringify(json) };
};
const makePost = () => {
  const json = {
    acknowledgment: {
      id: 100, organizationId: actor.org.id, employeeId: actor.worker.id,
      reviewId: actor.review.id, acknowledgedByUserId: actor.self.userId,
      acknowledgedByName: actor.self.name, response: "acknowledged_receipt",
      statementVersion: "receipt-only-v1",
      employeeComment: actor.marker + " acknowledged this fictional review",
    },
    statement: "Receipt acknowledgment recorded. It does not indicate agreement.",
  };
  return { status: 201, json, text: JSON.stringify(json) };
};
const change = (source, mutate) => { const copy = structuredClone(source); mutate(copy); copy.text = JSON.stringify(copy.json); return copy; };

test("refuse all hosted, unguarded, payout or provider-enabled environments before imports", () => {
  assert.doesNotThrow(() => requireDisposableProbation(safe));
  for (const mutation of [
    { CI: "false" }, { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { TENANT_SECOND_PASS_MODE: "" }, { TENANT_PROBATION_MODE: "" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { DATABASE_URL: "postgresql://postgres:wrong@127.0.0.1:5432/app_db" },
    { SECURITY_SMOKE_URL: "https://prod.invalid" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { SECURITY_SMOKE_URL: "http://127.0.0.1:3000/victim" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { HCM_OVERPAYMENT_PREVIEW_ENABLED: "true" },
    { PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "true" },
    { WORKER_TOKEN: "real-provider-key" }, { PAYMONGO_SECRET_KEY: "secret" },
    { XENDIT_SECRET_KEY: "secret" }, { XENDIT_PAYOUT_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" }, { POSTMARK_SERVER_TOKEN: "secret" },
    { SMTP_URL: "smtp://host" }, { STRIPE_SECRET_KEY: "secret" },
  ]) {
    assert.throws(() => requireDisposableProbation({ ...safe, ...mutation }), /PROBATION_TENANT_REFUSED/,
      "must reject " + JSON.stringify(mutation));
  }
});

test("targets only two genuinely GAP probation-review methods", () => {
  assert.deepEqual(METHODS, ["GET self/probation-reviews", "POST self/probation-reviews"]);
  assert.equal(ENDPOINT, "/api/self/probation-reviews");
  const manifest = JSON.parse(readFileSync(new URL(
    "../scripts/qa/tenant-isolation-coverage-manifest.json", import.meta.url), "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/self/probation-reviews/route.ts"];
  assert.ok(entry, "authoritative route must exist");
  assert.equal(entry.route, "self/probation-reviews");
  for (const method of ["GET", "POST"]) {
    assert.equal(entry.methods.find(row => row.name === method)?.status, "GAP",
      "candidate is not a method credit or coverage update");
  }
});

test("populated own read cannot be replaced by a peer or foreign review", () => {
  const own = makeRead();
  assert.deepEqual(assertOwnReview(own, actor, ["TTBL-VICTIM", "TTBL-ATTA-PEER"]), own.json.reviews[0]);
  const victim = {
    ...actor, marker: "TTBL-VICTIM", org: { id: 22 }, worker: { id: 44 },
    term: { id: 77 }, review: { id: 110 },
  };
  assert.throws(() => assertOwnReview(makeRead(victim), actor), /persisted submitted review/);
  for (const mutation of [
    x => { x.status = 204; },
    x => { x.json.reviews = []; },
    x => { x.json.reviews.push({}); },
    x => { x.json.reviews[0].review.id++; },
    x => { x.json.reviews[0].review.employeeId++; },
    x => { x.json.reviews[0].review.employmentTermId++; },
    x => { x.json.reviews[0].review.status = "draft"; },
    x => { x.json.reviews[0].review.summary = "unrelated"; },
    x => { x.json.reviews[0].term.organizationId++; },
    x => { x.json.reviews[0].term.employeeId++; },
    x => { x.json.reviews[0].acknowledgment = {}; },
    x => { x.json.payroll = "private"; },
  ]) {
    assert.throws(() => assertOwnReview(change(own, mutation), actor),
      "must reject altered own response");
  }
  assertOwnReview(makeRead(actor, true), actor, [], true);
  assert.throws(() => assertOwnReview(makeRead(actor, true), actor, [], false));
  assert.throws(() => assertOwnReview(makeRead(actor, false), actor, [], true));
});

test("private markers from another employer or same-employer coworker fail", () => {
  for (const marker of ["TTBL-VICTIM", "TTBL-ATTA-PEER"]) {
    assert.throws(() => assertNoPrivateMarkers({ text: "leak " + marker }, [marker]));
    assert.throws(() => assertOwnReview(change(makeRead(), x => {
      x.json.reviews[0].review.summary += marker;
    }), actor, [marker]));
  }
  assert.doesNotThrow(() => assertNoPrivateMarkers(makeRead(), ["TTBL-VICTIM"]));
});

test("own POST demands exact actor, worker, review, statement and created receipt", () => {
  const posted = makePost();
  assert.equal(assertOwnAcknowledgment(posted, actor).reviewId, actor.review.id);
  for (const mutation of [
    x => { x.status = 200; },
    x => { x.json.acknowledgment.id = null; },
    x => { x.json.acknowledgment.organizationId = 22; },
    x => { x.json.acknowledgment.employeeId++; },
    x => { x.json.acknowledgment.reviewId++; },
    x => { x.json.acknowledgment.acknowledgedByUserId++; },
    x => { x.json.acknowledgment.acknowledgedByName = "Other user"; },
    x => { x.json.acknowledgment.response = "approved"; },
    x => { x.json.acknowledgment.statementVersion = "payroll-approved"; },
    x => { x.json.acknowledgment.employeeComment = ""; },
    x => { x.json.statement = "Approval granted"; },
  ]) assert.throws(() => assertOwnAcknowledgment(change(posted, mutation), actor));
});

test("foreign/peer/unauthenticated denials never contain review, term or receipt content", () => {
  const r = { status: 404, json: { error: "Submitted probation review not found." },
    text: '{"error":"Submitted probation review not found."}' };
  assertPrivateDenial(r, 404, ["TTBL-VICTIM"]);
  assert.throws(() => assertPrivateDenial(r, 403));
  assert.throws(() => assertPrivateDenial(change(r, x => { x.json.reviews = []; }), 404));
  assert.throws(() => assertPrivateDenial({ ...r, text: "TTBL-VICTIM PRIVATE" }, 404, ["TTBL-VICTIM"]));
});

test("DB proof rejects missing actor-bound audit, event, changed pay, extra receipts and no-op", () => {
  const posted = makePost().json.acknowledgment;
  const before = {
    employees: [{ id: actor.worker.id }], memberships: [{ role: "employee" }],
    terms: [{ id: actor.term.id }], reviews: [{ id: actor.review.id }], payroll: [{ id: 6 }],
    acks: [], events: [], audit: [],
  };
  const after = structuredClone(before);
  after.acks.push({ ...posted });
  after.events.push({
    reviewId: actor.review.id, employeeId: actor.worker.id,
    organizationId: actor.org.id, actorUserId: actor.self.userId,
    eventType: "employee_acknowledged",
  });
  after.audit.push({
    organizationId: actor.org.id, action: "Employee acknowledged probation review receipt",
    actor: actor.self.name, metadata: { probationReviewId: actor.review.id },
  });
  assert.doesNotThrow(() => assertOnlyOwnWrite(before, after, actor, posted));
  for (const mutation of [
    x => { x.acks = []; }, x => { x.acks.push(posted); },
    x => { x.acks[0].employeeId++; }, x => { x.events = []; },
    x => { x.events[0].actorUserId++; }, x => { x.audit = []; },
    x => { x.audit[0].metadata.probationReviewId++; }, x => { x.payroll.push({ id: 7 }); },
    x => { x.reviews[0].id++; }, x => { x.memberships[0].role = "owner"; },
  ]) {
    const changed = structuredClone(after);
    mutation(changed);
    assert.throws(() => assertOnlyOwnWrite(before, changed, actor, posted));
  }
  assert.doesNotThrow(() => assertUnchanged(before, structuredClone(before), "victim"));
  assert.throws(() => assertUnchanged(before, after, "victim"));
});

test("actual HTTP runner guards before dynamic DB import and seeds independent sources", () => {
  const script = readFileSync(new URL(
    "../scripts/qa/tenant-self-probation-http.mjs", import.meta.url), "utf8");
  const guardIndex = script.indexOf("requireDisposableProbation();");
  const importIndex = script.indexOf('import("../../src/db/index.ts")');
  assert.ok(guardIndex >= 0 && importIndex > guardIndex);
  for (const anchor of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "hcmProbationReviews", "hcmProbationReviewAcknowledgments",
    "assertOnlyOwnWrite", "assertPrivateDenial", "assertUnchanged",
    "victim.review.id", "peer.review.id", "userOrganizations",
  ]) assert.ok(script.includes(anchor), "missing exact-case runner anchor: " + anchor);
});
