# WRK-02 Workforce Planning demand handoff: POST tenant isolation

**Status: DRAFT / ZERO NEW CREDITS / NOT ACCEPTED / NO PRODUCTION RELEASE.**

**Target:** POST /api/workforce-planning/demand-handoff. Unlike open #1536 manager-allocation and #1537 HMO PRs, this PR changes only its dedicated proof runner, pure contract and negative-control tests, this note and its own GitHub Actions workflow. No production handler, migration, shared manifest, method classification, paid feature flag or provider path is changed. The target stays GAP until separate source-specific review, passing workflow receipts and reconciliation.

## Why this method

The route consumes five caller-supplied business IDs: organizationId, planId, jobProfileId, worksiteId and shiftDefinitionId. Its POST can create staffing requirements or update existing hcm_plan requirements. An authenticated response alone does not prove these IDs belong to the user's employer, or that an existing requirement has not been overwritten across a tenant boundary.

## Executable evidence

The new, PR-only workflow at .github/workflows/tenant-wfp-demand-handoff-http.yml starts **fresh PostgreSQL 16** on 127.0.0.1:5432/app_db, applies the isolated baseline, builds a production-mode Next server and issues real authenticated HTTP requests to http://127.0.0.1:3000. The runner fails closed before any database/app import. Workers, schedulers, billing, payouts and providers are disabled; provider credentials are rejected. All records are fictional.

Three separate employers are seeded in order: attacker A, attacker B, then victim C. Each has an owner session, a non-admin worker session, an approved own plan, an active own site/job/shift, two actual approved/open plan positions, and a manually managed requirement. Victim organization, plan, site, job, shift, position and manual-requirement IDs must be **higher actual persisted IDs** than either attacker.

The run requires all of the following:

- Both independent attackers receive 403 when naming victim C's actual organization; a forged victim plan under the attacker's own organization receives 409; forged victim job, worksite and shift IDs receive 404.
- Both non-admin workers are denied a manager-only handoff (403). An above-authorized headcount, an out-of-plan date and an attempt to replace a manually managed requirement all return 409.
- Every denial leaves **all three employers' actual SQL snapshots** unchanged, including staffing, audit business fields, positions, employee identities, payroll, attendance and outbox.
- Each employer's owner then creates a real own requirement (201) and updates the **same** persisted requirement (201). Positive assertions require the actual SQL ID, own employer/plan/site/shift/job, exact date and authorized position IDs, request headcount and actor-attributed audit event.
- Each legitimate write leaves the other two employers' SQL and audit rows unchanged. A's successful response deliberately fails B's own-row positive assertion.
- Audit chain cryptographic seals only are normalized; all audit business values are compared.

## Limitations and safety

This is **a proof candidate, not complete tenant certification**. No scheduler rollups, shift publication, payroll, filings, actual employee records, documents, banking, external APIs, production service or real payments are exercised. The runner does not certify concurrency races, every feature-policy combination or the full WRK-02 batch. It prints methodAccepted: false, productionCertified: false, and newCredits: 0 on success.

## Acceptance checklist

- [ ] Exact-head source contracts and adversarial negative-control tests pass.
- [ ] Exact-head disposable PG16 and real Next HTTP workflow passes.
- [ ] Required CI/security checks pass.
- [ ] Independent maintainer/security review accepts the source and proof.
- [ ] Any later full-method credit goes through a separate reviewed reconciliation.

**Do not auto-merge or promote this GAP based only on static source assertions or status-only HTTP probes.**
