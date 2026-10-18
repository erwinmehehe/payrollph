# #1102 — approved Option B: isolated legacy fictional payroll-header correction rehearsal

**Owner decision (18 October 2026):** Option B selected: prepare a tightly scoped correction of the THREE known **fictional** legacy public-demo run headers, **starting with an isolated database rehearsal**. This authorizes preparing/test-rehearsing the change, **not** applying it to the original/default Neon database or enabling financial transactions.

**Current disposition: NO-GO for changes to stored Neon rows.** The original branch is preserved. This packet does not auto-migrate anything, use real worker data, submit filings, modify a payroll calculation, or release/pay a payroll run. The existing publicly displayed Released status is **fictional sample state**, not evidence of actual settlement.

## Read-only baseline from existing preserved Neon default (October 18)

- Project: calm-wave-70219564
- Original branch: br-lucky-sound-b79i56jw (**default**; also used by Vercel deployment; never use it as a test write target)
- Database: neondb
- Fictional organization: Loom & Local; three distinct run IDs 1–3; eight fictional staff, six details in each run; **all 18 existing payroll detail rows are preserved**.

| Run | Expected status and period | Original gross | Original net | Six-entry gross sum | Six-entry net sum |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Released, Aug 16–31 2026 | PHP176,300.00 | PHP145,645.00 | PHP181,300.00 | PHP147,400.00 |
| 2 | Pending approval, Sep 1–15 2026 | PHP181,250.00 | PHP149,768.00 | PHP182,800.00 | PHP148,600.00 |
| 3 | Needs review, Sep 16–30 2026 | PHP183,400.00 | PHP151,524.00 | PHP184,300.00 | PHP149,800.00 |

All three had six detail entries matching the employee count in a read-only query. The repository's merged new public-demo generator already derives **newly inserted** header totals from the same six detail entries. The mismatch is **historical persisted mock data**, not an actual real-world underpayment or evidence of incorrect statutory engine calculations. See #1102, merged PRs #1107 and #1217, and the source-only accuracy packet PR #1244.

## Rehearsal design and scope

**Executable rehearsal ONLY:** scripts/qa/rehearse-1102-legacy-demo-headers.mjs. It rejects every non-GitHub-CI environment and any DATABASE_URL other than the literal *loopback* PostgreSQL service on 127.0.0.1:5432/app_db using isolated, disposable credentials. No dotenv or authenticated Neon connection and no source checkout of confidential payroll data.

**Isolation and all-or-nothing proof:**

1. The GitHub Actions workflow .github/workflows/issue-1102-header-rehearsal.yml allocates a fresh PostgreSQL **16** and **18** runner service, with no cloud/Neon credential, and clears the service on completion. It also disables PayMongo and Xendit payout flags.
2. The runner asserts the disposable DB has **zero persistent user tables**. The only tables it creates are PostgreSQL **TEMP** tables; every SELECT/UPDATE/DELETE in the test names the pg_temp schema explicitly.
3. Creates **fictional** 8-person/3-run/18-entry mock copies from the existing six-entry fixture generator plus the three recorded original header pairs. This is a **representative reenactment of proven aggregate values**, not a clone of the existing Neon database, its full employee records, or their actual permission/audit boundaries.
4. Enforces exact fictional organization and run identity, period labels/dates, statuses, original header values, exactly 6 unique staff/entries per run, gross minus deductions equals net for each entry, and strict expected aggregate totals. Rejects any changed record/period/roster instead of guessing.
5. In a PostgreSQL transaction, simulates updating ONLY each temp payroll-run header's gross_pay/net_pay with compare-and-swap expected-before guards. Ensures exactly **3** temp rows change and totals reconcile.
6. Attempts five negative changes (stale original value, different status, bad employee cents, missing employee detail, wrong organization) and rejects replay. All tests roll back. The positive transaction also always **ROLLBACKS intentionally**, and rechecks the original data snapshot byte-for-byte.
7. Success output has counts, no employee identity, no account information, no payroll credentials or personalized data. It does **not** declare any original-Neon data repaired.

**Source-only test execution:** open a draft PR changing the runner, this workflow and this runbook. GitHub Actions runs the disposable PG16/PG18 job at the *exact PR SHA*. Do not report a passed test until its logs are actually inspected. Failing or pending CI means rehearsal is NOT confirmed.

## Second gate: real source-schema tables, durable (disposable) reversal

After the original temporary-table adversarial test, the updated PG16/PG18 workflow runs npm run db:push **only** against its fresh 127.0.0.1:5432/app_db PostgreSQL service and invokes scripts/qa/rehearse-1102-real-schema-guarded-reversal.mjs.

This is a materially stronger source-shape rehearsal, but **not a clone of the deployed Neon's historic data or all its schema drift**. In particular, the repository's current Drizzle source schema cannot prove every live Neon catalog constraint, runtime DB role, cache or integration. A later permissioned detached backup and restore would be required for a true exact-target replay.

The new executable runner, limited to GitHub Actions with its own synthetic connection, performs:

1. Verify required CI, repo, test environment, **no production DB connection variable**, exact loopback username/password/host/database, payout flags disabled, and zero business rows before fixture seed.
2. Use the real public-demo source seeder against the actual repository-defined public organizations, employees, payroll_runs and payroll_entries tables; check **one fictional organization, eight workers, three historical run IDs and eighteen details**.
3. Verify newly seeded correct headers, then intentionally place the **three captured historical bad header pairs** into this disposable database *only*, without changing any details.
4. Record a private in-process SHA256 fingerprint for existing synthetic employee, detail, audit, approvals, bank and filing tables. No values, secrets or employee identities leave the CI runner.
5. Test five negative preflight mutations (stale header, different run status, broken employee net maths, missing detail, wrong organization) inside transactions that roll back. Enforce fixed date/period, organization, status (including the Released mock), unique six workers, cents sums and **absence of linked approval/payment/filing/payroll-job evidence**.
6. Within SERIALIZABLE transactions, demonstrate all three header-only UPDATEs with exact source-value compare-and-swap and an in-session temporary before/after receipt. Prove both the ordinary **ROLLBACK** and, separately, a **COMMIT on disposable PostgreSQL** followed by a **committed reverse three-header update** with matching guard conditions.
7. Refuse replay in either direction. Assert that the original mock headers and all synthetic non-header rows/fingerprints were restored exactly. The workflow destroys its PostgreSQL service and ephemeral receipts afterward.

**Approval boundary:** This procedure contains no command path capable of applying against Neon: only runner-owned loopback Postgres with a hard-coded CI credential and empty DB check is allowed. The existence of a tested reversal proves nothing about undoing external payouts, agency filings or immutable history: those remain forbidden and outside scope.

**CI evidence:** Record the PG16 and PG18 job receipts against the most recent exact reviewed PR SHA after execution. At the time of writing, the new stronger jobs have **not** yet been independently verified. Do not update the existing 11/11/12/12 earlier summary to claim the **new** rehearsal has passed without checking this SHA.

**No additional cloud budget required:** #907 owner scope confirmed **fictional pre-customer development**. The documented zero-subscription local encrypted backup and offline restore remains an available operator choice if and only if the actual source is independently confirmed fictional. Do not use paid AWS or a Neon restore that might promote the default endpoint.

**Original-DB approval remains separate:** A reviewed before/after receipt and a committed reversal in disposable CI **never constitute** permission to modify the current Neon default or deployed web application's data. An operator must approve the exact original branch/host/role/rows, record appropriate recoverability and audit decisions, and verify the UI independently before that narrow historical correction can be executed.

## Operator decision before later actual Neon correction (separate authorization)

The owner's “B” selection authorizes **isolated rehearsal only**. Do not run the rehearsal script against Neon: it refuses to operate outside disposable CI and uses pg_temp deliberately. If later instructed to repair the original Neon fictional rows, it **needs a new specific review and execution plan**, not repurposing this rehearsal as a production migration.

Before any actual update of the default or other shared database:

- [ ] Verify current exact deployed Vercel/runtime Neon project, branch, endpoint, database, DB role, purpose and whether it is also serving non-demo tenants; default/shared branch must not be treated as an unqualified safe test target.
- [ ] Separately approve a **safely reversible backup and restoration process** appropriate to its records, with non-expiring evidence, owner/DBA/security sign-off and least-privilege operator. The prior no-AWS/no-recurring-spend decision remains binding.
- [ ] Verify the only affected organization is actually fictional and the exact three run IDs and historical header/data/date/status/worker counts **still match** the immutable expected-before values. Reject unrelated employers, new periods or arbitrary employee rows.
- [ ] Preserve the existing three original header pairs and a private approved full data/ledger integrity fingerprint; agree on whether any immutable settlement/audit/source history can legally/operationally be edited. “Released” may require *annotation rather than mutation* even if sample data. Do not rewrite irreversible/payable history without written approval.
- [ ] A separate reviewed, transaction-scoped proposal updates **gross_pay and net_pay only**, precisely three target rows, zero changes to details/approval/snapshots/bank files/statutory computations, with preflight and postflight. Do not blindly execute SQL against a live database.
- [ ] Reconcile DB row totals, UI displayed summaries, audit logs, read-model caches and any independently stored summary mirrors on the actual intended target. Confirm no user/legal consequences and no payments/filings occurred; keep payment paths disabled.
- [ ] Obtain explicit **second owner authorization naming the exact target and proposed change** before live changes. Retain rollback plan and operator receipts privately.

## Exit decision

| Gate | Meaning |
| --- | --- |
| A — Code and synthetic scenario test | Complete only if PG16/PG18 workflow passes at exact SHA, including rejection and ROLLBACK. This is **source QA**, not a stored-row repair. |
| B — Original Neon historic data | BLOCKED until approved scoped plan and execution receipt; no automatic GitHub PR merge may write actual payroll records. |
| C — Payroll certification | Independent real-employer #579 reconciliation still NOT RUN; financial and filing releases remain NO-GO. |

Keep issue #1102 OPEN until the historic displayed mismatch is actually corrected under documented authorization (or separately labeled as unverified) and the UI plus protected database evidence confirms the state. **This document records the approved path, not a claim of completed database correction.**
