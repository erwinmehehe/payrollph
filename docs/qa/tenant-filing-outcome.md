# Independent government filing-outcome tenant-isolation proof

**Target:** PATCH /api/compliance/filing-validations/[id] (government filing outcomes only). This standalone family does **not** reuse the document-upload, enterprise-admin, payroll-tax, TOTP/workforce recovery, account-email or transfer PR scope. It changes **no production application code, SQL migrations, shared manifest or coverage ledger**.

## Why this exists

The existing tenant-isolation inventory lists this method as **GAP / testedBy: null**. The production route checks session, active employer role, recent MFA, scoped filing ID, legal employer and payroll org unit before a database transaction writes a filing outcome and its audit event. This PR makes the **rejected** outcome's authorization and atomicity independently reproducible over production-mode Next.js HTTP against a fresh, strictly disposable PostgreSQL 16 database.

## Positive and negative evidence expected in CI

- Two distinct authenticated employer owners (ATTA and ATTB), an actual persisted victim organization with higher IDs (after seven real padding employers), one unique linked payroll run and one generated-state filing per employer. All names, users and dates are fictional.
- **Two own-success paths:** each owner records an *agency rejection* on their own filing; the same real record is persisted as rejected, the actor-bound audit event is committed once, and payroll, employee, pay-profile, outbox and all other employers' business state remain unchanged.
- **Sixteen denial controls:** for each attacker, forged victim organization selector (403), actual victim filing ID inside their own organization (404), genuinely absent ID (404 with matching body), anonymous (401), cross-site (403), unsupported submission method (400), missing rejection note (400), and attempted rewrite of their already rejected filing (409). Each denial must preserve byte-equivalent snapshots of all three tracked employers; victim filenames and markers may not leak in body or headers.
- **Two reached audit INSERT veto controls:** a deliberately installed trigger refuses the actual audit_events insert only for the caller's fictional employer, so the filing status change must roll back in the same PostgreSQL transaction; then the trigger is removed and the genuine own rejection must work.
- The contract tests are *discriminating*: a returned foreign ID, false-success response, leaked marker or an altered negative/rolled-back snapshot is treated as failure.

## Deliberate non-claims and acceptance gates

- **Zero tenant-coverage method credits.** The existing manifest stays GAP / testedBy: null. The dedicated suite must pass on the **exact PR head** before an independent reviewer evaluates any future proposal to change that status.
- The **accepted/official-filing outcome is not covered**. Synthetic generated-state rows and rejection notices do not reproduce the released source file, verify agency acknowledgement, or authenticate a government receipt. Any later credit requires a separate acceptance proof, including regeneration/source hashing and all allowed outcome paths.
- No live agency submission, bank/payout request, notification, payroll release, PII upload, provider call, production credential, real employee, live database or deployment. Both the workflow and test runner fail closed unless the environment is the fictional CI-only localhost profile.
- No merger or production security approval is implied. Independent tenant/security review, final-head CI, source-sha review and freshness against current main remain separate gates.

## Workflow and handoff

CI workflow: .github/workflows/tenant-filing-outcome-http.yml.

Contract-only tests: node --test tests/tenant-filing-outcome-contract.test.mjs.

Dedicated real HTTP: node --import tsx scripts/qa/tenant-filing-outcome-http.mjs **only** inside the disposable GitHub Actions PG16 job, after the environment gate, db:push, baseline and production build. The runner refuses manual execution outside that profile.

The original route's SHA is pinned in the contract test. New source or fixture changes require explicit re-review. Reverting this PR only deletes these five newly added QA/workflow/documentation files.
