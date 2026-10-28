# ESS probation review GET/POST employer isolation (fictional CI proposal)

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO METHOD CREDITS.**

Exact target methods are GET /api/self/probation-reviews and POST /api/self/probation-reviews.
The source manifest labels both **GAP**. This PR does not change the manifest,
reservation ledger, schema, application code, production configuration or payment
behavior. It is not a certification of privacy, employment law compliance or
real-employer acceptance.

## Why this is a separate family

At branch selection on 2026-10-28, the open-PR inventory included independent
ESS documents, ESS take-home estimate, workforce, HMO, compliance, invitations,
performance and other work, but **no open probation-review GET/POST PR**.
These five new proof-specific paths do not rewrite shared tenant runners,
prior source evidence or production methods.

## Exact isolated run

- New GitHub Actions job with a fresh, empty PostgreSQL **16** at
  127.0.0.1:5432/app_db, production-mode Next HTTP at 127.0.0.1:3000,
  locked dependencies, disposable schema baseline and generated fictional keys.
- Pre-import environment guard refuses non-CI, hosted URLs, non-disposable DB
  identities, demo mode, active scheduler/workers, live provider secrets and
  enabled payout/billing/overpayment paths. Real tenants and services are never
  contacted. The SQL setup must be empty of employers before seeding.
- Creates independent employers A and B and a genuinely **higher-ID** victim,
  with actual SQL-returned employer, worker, employment-term and submitted-review
  IDs. Each employer has a separate employee and coworker. Login cookies are
  independent authenticated sessions, never invented HTTP Authorization headers.
- Populated GET positive for both attackers and the victim returns only the
  signed-in employee's genuine submitted review and term. Same-employer peer
  and foreign-employer markers must not appear. GET with forged query selectors
  must remain session-bound rather than reveal the target.
- Both attacker employees POST an acknowledgment of their own genuine review:
  HTTP 201, one persisted employee/review/employer-bound acknowledgment, one
  matching employee-acknowledged event, and one actor-bound audit row. The
  original reviews, terms, employees, memberships and payroll remain unchanged.
  GET after POST must reflect the persisted acknowledgment.
- Each attacker attempts the real victim's review ID, the other attacker's real
  review, and their same-employer coworker's review, with forged employer and
  employee fields: expected 404, no private markers and no SQL or audit change.
  Invalid ID (400), repeated own acknowledgment (409), anonymous (401),
  owner-role access (403) and account employee-ID forged to point at the victim
  with membership in the attacker employer only (403) are separate controls.
- Snapshot every employer's personnel, memberships, review, acknowledgment,
  event, audit and payroll rows. Also compare the shared extended victim core
  snapshot before and after each attack. Missing or swapped positive evidence,
  fake no-op success, wrong audit actors, extra receipts, peer data disclosure,
  mutated payroll or missing evidence fails the tests.

## CI failure triage on October 28, 2026

The prior exact-head focused run [40612803381](https://github.com/erwinmehehe/payrollph/actions/runs/40612803381) **failed before PostgreSQL or live HTTP testing**. Seven of eight source tests passed. The one negative control correctly rejected a foreign employer's genuine review ID (`110 !== 90`), but the test incorrectly required an unrelated error message regex (`/persisted submitted review/`) rather than asserting the identity mismatch. The fix removes **only that incidental error-message expectation** and preserves the actual strict source-ID, employee, employer, and private-marker assertions in `assertOwnReview`; it does not loosen the validator or accept foreign rows.

Fix commit: `85075a8dbd3d736c0f6ce56629dd7b21715e65a5`. Its new [focused PG16/localhost HTTP job](https://github.com/erwinmehehe/payrollph/actions/runs/40616675851) was queued at review. No passing PostgreSQL/HTTP claim is made until that exact-head job actually finishes.

**Independent source concern:** The production POST currently persists the acknowledgment, review event and audit in separate database operations, and converts all exceptions into an already-acknowledged 409. A later event/audit failure can leave a durable receipt without complete evidence. That transactional rollback and its fault-injection regression require a separately reviewed production source change before full method coverage; this test-only candidate must not be used to certify it.

## Limitations and acceptance gates

The method's happy-path review-acknowledgment and these particular denials are
proposed proof only. This does not exercise every organization-auth policy,
simultaneous acknowledgment race, concurrent reassignment or real-client
employment workflow. The receipt states only that the employee **viewed** a
review; it is not agreement, compensation approval or employment consent.

- [ ] Exact branch-head Node syntax and negative-control contract tests pass.
- [ ] Real PostgreSQL 16 + production-mode localhost HTTP job passes all own
      positives, foreign/peer denials and before/after database assertions.
- [ ] Applicable main CI, security HTTP and CodeQL results are reviewed.
- [ ] Independent security/privacy reviewer verifies live source behavior,
      employee-role boundaries, caching, memberships and audit minimization.
- [ ] Independently decide method acceptance, then reconcile the authoritative
      manifest in a **separate** reviewed follow-up. No credits here.

Do not enable customer-facing flags, merge automatically or infer that a green
fictional run certifies customer HR data, production privacy or payroll readiness.
