# Schema recovery operator packet — #1015 / #1054 / #1061

**Disposition: ENGINEERING REVIEW PACKET; NO-GO FOR PRODUCTION APPLY.** Prepared against `erwinmehehe/payrollph` source `main` commit `bb722cdc4914a4546a7f7699ceaa62cdfaa1904d` on 2026-10-16. This is neither a DBA approval, production inventory, migration receipt, restore witness, protected pipeline run, HR privacy acceptance, nor authority to enable features or move money. Do not treat a merged PR or green CI job as one of those records.

The earlier handoff described an **unmerged candidate rewrite** of `0125`, but the stacked #1120/#1121 implementation instead puts the strengthened companion checks in the protected runner while leaving the numbered `0125` SQL unchanged at SHA-256 `3f51ca8ed1ea2cb8a04e071f567be1b5281425ab26677af4d5a539bdaeeee20b`. Forward-only `0128` has its own unapproved source checksum and must be reviewed separately after authentic `0127` history. All eventual release commits, source hashes and receipts require independent operator reconciliation. No real database SQL has been applied through this PR.

## PR #1121 synthetic catalog evidence update (2026-10-16; engineering only)

[Stacked PG16/PG18 workflow](https://github.com/erwinmehehe/payrollph/actions/runs/38868214207) at earlier PR head `d5b93ea3565487cc78f667e11785c32ae3d33952` ran actual source 0115–0126 on disposable rollback-only databases. The ten-table #1031 comparison immediately after 0126 recorded **214 PASS / 49 MISSING / 0 DRIFT / 49 EXTRA**: all 98 non-PASS rows were exact FK-name differences, not permission to ignore schema drift. The initial 0128 candidate reconciled 35 constraints and still left **14 MISSING and 14 EXTRA** across `employee_availability_rules`, `open_shifts`, and `open_shift_claims`. Exact comparison still correctly failed on both PG16 and PG18. Separately, TypeScript failed with TS2339 because `normColumnDefault` did not declare the `type` property that it reads.

This PR revision adds the missing **14** strict, catalog-verified 0128 renames (49 total) and fixes that TypeScript type declaration. **The revised patch has no passing PG16/PG18 or TypeScript result yet; inspect new CI for actual evidence.** Source migration `0125` is not changed by this PR revision; the stacked #1120 SQL Migration History Guard **passed its advisory CI check** at `78c6026`. This is not a receipt, independently approved 0127 history, or a human migration-policy release decision. Even green isolated CI cannot authorize a real 0128 apply, migration ledger adoption, payout, feature activation, or production acceptance. Authentic 0127 provenance/receipts and protected source checksums remain independent prerequisites.

## 2026-10-16 engineering evidence boundary

The owner reports a **real local PostgreSQL 16.14 (UTF8)** pre-fix probe on the original
`0125`: an orphan `open_shifts_id_seq` was accepted and a new `..._id_seq1`
was created; a predicate-bearing replacement staffing uniqueness index was
accepted; and an orphan employee-availability index was rejected by a generic
PostgreSQL `already exists` instead of the reviewed preflight code. The original
SQL contains no integer-PK parent test. These are **owner-provided earlier
PG16 results**; this packaging session did NOT connect to PG16 and has NOT
executed the revised SQL.

The reviewed change includes seven typed-parent catalog guards, strict
five-key unpredicated ready/valid unique btree index verification, named
orphan relation/constraint guards, WFM foreign-key name reservation checks, a transactional
postflight canary, and a guarded regression suite. Those are **proposed source
changes only** until the new PG16 regression returns passing assertions. A
schema-only source match does not constitute the #1031 catalog-diff result.

The latest source SHA reviewed through GitHub's read-only connector is
`bb722cdc4914a4546a7f7699ceaa62cdfaa1904d`. The user's Windows working
directory is not mounted into this execution container; neither a local
branch nor PR was created by this packet. Remote writes, production access,
workflows against live databases and receipt mutations were not attempted.

## Starting facts, authority boundaries

| Item | Confirmed evidence / required disposition |
| --- | --- |
| Production-shaped absence | **All six** compensation tables (including `compensation_events`), `attendance_exception_events`, `employee_availability_rules`, `open_shifts`, `open_shift_claims` reported absent in issue metadata-only inventories. Never substitute development state (`compensation_events` present) for this starting state. |
| Production-shaped presence | `organizations`, `employees`, `users`, `time_punches`, `worksites`, `shift_definitions`, `staffing_requirements`, `job_profiles`, `job_grades`, `legal_entities`, `worker_effective_changes`, `employee_pay_revisions` reported in issue/review docs, but exact live endpoint/PK/index parity remains independently unproven. |
| Legacy staffing invariant | `staffing_requirement_role_unique` on `organization_id, worksite_id, work_date, shift_definition_id, COALESCE(job_profile_id,0)` must be a valid, ready, **unpredicated** unique btree index. `staffing_requirement_unique` must remain absent; never replay archived 0039. |
| Receipt/adoption state | `payrollph_release_migration_receipts`, `payrollph_migration_cutover`, `payrollph_schema_migrations` not observed on production. Absence of the ledger is **not** evidence of nonexecution. The protected runner must STOP until authentic historical cutover and journals exist by independent authorization. Never fabricate entries. |
| Separate incidents | #899 restore redirection impact analysis, #907 encrypted offsite backup + witnessed restore, #908 database role/audit-chain privilege proof remain independent, open human gates. |
| Other drift | #1031's broader schema inventory and permission/BI readiness are separate. Fixing these ten targets never proves full-app schema parity or authorization. |
| Feature flags | Keep `WFM_EMPLOYEE_AVAILABILITY_ENABLED` and `NEXT_PUBLIC_WFM_EMPLOYEE_AVAILABILITY_ENABLED` OFF pending WFM external acceptance; keep money-out, employer activation and live financial mutations OFF. |

## Source inventory and exact-byte SHA-256 (unpushed `main` baseline)

These are **source hashes only**, recomputed from exact source UTF-8 bytes on GitHub `main` at `bb722cdc` for 0115-0126. The proposed changed 0125 exists only in this handoff. They are not DBA-reviewed release-plan hashes or migration receipts. Recompute on the eventual protected and independently reviewed release commit before using any workflow.

| Order | File in `drizzle/` | Source SHA-256 at `bb722cdc` |
| --- | --- | --- |
| 0115 | `0115_payout_profiles_foundation.sql` | `0d4303f9c7a7e5f5ddf8f0af3ffc00950b6a791d7a805047f763007240848922` |
| 0116 | `0116_payout_ledger_foundation.sql` | `53a5cfcab1b990835fce06bcac198a7fe88e57404f595286a12e20d37260eb0c` |
| 0117 | `0117_inline_first_payroll_journey.sql` | `d7e69a778ce61f968146530c33ce27db93c1255f29ef9d1fd6c2da0134f1e923` |
| 0118 | `0118_wfm_roster_scale_rules.sql` | `5c21bb747e0e9c2827c129d97be076f0ea274808405a853fb664a965a48e3fa4` |
| 0119 | `0119_xendit_payout_provider.sql` | `4cab9df2bbe664cb5d03ed501e51473722f035041a04e555dcd0200b4df17e78` |
| 0120 | `0120_wfm_punch_evidence.sql` | `dfb449421d9c51c071d4f2458f01368bec788f0c4c650687e440cfbe711ba236` |
| 0121 | `0121_multi_entity_v2_scope_transfer.sql` | `62fce4dcdb62c9dff2723ffed80a4f1de5333ee6d24b83fcf13aed5265a33b03` |
| 0122 | `0122_tenant_module_disclosure.sql` | `4257d06ed8779e6141c5b1bc5e883fc0e639b7c8c206950a0cea5a65dc219e8e` |
| 0123 | `0123_multi_entity_forward_schema_repair.sql` | `483aa51c1a9d7bd266f4908a219fdc2e3b52ec15ebfb79d356498f86917043bb` |
| 0124 | `0124_attendance_exception_forward_repair.sql` | `91f5b6d5c6ac7a3205caf7a86b8b2ce03085608eaec5c47686e2106816a9f2ab` |
| 0125 | `0125_wfm_availability_open_shifts_forward_repair.sql` | `3f51ca8ed1ea2cb8a04e071f567be1b5281425ab26677af4d5a539bdaeeee20b` **OLD main, pre-fix** |
| 0126 | `0126_compensation_governance_forward_repair.sql` | `cda60c487484646d7c29fbf3b5425a6fb300f26cc445e923d68e345c59cb38c3` |

**Unmerged engineering candidate (not an approved release hash):** After applying the accompanying **revised** #1054 patch, the exact resulting `0125` file hashes to `ccb8b0332c9ecd7b301aa85e5962c7ce22f210b56ae6cedb092043d4b0007d87`. The superseded handoff hash `be393b6c...` must not be used. Do not dispatch a protected release with this candidate hash unless the identical bytes are merged, independently reviewed, and present on exact protected `main`. Recompute after any further edits. `Get-FileHash -Algorithm SHA256` (PowerShell) or `sha256sum` (POSIX) should be compared to the pinned release plan, not a pasted or assumed receipt.

**Numeric prefix finding:** The retrieved `main` tree has 140 numbered migration SQL files over 126 prefixes, including 13 legacy prefix collisions. **0115–0126 each have one numbered file**, with no duplicate prefix in this proposed forward interval. This does not resolve *historical* collisions, which require full path + exact hash + genuine reviewed receipts. Some 0121-created authorization-table/index names deliberately reappear inside 0123 with `IF NOT EXISTS`: this is a conditional re-declaration, **not proof of correct existing shape**. All relevant parent schemas must be catalog-diffed before operator authorization.

## Dependency order and mandatory preflight

| Stage | Dependency that must be proved on the intended target | Stop if |
| --- | --- | --- |
| 0115–0116 | Modern integer-key `organizations`, `employees`, `payroll_runs`, `payroll_entries`, `legal_entities`, and all source SQL's payout prerequisites. Establish target lineage first. | Legacy UUID lineage, missing parent/PK, unexpected payout table/sequence or an unapproved historical disposition. |
| 0117–0120 | Completion of 0115/0116 and required WFM shift/assignment, payout/provider objects. | Disparate/schema-incomplete prerequisites or money/provider flags unexpectedly ON. |
| 0121 | A **historical payroll/entity backfill**, not a metadata-only schema change. Read human-reviewed attribution and immutable parent-run evidence, pre/post-centavo comparison and tenancy constraints. | Any ambiguous payroll history, historical reassignment, unapproved data access/backfill or discrepancy. |
| 0122–0123 | Source 0123 preflight requires payout foundations and role/entity predecessors; inspect its `CREATE ... IF NOT EXISTS`, `NOT VALID` constraints, and parent catalogs for drift. | An existing table or index name differs in definition; a forbidden cross-tenant link, invalid parent or unapproved `NOT VALID` posture. |
| 0124 (#1015) | `organizations`, `employees`, `users`, `time_punches` with integer, single-column `id` PKs; target absent; no reserved indexes/sequence. | `ISSUE1015_*` preflight P0001, wrong schema namespace or failure to meet 36-object read-only parity. |
| 0125 (#1054) | All seven parent `id` integer PKs, complete unpredicated role-scoped staffing uniqueness index; three targets absent; no orphan reserved names; no legacy staffing uniqueness. | `ISSUE1054_*` P0001, mismatched staffing index, a missing/wrong PK, partial table, orphan index/sequence, or unexpected FK/index shape. |
| 0126 (#1061) | All eight parent `id` integer PKs (`organizations`, `users`, `employees`, `job_profiles`, `job_grades`, `legal_entities`, `worker_effective_changes`, `employee_pay_revisions`). All six targets absent — including `compensation_events`; no reserved names. | `COMP1061_*` P0001, partial existing compensation table, any parent drift or inconsistent postflight counts. |

Sources are additive candidate SQL except the explicit 0121 historical changes. No 0039/0042/0054 archived migration is in this plan. No target will be unilaterally dropped/recreated to satisfy a guard. A replay of 0124/0125/0126 **must fail closed**, not be treated as idempotent success.

## Operator sequence: STOP at each missing independent gate

1. **Freeze & scope:** Owner and authorized DBA/security reviewer identify the exact reviewed source SHA, approved maintenance window and production incident/change references. Leave production changes, payout activity and WFM release flags disabled. Independently map *effective* deployed Vercel and worker `DATABASE_URL` connection/role to the intended Neon project/branch/endpoint/database/TLS properties **privately**. Reconcile #899 endpoint redirection and possible transient data/write impact. **STOP** if target, roles or prior incident effect are ambiguous.
2. **Recoverability first (#907):** With independently approved private handling, establish an encrypted, durable off-provider backup and witness a privacy-approved sanitized isolated restore. Verify schema/sequence/catalog integrity and privately retain authorized RPO/RTO, storage/version and recovery evidence. An on-provider snapshot, new Neon branch, CI fixture or no-data synthetic test is **not** this witness. **STOP** without the verified restore.
3. **Historical source/receipt reconciliation:** Use #1015 read-only reconciliation #1067, the reviewed historical manifest and `docs/engineering/production-migration-receipt-runbook.md` to classify **every** historical full path, SHA-256 and duplicate prefix. Secure independent proof of historical `applied` / `baseline-included` dispositions; never infer from table existence. In particular, require 0121 historical employer/run attribution review. **STOP** when any record is missing, inconsistent or not independently approved.
4. **Adopt approved ledgers, never invent receipts:** Only the independently authorized DBA may provision the genuine historical receipt table, forward journal and cutover row according to `docs/engineering/reviewed-migration-runner.md` and its reviewed templates. Establish contiguous post-cutover numbering and actual migration state, with separate audit and writer roles. Never create a fake ledger, simulated applied row, or marked-complete step to advance the runner. **STOP** if the audit cannot prove ledger integrity, order or intended baseline.
5. **Catalog-only auditor role (#908 and P0-4):** Independently provision and verify the restricted `NOLOGIN` template's final authorized login from `docs/engineering/p0-4-catalog-auditor-bootstrap.md`, testing *that actual login* has only catalog plus approved journal SELECT, no app-row SELECT, writes, CREATE, BYPASSRLS, privilege inheritance or privileged audit-chain maintenance. The audit account is **not** the SQL writer or app role. Independently accept #908's app/worker/sealer privilege isolation. **STOP** on excessive access or any inability to inspect required journal/catalog objects.
6. **Read-only source-versus-catalog baseline (#1031):** Manually dispatch **Issue 1031 Full Production Schema Diff (Read Only)** from a protected exact `main` SHA, with `reviewed_sha` and privately confirmed `expected_database_name`, using the restricted production catalog login. Capture sanitized PASS/MISSING/DRIFT/EXTRA per target plus *the rest of the schema* and independent full-path source/hash references. The read-only workflow has no qualifying run evidenced in this packet. **STOP** on unexplained DRIFT/EXTRA, a missing parent/column or any privilege/identity failure.
7. **Synthetic integrated rehearsal before approval:** On fresh disposable local PostgreSQL **16**, `initdb --encoding=UTF8 --locale=C` (PG18 additionally if available), with fictional data only, build an exact agreed **production-shaped** baseline. It must omit all ten target tables, including dev-present `compensation_events`, and omit any absent 0115–0123 foundations while preserving actual known parent/role-index prerequisites. Run exact file order `0115 -> 0116 -> 0117 -> 0118 -> 0119 -> 0120 -> 0121 -> 0122 -> 0123 -> 0124 -> 0125 -> 0126`, followed by the separately proposed `0128` FK naming reconciliation **only in the isolated fixture with 0127 already accounted for**. A real production 0128 plan requires independent 0127 migration/receipt review first; never skip or forge 0127. Retain the measured pre-0128 FK-name MISSING/EXTRA records, then run the actual `generateSchemaManifest` / `diffSchema` (#1031) against all ten target tables and require no MISSING/DRIFT/EXTRA **after 0128**, unchanged fictional payroll totals, full transaction rollback, and rejection of partial/replayed/wrong-PK/orphan/predicated-index cases by the documented `P0001` guard. Review CI PG16/18 results only as engineering evidence. **STOP** on even one unexecuted or failed acceptance case; `NOT_RUN` is not `PASS`.
8. **Human release decision:** DBA, security and payroll/privacy operators separately review migration ordering, locks, historical data backfill, FK names/actions/tenant boundaries, real source/checksum and expected postflight, backup/restore/forward recovery steps, #899/#907/#908 status and exact deployed code. Obtain a **separate recorded DBA approval reference** for the actual protected SQL change(s). No engineer/AI signs for them. **STOP** without independent approval.
9. **Protected plan & apply, one migration per invocation:** From exact protected reviewed `main`, use **Production Reviewed SQL Migration (Manual, Protected)** workflow. For EACH approved, genuinely outstanding post-cutover file in the 0115–0126 order (and, separately, any 0128 after authentic 0127 reconciliation), enter `mode=plan`, exact `reviewed_sha`, verified `expected_database_name`, full `migration_file=drizzle/NNNN_...sql`, and exact `migration_sha256`. Inspect planned contiguous receipts, target, guard, role and result. Only with independently approved `approval_ref`, protected environment/branch rules, distinct writer and explicit `apply_confirmation=APPLY_APPROVED_SCHEMA_MIGRATION` may the authorized operator separately dispatch `mode=apply`. The runner owns `BEGIN/COMMIT` and immutable in-transaction source+hash journal; **do not** write receipts or run DDL through this document. After EACH apply, independently reconcile authentic receipt and catalog state **before** proceeding. If a prefix is already legitimately in the adoption boundary, the DBA must classify it from real evidence, never force replay/skip. **STOP** immediately on all failed plans/guards or missing journal continuity.
10. **Read-only postflight and runtime privacy:** Independently run #1015 `docs/sql/issue-1015-attendance-exception-catalog-preflight.sql` (36/36 expected), the ten-table predicates below and #1031 protected full-diff workflow again at correct source and target. The DBA verifies source table, FK parent/action, defaults, unique indexes and sequence ownership, not only counts. With approved fictional/live-sandbox identities, run the authenticated GET checks below at exact **deployed** SHA and inspect sanitized no-500 server telemetry. These are POST-release evidence gates, **not** approval to do SQL or enable features.
11. **Keep launch gates separate:** WFM #691 external overnight/overlap/ESS/mobile/tenant-denial and compensation #1061 / #1046 HR privacy acceptance require independent witnesses. Only after such approval may owners assess enabling WFM flags. Production payroll, money-out, salary approvals, bank changes and government filing remain separately **NOT AUTHORIZED**.

## #1031 name-parity caution — stop on real catalog drift

The current standalone `0124`, `0125`, and `0126` DDL uses unnamed inline `REFERENCES`
whereas Drizzle `getTableConfig(...).foreignKeys` generates names. PostgreSQL
normally auto-names inline references with `_fkey` and Drizzle uses `_fk`
containing the referenced table and column; this is a **source-review risk of
`MISSING` and `EXTRA` FK-name results**, not a measured PostgreSQL catalog
classification. PostgreSQL also truncates identifiers exceeding 63 bytes;
review whether #1031 correctly handles source-generated FK names longer than
that, without suppressing real mismatches. **Do not rewrite 0124/0126 or
normalize away failures solely from this observation.** Run the exact integrated
rehearsal, retain every resulting PASS/MISSING/DRIFT/EXTRA and propose a
separate reviewed forward-only correction if an actual defect is confirmed.
No green partial-manifest result substitutes for a full live source-to-catalog
diff.

## Catalog-only expected predicates for ten targets

Counts include PK indexes. `PASS` below means *counts and all exact names, definitions, FK actions, defaults, uniqueness and source signatures* match; merely satisfying these counts is necessary **but insufficient**. Do not query application rows for catalog triage.

| Relation | Columns | Valid FKs | Valid indexes incl PK | Named checks |
| --- | ---: | ---: | ---: | ---: |
| `attendance_exception_events` | 23 | 5 | 6 | 2 |
| `employee_availability_rules` | 14 | 3 | 3 | 0 |
| `open_shifts` | 14 | 6 | 4 | 0 |
| `open_shift_claims` | 14 | 5 | 4 | 0 |
| `compensation_bands` | 16 | 5 | 6 | 0 |
| `compensation_cycles` | 12 | 2 | 3 | 0 |
| `compensation_proposals` | 19 | 8 | 3 | 0 |
| `compensation_components` | 13 | 2 | 4 | 0 |
| `employee_compensation_components` | 20 | 6 | 4 | 0 |
| `compensation_events` | 17 | 7 | 3 | 0 |
| **Target total** | **162** | **49** | **40** | **2** |

Read-only starter query for independent operator review (not a substitute for #1031):

```sql
WITH expected(name, cols, fks, idx, checks) AS (
 VALUES
 ('attendance_exception_events',23,5,6,2),
 ('employee_availability_rules',14,3,3,0),
 ('open_shifts',14,6,4,0),
 ('open_shift_claims',14,5,4,0),
 ('compensation_bands',16,5,6,0),
 ('compensation_cycles',12,2,3,0),
 ('compensation_proposals',19,8,3,0),
 ('compensation_components',13,2,4,0),
 ('employee_compensation_components',20,6,4,0),
 ('compensation_events',17,7,3,0)
)
SELECT e.name,
  (c.oid IS NOT NULL AND c.relkind IN ('r','p')) AS table_present,
  (SELECT count(*)::int FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) = e.cols AS columns_match,
  (SELECT count(*)::int FROM pg_catalog.pg_constraint k
   WHERE k.conrelid=c.oid AND k.contype='f' AND k.convalidated) = e.fks AS fks_match,
  (SELECT count(*)::int FROM pg_catalog.pg_index i
   WHERE i.indrelid=c.oid AND i.indisvalid AND i.indisready) = e.idx AS indexes_match,
  (SELECT count(*)::int FROM pg_catalog.pg_constraint k
   WHERE k.conrelid=c.oid AND k.contype='c' AND k.convalidated) = e.checks AS checks_match
FROM expected e
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
ORDER BY e.name;
```

**Additionally:** Confirm named unique index and row-scope signature `staffing_requirement_role_unique` unchanged; legacy `staffing_requirement_unique` absent; 0124 fingerprint and SLA indexes; 0125 role and claim unique indexes; 0126 all named pay indexes/parent FKs and `compensation_events` absence in preflight. Compare ID sequence ownership and SQL defaults with full schema manifest. Reject any orphaned target sequence/index, invalid/not-ready index, `NOT VALID` new FK, or unexpected extra table/column/constraint. Existing unvalidated **0123 historical** constraints require a separate documented DBA risk decision — do not relabel them validated or silently repair them.

## Authenticated route acceptance (all NOT_RUN here)

- **Attendance GET:** `GET /api/workforce/attendance-exception-events?organizationId=<fictional-tenant-id>&startDate=2026-10-01&endDate=2026-10-16`. Use authorized owner/HR/Payroll and denied/nonmember/anonymous personas; require scoped successful data/empty-state (200 for authorized), unauthorized status per access policy (401 anonymous, 403 denied), no repeated 500, correct owner/SLA status and audit behavior; verify attendance UI and logs. Do not log response rows.
- **Employee WFM availability:** `GET /api/self/availability` for fictional employee A and B, cross-tenant/member and inappropriate manager personas. Feature flag **OFF** intentionally returns 404 before activation, **not** a schema PASS. After independent flag GO, expect employee 200, anonymous 401, wrong role 403, no spoofable `organizationId` or `employeeId` query strings (400), and external #691 overlap/overnight/remove/history/ESS acceptance with no automatic roster/payroll mutation.
- **HR compensation:** `GET /api/compensation?organizationId=<fictional-tenant-id>` through exact deployed-SHA **Live RBAC Sandbox Smoke**, including `scripts/live-compensation-scope-smoke.sh`. Company-wide HR 200 with legitimate fictional budget; unit HR 200 with `budgetPool:null` and no other-unit wages/bands/proposals; anonymous 401, cross-organization 403. The prior 503 is a failed acceptance, not a verified fix. Capture only HTTP status and sanitized predicates, never salary payloads, cookies or connection details.

## Engineering evidence disposition at packet preparation

| Check | Current status |
| --- | --- |
| Three issue bodies, existing PRs, current source docs & workflows reviewed | **SOURCE_REVIEWED** (not operational PASS) |
| 0115–0126 unique forward prefixes; static create/FK dependency shape & exact source hashes | **SOURCE_REVIEWED** |
| #1054 parent-PK / orphan / partial-index guard gap | **PG16.14 pre-fix repro reported by owner; UPDATED PATCH PROPOSED, UNMERGED** |
| Proposed regression syntax and patch structure | **STATIC_CHECKED** only |
| Real PG16 production-shaped 0115–0126 integrated apply/rollback | **NOT_RUN on this patch** |
| PG18 optional integrated/failure-path run | **NOT_RUN** |
| Actual #1031 manifest/catalog/diff on disposable PG16, per-table PASS/MISSING/DRIFT/EXTRA | **NOT_RUN**; no DB classifications asserted |
| Protected #1031 production diff, backups, journal reconciliation, auditor-role checks, PLAN/APPLY, live route smoke | **NOT_RUN / HUMAN-ONLY** |
| Source branches/PRs created/pushed/merged as a result of this packet | **NONE**; remote writes require explicit instruction |

### Non-negotiable STOP conditions

Wrong or unverifiable database connection/role/TLS/deployment SHA; unapproved #899 restore impact; no approved off-provider archive and witnessed restore; no authentic full-path historical receipts/cutover/forward journal; unexpected historic migration prefix or hash; attempted 0039/0042/0054 replay; permission overreach or role-separation failure; feature flag on prematurely; a partially present target or orphan object; mismatched PK/type/FK/index/default; unknown extra/DRIFT in #1031; 0121 historical employer ambiguity; mismatched source SHA, source-only test advertised as production proof, non-P0001 expected guard, failed/NOT_RUN PG rehearsal; any protected plan/apply or release approval absence; unauthorized tenant/HR reads, 500 response, or financial changes.

Only independent named human DBA/security/payroll/privacy/release owners may establish or certify actual restore, credential/role mapping, historical execution receipts, sign-offs, production migration dispatch/apply, protected full-schema audit, live access testing and feature activation. **The three issues remain open until real operator evidence and acceptance are recorded.**

## Documentation pin maintenance

The original `0125` main-source SHA-256 is
`3f51ca8ed1ea2cb8a04e071f567be1b5281425ab26677af4d5a539bdaeeee20b`.
The earlier **unmerged candidate rewrite** SHA-256 was
`ccb8b0332c9ecd7b301aa85e5962c7ce22f210b56ae6cedb092043d4b0007d87`;
**those candidate bytes are not the numbered `0125` in this stacked PR**.
The reviewed unchanged `0125` retains original SHA-256 `3f51ca8ed1ea2cb8a04e071f567be1b5281425ab26677af4d5a539bdaeeee20b`.
Do **not** amend or infer an applied migration receipt from either source. Recompute the checksum from the exact merged,
reviewed release commit and update all pinned plans/artifacts after independent
human approval. The change also adds an explicit #1054 runbook supplement.