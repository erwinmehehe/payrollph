/**
 * Exact GAP methods: GET and POST /api/self/probation-reviews.
 * Pure verification contract. No method credit or production authorization.
 */
import assert from "node:assert/strict";

export const METHODS = Object.freeze([
  "GET self/probation-reviews",
  "POST self/probation-reviews",
]);
export const ENDPOINT = "/api/self/probation-reviews";

export function requireDisposableProbation(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL);
    database = new URL(env.DATABASE_URL);
  } catch {
    throw Error("PROBATION_TENANT_REFUSED: explicit localhost app and PostgreSQL URLs required");
  }
  const providerNames = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ];
  const safe = env.CI === "true" &&
    env.NODE_ENV === "production" &&
    env.DEMO_MODE === "false" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_PROBATION_MODE === "fictional-only" &&
    env.WORKER_ENABLED === "false" &&
    env.CENTRAL_SCHEDULER_ENABLED === "false" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    env.XENDIT_BILLING_ENABLED === "false" &&
    env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "false" &&
    env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED === "false" &&
    String(env.WORKER_TOKEN ?? "").startsWith("ci-worker-token-") &&
    app.href === "http://127.0.0.1:3000/" &&
    database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    !providerNames.some(name => env[name]);
  if (!safe) {
    throw Error("PROBATION_TENANT_REFUSED: only disposable CI PG16 and production-mode localhost with payouts/providers disabled");
  }
}

export function assertNoPrivateMarkers(response, markers) {
  for (const marker of markers) {
    if (marker) assert.ok(!String(response.text).includes(marker),
      "response must not reveal another worker or employer's private marker");
  }
}

export function assertOwnReview(response, actor, markers = [], acknowledged = false) {
  assert.equal(response.status, 200, "authenticated employee must receive 200");
  assert.ok(response.json && typeof response.json === "object");
  assert.deepEqual(Object.keys(response.json).sort(),
    ["acknowledgmentStatement", "reviews"], "only the documented ESS review envelope is allowed");
  assert.match(response.json.acknowledgmentStatement, /does not mean you agree/i);
  const rows = response.json.reviews;
  assert.ok(Array.isArray(rows) && rows.length === 1, "own GET must contain exactly one persisted submitted review");
  const row = rows[0];
  assert.equal(row.review.id, actor.review.id);
  assert.equal(row.review.employeeId, actor.worker.id);
  assert.equal(row.review.employmentTermId, actor.term.id);
  assert.equal(row.review.status, "submitted");
  assert.equal(row.review.recommendation, "needs_hr_review");
  assert.ok(row.review.summary.includes(actor.marker + " PRIVATE"));
  assert.equal(row.term.id, actor.term.id);
  assert.equal(row.term.organizationId, actor.org.id);
  assert.equal(row.term.employeeId, actor.worker.id);
  if (acknowledged) {
    assert.equal(row.acknowledgment.reviewId, actor.review.id);
    assert.equal(row.acknowledgment.employeeId, actor.worker.id);
    assert.equal(row.acknowledgment.organizationId, actor.org.id);
    assert.equal(row.acknowledgment.acknowledgedByUserId, actor.self.userId);
  } else {
    assert.equal(row.acknowledgment, null, "no invented preexisting acknowledgment");
  }
  assertNoPrivateMarkers(response, markers);
  return row;
}

export function assertOwnAcknowledgment(response, actor) {
  assert.equal(response.status, 201, "first real receipt acknowledgment must create 201");
  const { acknowledgment, statement } = response.json ?? {};
  assert.ok(acknowledgment && typeof acknowledgment.id === "number");
  assert.equal(acknowledgment.organizationId, actor.org.id);
  assert.equal(acknowledgment.employeeId, actor.worker.id);
  assert.equal(acknowledgment.reviewId, actor.review.id);
  assert.equal(acknowledgment.acknowledgedByUserId, actor.self.userId);
  assert.equal(acknowledgment.acknowledgedByName, actor.self.name);
  assert.equal(acknowledgment.response, "acknowledged_receipt");
  assert.equal(acknowledgment.statementVersion, "receipt-only-v1");
  assert.ok(acknowledgment.employeeComment.includes(actor.marker + " acknowledged"));
  assert.match(statement ?? "", /does not indicate agreement/i);
  return acknowledgment;
}

export function assertPrivateDenial(response, status, markers = []) {
  assert.equal(response.status, status,
    "denial must have exact HTTP status, got " + response.status + " " + String(response.text).slice(0, 120));
  assert.ok(response.json && typeof response.json.error === "string");
  for (const key of ["reviews", "review", "term", "acknowledgment", "employee"]) {
    assert.ok(!Object.hasOwn(response.json, key), "denied response cannot include private " + key);
  }
  assertNoPrivateMarkers(response, markers);
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + " must preserve actual PostgreSQL rows and audit");
}

export function assertOnlyOwnWrite(before, after, actor, posted) {
  for (const key of ["employees", "memberships", "terms", "reviews", "payroll"]) {
    assert.deepEqual(after[key], before[key], key + ": acknowledgment cannot mutate HR or payroll sources");
  }
  for (const key of ["acks", "events", "audit"]) {
    assert.deepEqual(after[key].slice(0, before[key].length), before[key],
      key + ": old evidence must be unchanged");
    assert.equal(after[key].length, before[key].length + 1,
      key + ": exactly one new own row is required");
  }
  const ack = after.acks.at(-1);
  assert.equal(ack.id, posted.id);
  assert.equal(ack.reviewId, actor.review.id);
  assert.equal(ack.employeeId, actor.worker.id);
  assert.equal(ack.organizationId, actor.org.id);
  assert.equal(ack.acknowledgedByUserId, actor.self.userId);
  assert.equal(ack.response, "acknowledged_receipt");
  assert.equal(ack.employeeComment, posted.employeeComment);
  const event = after.events.at(-1);
  assert.equal(event.reviewId, actor.review.id);
  assert.equal(event.employeeId, actor.worker.id);
  assert.equal(event.organizationId, actor.org.id);
  assert.equal(event.actorUserId, actor.self.userId);
  assert.equal(event.eventType, "employee_acknowledged");
  const audit = after.audit.at(-1);
  assert.equal(audit.organizationId, actor.org.id);
  assert.equal(audit.action, "Employee acknowledged probation review receipt");
  assert.equal(audit.actor, actor.self.name);
  assert.equal(audit.metadata.probationReviewId, actor.review.id);
}