# Tenant isolation — Automation Studio publication lifecycle (2026-11-10)

**Status: review candidate only. ZERO API-method credits. No production acceptance.**

## Why this independent batch exists

Merged PR #1906 proves only the `save-rule` and `create-from-template` draft-write actions, not the complete `POST /api/automation-studio` contract. The adjacent existing triage proof covers only manual case acknowledgement. This PR adds **real PostgreSQL 16 / localhost HTTP** evidence for three additional actions: `publish-rule`, `set-active` (both enable and disable), and `rollback-rule`.

## Exact boundary

- The runner starts with an empty disposable `app_db`, two independently authenticated fictional employer owners, seven fully seeded filler employers, and a third named victim with genuine organization, owner, entity, unit, employee, rule and draft identifiers **above six**.
- Drafts are created via the actual POST endpoint. Owners obtain their **real session-signed Impact Preview receipts** via GET and can publish only after human approval and explicit limited-evidence acknowledgement. Missing, cross-tenant and stale receipts, absent approval, replay and unpublished activation are denied.
- Both owners exercise real persisted publish **HTTP 200**, enable **HTTP 200**, disable **HTTP 200**, and historical rollback **HTTP 200**. Each outcome must equal the actual tenant-owned rule/version state, with a new audit event and no unrelated business writes. Distinct response checks prevent a denial-only or invented 200 from passing.
- Both owners test real victim and other-owner rule-ID substitutions across publish, rollback and both active states, plus a real victim organization selector. All foreign or malformed cases must fail without leaking employer markers or changing any of the three employers' audited SQL snapshots. Anonymous and cross-site mutations are also denied.
- Tracks organizations, memberships, workers, pay profiles, rules, rule versions, execution rows, operational cases, event logs, payroll runs, outbox and audit entries. No execution, event, external provider or payment may be created.

## Technical guardrails

The independent source contract imports the already-reviewed draft/triage environment interlocks and checks the exact route, versioning, automation and signed-preview source blobs. The new GitHub Actions workflow uses disposable PostgreSQL 16; locked Node dependencies; a production-mode Next build; ephemeral encryption keys; localhost server and real cookies; **workers/schedulers/provider/payout/model credentials disabled**. Unsafe environments fail before importing the database or app.

The workflow records `TENANT_STUDIO_LIFECYCLE_HTTP_COMPLETE` only after every own-positive, foreign-denial and SQL-isolation assertion has run; it reports `wholePostCertified:false`, `methodCoverageCredits:0` and `independentlyAccepted:false`.

## Acceptance still required

- [ ] Dedicated exact-final-head fictional PG16 contract + production build + all real-HTTP lifecycle assertions succeed, with no skipped proof step.
- [ ] All applicable standard CI, CodeQL, tenant inventory/source guards and security jobs pass on the final branch.
- [ ] Independent identity/security and automation-domain reviewer confirms actual own/foreign/receipt/immutability invariants and the absence of side effects.
- [ ] Reconcile the latest `main` and other open PRs, obtain maintainer merge approval.
- [ ] Separately prove remaining `POST` actions: execution quarantine, case resolve/reopen, failed-step retry, execution replay, and the language proposal/save branches under appropriate safe OFF/controlled profiles. A complete action matrix and independent acceptance are mandatory before proposing a whole-method credit.

**No shared tenant-coverage manifest or status change in this PR.** No production data, provider call, live workflow activation, real salary, payroll release, payout or deployment. The entire method stays **GAP / zero credits** despite a passing subset.
