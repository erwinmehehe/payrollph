# P0-4 release-readiness and DBA/operator handoff — 2026-10-17

> **Release decision: NO-GO for production schema repair, real-employer payroll or payment activation.** This is a point-in-time **read-only evidence report**, not a backup receipt, DBA approval, production migration authorization, or independent security sign-off. Do not run production SQL from this document.

## Scope and provenance

- **Reviewed code:** protected GitHub `main` at `0692c0081fec628a15e768c23c52b7de18438e98`; migration-control fail-closed guard from [merged PR #1161](https://github.com/erwinmehehe/payrollph/pull/1161). All 14 applicable PR workflows passed on the reviewed head, including required CI, PG16, WFM PG16/18 and CodeQL.
- **Automatic web build:** Vercel project `erwinmehehe-payrollph`, production deployment `dpl_WJz2mr5jeS3SqJzRy5yRf57UTYpG` reported **READY** for that merge SHA, with `payrollsoftware.ph` among its aliases. [Vercel inspector](https://vercel.com/payrollph/erwinmehehe-payrollph/WJz2mr5jeS3SqJzRy5yRf57UTYpG). A READY deployment is not proof of runtime DB-secret identity, worker/scheduler role isolation, or successful payroll execution.
- **Read-only SQL target:** Neon project `calm-wave-70219564`, default branch `br-lucky-sound-b79i56jw`, database `neondb`, endpoint identity `ep-cool-hat-b7e7gpoo`; in-session project/branch/endpoint GUCs agree. PostgreSQL **18.6**. Metadata only: `pg_catalog`, privileges, and `to_regclass`-style existence. **No employee, payroll, bank, or audit rows were selected** and no DML/DDL was executed.
- **Existing change evidence:** master [#744](https://github.com/erwinmehehe/payrollph/issues/744), real offsite recovery [#907](https://github.com/erwinmehehe/payrollph/issues/907), audit-role separation [#908](https://github.com/erwinmehehe/payrollph/issues/908), snapshot-routing incident [#899](https://github.com/erwinmehehe/payrollph/issues/899).
- **Evidence quality:** live catalog and deployment are independently observed metadata **at this time**, not historical execution provenance. Values must be re-collected and signed before a future change window.

## Gate matrix — observed vs. required

| Gate | Evidence now | Disposition and next evidence required |
| --- | --- | --- |
| 0. Code correctness | #1161 merged; 14/14 applicable pre-merge workflows green | **SOURCE PASS ONLY.** Do not infer SQL applied. |
| 1. Correct Neon catalog target | `neondb`, pinned Neon project, branch and endpoint identity agree | **CATALOG TARGET PASS.** Actual **Vercel app, worker, scheduler and audit-sealer connection endpoints and roles UNVERIFIED**; privately compare connection identity without exposing any URLs/passwords. |
| 2. Independently retained production archive | **No authorized external encrypted archive or independently witnessed restore is evidenced.** Existing Neon snapshot is same-provider and temporary. | **BLOCKED — #907.** Requires approved classification, encryption recipient/key escrow, independently retained media, actual backup receipt and successful detached restore. |
| 3. No-cost constraints | Owner's [2026-10-14 decision](https://github.com/erwinmehehe/payrollph/issues/907#issuecomment-6167103361): **no AWS account / no budget for recurring AWS charges**. AWS S3/OIDC workflows exist but are dormant. | **BLOCKED FOR AWS.** Do not deploy paid services, dispatch AWS workflows or assume a budget override. An approved existing offline encrypted-media route could be designed and witnessed separately. |
| 4. Dedicated restricted backup reader | Five non-system login roles observed. **None** is both capable of reading 136 public tables and restricted from DML, DDL, role management and RLS bypass. | **FAIL.** DBA to propose narrowly scoped reader, prove constraints and document approval; **do not use** `neondb_owner` or an application owner credential for a dump. |
| 5. Audit-chain enforcement | `public.audit_events` exists; expected `audit_events_protect`, `seal_audit_events` functions and enabled `audit_events_protect_mutation` trigger **absent**. | **FAIL — #908.** Historical `0109` must not be blindly replayed. Review add-only forward fix with restricted-role negative tests and independent security evidence. |
| 6. Migration control plane | `payrollph_release_migration_receipts`, `payrollph_migration_cutover`, `payrollph_schema_migrations` all absent. | **BLOCKED.** Authenticate SQL path+SHA history and approve ledger installation/cutover, no invented `applied` receipts. |
| 7. Application schema readiness | `src/db/schema.ts`: 271 distinct declared `pgTable` names; 133 names present, **138 absent** in live `public`; 136 regular live tables overall. | **BLOCKED — #1015 / #1061 / #1113.** Diagnose exact tables and dependencies, stage reviewed ordered additive repairs with rollback. Do not treat name-count differences as blanket CREATE or deletion instructions. |
| 8. Branch recoverability and incident | Default production branch currently reports `protected=false`. Neon lists **8 branches** and **one** manual snapshot `snap-red-sound-b798wnli`, expiry **2026-10-22 07:30 UTC**. Prior snapshot routing #899 unresolved. | **BLOCKED.** Preserve the existing snapshot. Need a detached, tested copy and documented endpoint-routing incident follow-up. A provider snapshot is not an immutable independent backup. |
| 9. Real payroll pilot | No current verified real-employer centavo reconciliation, protected migration cutover, or money-release signoffs evidenced here. | **NO-GO.** Keep payment/provider/scheduler activation blocked until separately accepted. |

**Three additional live tables** — `ess_employee_photos`, `ess_identifier_requests`, `ess_other_identifiers` — are not declared by the *primary* schema module. They may originate from other modules: **not unexpected-data cleanup candidates**.

## Read-only privilege evidence (database metadata)

The count columns are permissions across **136 existing regular `public` tables**; they do **not** prove which credential Vercel uses. No employee/payroll rows were read.

| Login role | SELECT tables | INSERT / UPDATE / DELETE tables | Other material role privileges | Safe as P0-4 backup reader? |
| --- | ---: | --- | --- | --- |
| `cloud_admin` | 136 | 136 / 136 / 136 | Superuser, RLS bypass, create roles/databases | **No** |
| `neon_service` | 136 | 136 / 136 / 136 | RLS bypass, create roles/databases, replication | **No** |
| `neondb_owner` | 136 | 136 / 136 / 136 | RLS bypass, create roles/databases, replication; queried as this role | **No** |
| `payrollph_schema_auditor` | 136 | 136 / 136 / 136 | RLS bypass, create roles/databases, replication. The *auditor* name does not confer least privilege | **No** |
| `neon_auth` | 0 | 0 / 0 / 0 | No elevated role flags, but cannot back up app tables | **No** |

**Security decision:** Before any production backup or audit-chain acceptance, classify the *actual* deployed application/worker/scheduler/auditor roles privately and test ownership, role inheritance, elevated privileges, mutation of audit tables, and caller-settable maintenance hints in a **disposable production-equivalent database**. Role changes on production require reviewed DBA authorization. Table grants alone are not a full security model; owner/DDL or inherited elevation can bypass controls.

## Ordered human-controlled acceptance — no AWS spend assumed

| Sequence | Responsible authority | Exact completion artifact | Current state |
| --- | --- | --- | --- |
| A. Choose and approve source-data treatment | Owner + privacy/security authority | Signed data classification (fictional vs sensitive real records), export permission, destination media/location, retention, threat model, physical custody and cost cap; never paste connection strings | **NOT EVIDENCED** |
| B. Decide backup destination under zero recurring AWS budget | Owner/operator | Approved **existing independently held encrypted media** or other actually available approved destination; two separated recovery copies/escrow design and retention/cadence. If not available, stop | **NOT EVIDENCED** |
| C. Create and test read-only backup principal | DBA/security | Controlled reviewed role/grant plan and negative evidence: all needed table/sequence read capability, no UPDATE/INSERT/DELETE/TRUNCATE/CREATE/ALTER/role management/RLS bypass; suitable SSL, endpoint/branch identity; separate from runtime roles | **FAIL IN LIVE CATALOG** |
| D. Confirm runtime DB target privately | Vercel/runtime owner + DBA | Internal-only attestation that deployed production API, workers, scheduler and audit-sealer use the intended original Neon endpoint/branch, plus **actual role identity**, with no credentials in public logs | **UNVERIFIED** |
| E. Authorize a real production encrypted export | Data owner + DBA/security | Exact-source-reviewed runbook and trust-bounded executor; PG18 direct TLS verify-full connection, no plaintext archive at rest, age public encryption recipient, offline private-key custody, independent encrypted destination, complete scope including sequences. The existing local helper is **fictional-only** | **NOT AUTHORIZED** |
| F. Recover from a detached copy | Independent/authorized recovery witness (solo internal evidence must be labeled as such) | Immutable ciphertext object/media ID; independently retained digest, version/time, retention; restored copy on networkless fresh PG18, schema/constraints/sequence/data hash parity, measured elapsed restore, operational RPO/RTO assessment, gaps | **NOT EVIDENCED** |
| G. Adopt authentic migration history and ledger | DBA + release owner | Historical migration `path + SHA-256 + actual execution evidence`, conflict/duplicate-prefix disposition, reviewed ledger DDL and privileges, candidate PLAN output, explicit cutover approval | **BLOCKED** |
| H. Rehearse then authorize additive fixes | DBA + payroll/security reviewers | Selected contiguous migration SQL, clone rehearsal, negative tenant/RBAC/security tests, rollback, reconciled before/after catalog, change ticket and separate live cutover authorization | **BLOCKED** |
| I. Verify real-employer pilot separately | Payroll/business owner + release owner | Payroll exact centavo reconciliation, payroll/security/UAT accepted evidence, provider/agency settings, incident closure and financial release decision | **NO-GO** |

### Immediate owner action

1. Confirm whether production contains **only fictional data** and whether any trusted *existing separate offline storage media* and restore-capable PostgreSQL 18 machine are available. Do not upload archives, records, private age identities or DB URLs into GitHub/chat.
2. **If fictional local DEV only:** existing [zero-cost local-dev helper](p0-4-zero-cost-local-dev-recovery.md) may be run *on the operator's trusted local machine* against explicitly fictional local data, then a copied archive restored offline. Mark evidence `SOLO_DEV_RESTORE_SMOKE` **only**, not production-certified. The CI synthetic recovery test is already source-pass but not a physical local copy/restore.
3. **If actual Neon main real/sensitive data:** stop until steps A-D are documented. A distinct operator-approved production export plan is required; the fictional-data helper must not be repurposed or its guards bypassed. Never substitute an expiring provider snapshot for independently retained restore evidence.
4. Keep dormant manual workflows [protected backup](../../.github/workflows/protected-neon-offsite-backup.yml) and [protected restore](../../.github/workflows/protected-neon-offsite-restore.yml) unused under the documented **no-AWS** cost decision. Reopening AWS requires *new* express cost/storage/privacy approval.
5. Record sanitized ticket, approvals, backup digest/media custody (not keys), detached restore proof and current `main` SHA in #907/#744. Record audit-role remediation in #908. Do not mark a checkbox complete without an externally verifiable artifact.

## Minimal safe recertification queries (DBA only, read-only)

Use the **explicitly pinned** database connection, no app secrets in terminal logs or issue comments. These statements query only catalog/connection metadata; a role-specific negative test **must run on a disposable clone**.

```sql
SELECT current_database() AS db, current_user AS connected_role,
  current_setting('neon.project_id', true) AS neon_project,
  current_setting('neon.branch_id', true) AS neon_branch,
  current_setting('neon.endpoint_id', true) AS neon_endpoint,
  current_setting('server_version') AS pg_version;

SELECT pg_catalog.to_regclass('public.audit_events') IS NOT NULL AS audit_events_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='audit_events_protect') AS protect_fn_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='seal_audit_events') AS seal_fn_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='audit_events'
            AND t.tgname='audit_events_protect_mutation'
            AND t.tgenabled <> 'D' AND NOT t.tgisinternal) AS protect_trigger_enabled;

SELECT name, pg_catalog.to_regclass('public.' || name) IS NOT NULL AS exists
FROM unnest(ARRAY[
  'payrollph_release_migration_receipts','payrollph_migration_cutover',
  'payrollph_schema_migrations','attendance_exception_events',
  'compensation_bands','compensation_cycles','compensation_proposals',
  'compensation_components','employee_compensation_components',
  'compensation_events'
]) t(name);
```

The existence queries are not an audit of definitions, constraints, ownership, PII access or migration execution: keep fail-closed control-ledger contract checking from #1161, historical evidence and DBA authorization separate.

### Prohibited shortcuts

- Never run `db:push`, guessed legacy SQL, duplicated numbered migrations or fabricated historical receipts on production.
- Never grant a restricted backup reader write/owner/DDL privileges merely to make `pg_dump` pass.
- Never use the `payrollph_schema_auditor` role as a safe backup role, assume a role name proves least privilege, or accept synthetic PG CI as real production backup.
- Never invoke `restore_snapshot` without explicit nonpromoting controls and verified endpoint IDs after #899; **do not** reassign default branch/endpoints while rehearsing.
- Never dispatch AWS workflows against an unapproved destination, enable money movements or grant a silent operational release waiver.

**Disposition:** source fix/deployment READY; production recovery, audit enforcement, migration ledger and schema remain **P0-4 NO-GO**. Completion requires actual owner/operator evidence, not another automated source-only PR.
