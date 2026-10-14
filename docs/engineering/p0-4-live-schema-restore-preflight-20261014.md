# P0-4 live schema and restore-governance checkpoint — 2026-10-14

**Disposition: BLOCKED / NO PRODUCTION MIGRATION.** This is an evidence-only, read-only preflight, not an applied migration record, DBA approval, backup-restore proof, change request authorization or live payroll certification.

## Identified source and observed target

- Source reviewed: `main@a196940a32f909eb1be977ac7dc3bf264032658b`, 2026-10-14 (GitHub). Main contains the canonical numbered `drizzle/0115`–`0123` files; **Git file presence is not database execution evidence**.
- Target: Neon project `calm-wave-70219564` (`neon-almond-ridge`), `neondb`, original branch ID `br-lucky-sound-b79i56jw` (`main`, default=true, protected=false), write endpoint ID `ep-cool-hat-b7e7gpoo` on that exact branch. IDs were independently read back through Neon project APIs; no URL credentials were fetched.
- UTC observation: `2026-10-14T07:26:50.211Z`. The source-controlled exact SELECT/CTE was `docs/sql/issue-910-read-only-catalog-probe.sql`, executed against the explicit branch and database. No DML/DDL, data rows, employee/payroll/bank values or secrets were read.
- PostgreSQL 18.6; **116** public tables; `workforce_plans` 11 columns / 3 indexes; `org_units` 14 columns; 3 ESS tables present; **zero catalog relations matching migration/receipt/journal** in the probe scope. Catalog absence is not proof an external release receipt never existed.

## Numbered historical/proposed prerequisites — catalog-only

| Source stage | Required objects | State at 2026-10-14 | Authentic applied receipt |
| --- | --- | --- | --- |
| 0022 | `workforce_plans` | PRESENT | UNPROVEN |
| 0022 | `job_profiles`, `positions`, `position_assignments` | ABSENT | UNPROVEN |
| 0050 | `worker_employment_events` | ABSENT | UNPROVEN |
| 0051 | `job_families`, `job_levels`, `job_grades` | ABSENT | UNPROVEN |
| 0052 | `worker_effective_changes` | ABSENT | UNPROVEN |
| 0110 | `provider_events` | ABSENT | UNPROVEN |
| 0112–0114 | demand batch/revision, forecast issue/score and staffing policy/event tables (6) | ABSENT | UNPROVEN |
| 0115–0116 | `payout_profiles`, `payout_batches`, `payout_transfers` | ABSENT | UNPROVEN |
| 0120 | punch photo evidence and punch submissions (2) | ABSENT | UNPROVEN |
| 0121 | user entity grants, employee entity assignments, entity transfers (3) | ABSENT | UNPROVEN |
| Registration | legal entity profile change requests and registration history (2) | ABSENT | UNPROVEN |

**Total from exact 26-object SELECT:** 1 PRESENT, **25 ABSENT**, 26 applied statuses UNPROVEN. Do not turn a catalog PRESENT into a synthetic migration journal receipt.

## Git migration provenance and correction

- Main contains **137** numbered `drizzle/NNNN_name.sql` files, ending at `0123`. There are **13 historical duplicate-number groups**. Never renumber or rewrite these files as a shortcut.
- Merged SQL 0115–0123 is not installed simply because CI executed equivalent SQL against disposable PostgreSQL. Stage 0123 is a draft additive repair that does not certify the missing 0115–0122 prerequisites or authentic historical worker/payroll attribution.
- The existing `scripts/issue-910-source-manifest.mjs` had 19 source entries and ended at 0121. This PR expands it to **22** by adding numbered 0122, numbered 0123 and the review-only 0121 schema body. `tests/issue-910-source-manifest.test.mjs` checks SHA-256 of exact local bytes, covers all nine numbered 0115–0123 files and keeps **production_applied='UNPROVEN'**. These are source checksums, not generated historical receipts.
- Source and candidate details: `docs/engineering/issue-910-0123-forward-migration-draft.md` and `docs/engineering/issue-910-provenance-live-catalog-20261013.md`. Re-use the merged #921/#958 PostgreSQL 16/18 rehearsal tests rather than replay historical DML.

## Restore and availability protections

- Neon API shows **8 branches** as of this checkpoint (not the older October 13 observation of 10). This is metadata only; it is not approval that remaining plan quota, privacy policy or source-data restrictions permit another clone.
- The original default branch remains **unprotected**. The current read/write endpoint ID and branch match the original, but that alone does not validate live Vercel/worker `DATABASE_URL` routing.
- `get_snapshot_schedule` returns an **empty schedule**; `list_snapshots` returns **one manual snapshot**, created `2026-10-12T05:16:34Z`, expiring `2026-10-19T00:00:00Z`. Neither a single expiring snapshot nor a successful synthetic CI restore proves retained encrypted offsite backup or validated RPO/RTO.
- Incident [#899](https://github.com/erwinmehehe/payrollph/issues/899) remains open: snapshot restore briefly changed the production default and endpoint on 2026-10-12. Request/write loss, downtime, and complete incident reconciliation are **UNKNOWN**, not zero. Never call restore with implicit `finalize:true`; use the existing source-only `scripts/lib/neon-isolated-restore-safety.mjs` controls and independent operator review.
- **No Neon branch, restore, snapshot, schedule, endpoint, role, DDL, migration receipt, environment flag or payroll data was changed by this inspection.**

## Required P0-4 operator/DBA gates (each OPEN until independent evidence)

1. Authenticate each historical numbered migration's execution from original deployment/DBA/transaction logs, timestamp, operator, target branch/database and exact SHA-256. Missing receipts stay `UNPROVEN`; do not invent past application.
2. Resolve legacy duplicate numbers and 0022/0050/0051/0052/0110/0112–0114 schema gaps with reviewed forward-only source. Reconcile tenant boundaries, current live columns/FKs/indexes and 0123 dependencies before proposing an approved numbered release.
3. Obtain least-privilege catalog-only account and privately signed independent DBA/release reviewer source/target attestation. The existing protected GitHub audit workflow is **manual**; no run of it is implied here.
4. Complete #899 write-impact analysis. Confirm live application/worker endpoint identity privately. Keep incident `UNKNOWN` if independent logs are unavailable.
5. Establish reviewed backup retention, actual encrypted offsite evidence, available protected nonproduction capacity, `finalize:false` restore plan, verified original endpoint/default after rehearsal, observed data recovery and RPO/RTO, independent security/DBA acceptance.
6. Only after those gates pass: rehearse the exact source SHA on a segregated protected clone with direct (non-pooled) PostgreSQL connection, immutable before/after evidence, tenant and centavo invariants and rollback. A production apply requires a separate explicit protected change authorization. **Never use `db:push` on Neon main.**

**Next decision:** Production SQL is **NO-GO**, source-only remediation/independent DBA receipt retrieval **GO**. Keep payout, scheduler and employee document rollout switches governed separately. This report does not alter issue #899 or supersede real-employer #579 and official filing acceptance.
