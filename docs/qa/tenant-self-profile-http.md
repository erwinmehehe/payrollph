# ESS profile PATCH tenant-isolation proof (synthetic only)

**Status: DRAFT / NOT ACCEPTED. Zero tenant-coverage credits. No release authorization.**

## Exact method and existing authorization

This test executes **PATCH `/api/self/profile`** against the unchanged production-mode route. A legitimate employee may edit only their own contact fields (`mobile`, `emergencyContact`, `emergencyPhone`). Identity comes from the authenticated employee session, not caller-provided `organizationId` or `employeeId` selectors. The existing route requires an active membership in the employee record's actual employer and writes an actor-bound audit row.

The route is **not changed** by this PR; no claim is made that a security issue was exploitable in production. This is independent regression evidence for a still-unaccepted method.

## Source, fixture and execution boundary

The isolated GitHub workflow `.github/workflows/tenant-self-profile-http.yml` starts a **new, empty disposable PostgreSQL 16** on `127.0.0.1:5432/app_db`, runs the existing source baseline, and starts a Next production build bound to `127.0.0.1:3000`. The proof refuses non-CI execution, remote hosts, alternate DB names/accounts, production secrets and enabled payout/billing/scheduler workers **before importing database modules**.

All employees, companies, contact values and audit markers are fictional. No live Neon, provider HTTP, payment, payout, bank verification, payroll state change, production SQL, schema migration or external email is used. A real-employer activation or release gate cannot be satisfied by these fixtures.

## Required real HTTP and SQL assertions

- **Positive own write:** Two independently signed-in employee sessions from different employers each perform a real successful contact-only PATCH. Each response must match exactly the persisted contact fields. One tenant-bound audit receipt must be saved for each success. The saved coworker, pay profile, punches, organization units, legal employers and payroll run rows stay unchanged.
- **Real higher-ID victim:** A third populated employer and worker have actual IDs higher than both attacker employers and coworkers. The victim has a distinct valid employee session and proves its own successful PATCH. The victim's subsequent employee/contact/audit/organization/workforce/payroll snapshots are identical before and after all attacker actions.
- **Forged selectors:** Each attacker supplies genuine victim-employer/victim-worker IDs in **both query and JSON body**, then a genuine same-employer coworker's ID. Because the production route ignores these selectors, its expected 200 must change only the authenticated worker's contact fields; a forged-value 403 is not invented.
- **Denials:** Anonymous PATCH yields 401, nonemployee Owner yields 403, and a request containing only unsupported payroll/bank/statutory or foreign-tenant fields yields 400. Every denial preserves the attacker, peer and victim snapshots and does not return private sentinels.
- **Revocation with another active grant:** Retain a valid login session for attacker A, grant that account an unrelated active membership in employer B, **revoke its active membership in employer A** without changing its linked employee record, then retry the same real PATCH. Exact 403 must be returned without touching either employer's saved contact values or audit history. After reinstating employer A membership, a new legitimate own PATCH succeeds.
- **Adversarial test contracts:** Mutation tests reject missing writes, wrong worker, modified coworker, payroll/pay-profile changes, false-positive HTTP 200, missing/foreign/extra audit receipts and private markers leaked through body or headers.

The independent test contract lives in `tests/tenant-self-profile-contract.test.mjs`, its assertions in `scripts/qa/tenant-self-profile-contract.mjs`, and the live executable in `scripts/qa/tenant-self-profile-http.mjs`.

## Acceptance and coverage ledger

Run the dedicated PostgreSQL 16 workflow on the PR's **exact final head**, and independently verify the authenticated HTTP outcomes and persisted SQL/audit invariants. Full CI/check, relevant security and payout-isolation workflows, any canonical source-fingerprint inventory requirements, and independent security review remain separate gates.

**Do not modify `scripts/qa/tenant-isolation-coverage-manifest.json`, mark PATCH as COVERED, declare tenant isolation accepted, merge, deploy, or enable money/provider flags from this test-only PR.** Review method-level proof receipts and reconcile the live manifest in a later separate review decision. The current coverage numbers and all other tenant batches remain unchanged.
