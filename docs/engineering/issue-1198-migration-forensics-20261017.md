# Issue #1198 — production migration forensics and DBA evidence decision

**Snapshot: 2026-10-17 | Status: HISTORY UNPROVEN / production migration NO-GO**

This repository-owned packet supersedes the disconnected report download. It is an **investigation and operator handoff**, not a new authenticated production query, an applied-SQL receipt, or permission to repair or migrate any live database. Existing catalog numbers below are dated observations from issues, not an assertion about the present serving database.

## Source-of-truth evidence and its limits

| Subject | Observed on October 17 | What it does — and does not — prove |
|---|---|---|
| Intended production-linked Neon target | Project \`calm-wave-70219564\`, default branch \`br-lucky-sound-b79i56jw\`, endpoint \`ep-cool-hat-b7e7gpoo\`, DB \`neondb\`, PG18.6 (#1198) | Identifies the *inspected* catalog. The effective Vercel web/worker/scheduler database session has **not** been independently bound to it. |
| Source-to-catalog table names | 271 source-declared names; 154 public tables on the inspected Neon default; 124 missing source names, 7 live-only names (#1198) | Structural drift in the **dated inspected target** only; not a current full schema diff or proof of historical SQL execution. |
| Migration journals | \`payrollph_release_migration_receipts\`, \`drizzle.__drizzle_migrations\`, alternate public Drizzle journal absent in inspected catalog (#1198) | No authentic target-specific execution journal *observed*. Do **not** manufacture an "applied"/"never applied" decision. |
| Audit-chain objects | Expected \`0109\` sealer/protection functions and protection trigger absent in recorded audit snapshot (#908) | Current control gap at observation; cannot establish whether 0109 once ran and was rolled back, restored or replaced. |
| Audit identity | Existing \`payrollph_schema_auditor\` was overprivileged; dedicated \`payrollph_catalog_audit_1031\` could not authenticate (#1078/#1198) | Protected read-only production audit **not yet authorized or verified**. PR #1090 is a bootstrap *template*, not evidence a restricted production LOGIN is active. |
| Historical restores | #899 documents October 12 Neon default/endpoint reassignment and subsequent restoration; an observed snapshot comparison matched then-existing tables/rows/sequences | Persistent equality at one observation, **not** proof all transient requests or writes succeeded, nor explanation of later schema drift. |

The 7 live-only tables can be intentional objects defined outside the primary schema module. Never auto-drop them. The historical counts from other branches and dates (e.g. 136/148) are not interchangeable with this target's 154-table snapshot.

## Migration object evidence is not an applied receipt

These are *catalog observations* from #1198 and related historical DBA records, **not** direct inspections newly executed for this document.

| Source / family | Catalog example | Recorded observation | Historical execution verdict |
|---|---|---|---|
| \`0022\` / job architecture | \`job_profiles\`, \`positions\`, \`position_assignments\` | Present in #1198 spot check, absent in an earlier #1031 observation | **UNPROVEN** — target/time changed or catalog evolved; no matching transaction receipt. |
| \`0050\` / worker history | \`worker_employment_events\` | Earlier missing, present at #1198 snapshot | **UNPROVEN** — creation and event-data history not attributed. |
| \`0109\` / audit chain | audit protection trigger/functions | Missing at documented checkpoint | **UNPROVEN** — protection currently missing at checkpoint, past attempt unknown. |
| \`0110\` / provider inbox | \`provider_events\` | Absent from #1198 catalog | **UNPROVEN** — absence today cannot establish it never ran. |
| \`0112\`–\`0114\` / demand | six demand import/forecast/policy tables | Absent from #1198 catalog | **UNPROVEN** — no historical execution proof. |
| PR #1189 creator proposals | 23 proposed candidate tables | All 23 missing in #1198 catalog | **NOT AN EXECUTION RECEIPT** — review-only source changes. |

Apply one of the following **evidence classes**, not a guessed migration status: \`OBJECT_PRESENT_WITHOUT_RECEIPT\`, \`OBJECT_ABSENT_WITHOUT_RECEIPT\`, \`RECEIPT_VERIFIED\` (authentic path + file SHA-256 + actor + timestamp + committed target-specific execution record), or \`RECEIPT_CONTRADICTS_CATALOG\` (requires incident investigation). A missing journal means even a complete catalog match cannot prove who executed historical SQL.

## Use the existing repository tooling (do not invent a second release path)

1. **Source hashes only, no DB:** run \`node scripts/audit-production-migration-receipts.mjs --inventory\` and \`node scripts/audit-historical-dba-evidence.mjs --inventory\`. Both are source attestations; they do not establish application history. Preserve full SQL paths because numbered prefixes collide.
2. **Runtime target attestation:** use protected, manual \`.github/workflows/production-runtime-db-target-attestation.yml\` with exact deployed \`main\` SHA and privately approved environment values. It establishes the app's actual target metadata, not historical migration receipts. The exact worker/scheduler target must be independently attested separately.
3. **Dedicated restricted audit login:** follow #1078. The historical \`payrollph_schema_auditor\` is unsafe. The #1090 template provisions **NOLOGIN** and requires pre-existing journal tables; it did not create an independently usable production audit credential. Actual role provisioning, grants or secrets require a separate authorized DBA/security change.
4. **After identity and restricted-role approval only:** manually run protected \`.github/workflows/issue-1031-full-schema-diff.yml\` on exact reviewed \`main\` using a catalog-only connection. Use \`.github/workflows/historical-dba-evidence.yml\` for the six explicitly scoped historical sources. The companion \`issue-1198-catalog-only-inspection.sql\` is a **DBA review worksheet**; it is neither CI-executed nor a substitute for the fail-closed role/target checks in protected workflows. Keep raw structural metadata private.
5. **Actual receipt reconciliation:** use \`.github/workflows/production-migration-receipts-audit.yml\` **only after** genuine adopted migration-control tables, approved dedicated credentials and historical provenance exist; its verifier deliberately fails when journals are absent. Recover authentic action/workflow logs, DBA tickets, release approvals and immutable migration execution timestamps; never backfill fictional receipts.
6. Crosswalk catalog tables, columns, keys, indexes, functions, triggers and effective permissions with exact reviewed SQL file hashes and the authenticated deployed DB. Resolve the October 12 restore incident (#899), 13 duplicate migration-number groups and missing predecessor lineage (#910) before planning repairs.
7. **Separate change authorization:** any forward-only schema repair, role provisioning, migration journal adoption, snapshot restoration or production apply requires independent DBA/security/release review and protected rehearsal. Do not run \`db:push\` against Neon or apply archived migration files ad hoc.

## Audit SQL packet and local CI

\`docs/engineering/issue-1198-catalog-only-inspection.sql\` contains a bounded, **catalog-only reference inspection**: one \`REPEATABLE READ READ ONLY\` transaction, target/session metadata, effective privilege signals, journal object *existence*, audit-chain trigger/function metadata and structural identifiers. It reads **no journal rows, employee/payroll/bank rows or business contents**. It ends in \`ROLLBACK\`.

It **does not fail closed by itself** on an overprivileged login; the DBA must first independently bind exact target and verify the least-privileged role using existing protected checks. Never invoke this worksheet from a generic owner/production connection or upload its raw results to public GitHub logs. The companion offline contract test is \`node --test tests/issue-1198-migration-forensics.test.mjs\`, also wired into the source-only \`P0-4 Historical DBA Evidence\` PR CI job. This local test checks packet safety/wiring, **not production**.

## Current DBA decision

**Historical SQL execution: UNPROVEN. Production release/migration: NO-GO.**
No live SQL was run or production config modified to prepare this package. Human employer UAT (#853), WFM device checks (#691), payroll centavo reconciliation (#579), actual serving DB attribution and release prerequisites remain separate.

### Records
- [#1198](https://github.com/erwinmehehe/payrollph/issues/1198) — dated Neon source/catalog comparison and missing journals
- [#1078](https://github.com/erwinmehehe/payrollph/issues/1078) — protected catalog-only role/environment gate
- [#1090](https://github.com/erwinmehehe/payrollph/pull/1090) — unexecuted DBA role bootstrap template
- [#908](https://github.com/erwinmehehe/payrollph/issues/908) — audit-chain/role isolation
- [#899](https://github.com/erwinmehehe/payrollph/issues/899) — restore incident
- [#910](https://github.com/erwinmehehe/payrollph/issues/910) — migration lineage
- [#1031](https://github.com/erwinmehehe/payrollph/issues/1031) — runtime missing-relations root cause
