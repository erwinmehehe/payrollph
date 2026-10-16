# #1031 / P0-4 — review-only schema-gap proposal, IT assets (4 of 24)

**NO-GO. Source-only candidate, not a production migration, not a receipt and not an approved deployment.** This branch has no app changes, no numbered `drizzle/` changes, no historical receipt edits and no Neon operations. The protected DBA procedure in `docs/engineering/issue-1031-schema-drift-remediation.md` controls every release decision.

## Source and exact scope

Based on `src/db/schema.ts` as materialized by `scripts/lib/issue-1031-schema-manifest.ts` (TypeScript AST + Drizzle `getTableConfig`). `docs/engineering/issue-1031-source-table-crosswalk.csv` records each of the four targets as having **no numbered CREATE TABLE migration**. The separately observed catalog list reports all 24 names absent; catalog presence/absence is **not** proof of any migration execution.

This PR contains only `docs/sql/issue-1031-schema-only-it-assets-review.sql`: `it_applications`, `it_managed_devices`, `it_access_grants`, `it_device_events`. Create prerequisite bases and all foreign-key target tables **only through independently approved plans**. The candidate itself creates exactly four tables, their final Drizzle columns/defaults, 13 named FKs, 4 PKs, 6 indexes and 2 named checks. No rows, backfills, existing-table ALTER, flags or DML.

## All 24: FK prerequisites and disposition

`P` = one of the **136 observed catalog names** (not a release attestation); `S` = among these 24; `M` = among the other **113 missing tables with numbered SQL**. Names reflect FK targets, including composite FK dependencies, and can occur in multiple FKs. No `M` target is manufactured here.

| Schema-only table | Referenced base P tables | S (within 24) | M (missing with numbered source) | Status |
|---|---|---|---|---|
| applicant_privacy_evidence | organizations, job_applicants, users | — | — | deferred: other |
| email_change_tokens | users | — | — | deferred: other |
| employee_entity_bank_accounts | organizations, employees, legal_entities, users | — | — | deferred: legal entity |
| employee_hr_case_messages | organizations, users | employee_hr_cases | — | deferred: HR cases |
| employee_hr_cases | organizations, employees, users, documents | — | — | deferred: HR cases |
| engagement_survey_participants | organizations, employees | engagement_surveys | — | deferred: other |
| engagement_surveys | organizations, users | — | — | deferred: other |
| expense_category_policies | organizations, users | — | — | deferred: expenses |
| expense_claim_evidence | expense_claims, organizations, employees, users | expense_category_policies | — | deferred: expenses |
| expense_report_items | organizations, expense_claims | expense_reports | — | deferred: expenses |
| expense_reports | organizations, employees, users | — | — | deferred: expenses |
| hcm_document_expiry_notices | organizations, employees, documents, users | — | **hcm_employee_document_compliance** | **BLOCKED: numbered-source receipt decision** |
| it_access_grants | organizations, employees, users | it_applications | — | **THIS PR** |
| it_applications | organizations | — | — | **THIS PR** |
| it_device_events | organizations, employees, users | it_managed_devices | — | **THIS PR** |
| it_managed_devices | organizations, assets, employees | — | — | **THIS PR** |
| legal_entity_profile_change_requests | organizations, legal_entities, users | — | — | deferred: legal entity |
| legal_entity_statutory_registrations | organizations, legal_entities, users | legal_entity_profile_change_requests | — | deferred: legal entity |
| legal_entity_transfer_liability_evidence | organizations, employees, legal_entities, users | — | **entity_transfer_requests** | **BLOCKED: numbered-source receipt decision** |
| offline_punch_claims | organizations, employees, users | — | — | deferred: other |
| saved_report_definitions | organizations, users | — | — | deferred: other |
| separation_clearance_waivers | organizations, separation_records, employees, users | — | — | deferred: other |
| spend_card_transactions | organizations, users | spend_cards | — | deferred: expenses |
| spend_cards | organizations, employees | — | — | deferred: expenses |

**Candidate topological order across the 22 unblocked names (not one release train):**

1. First tier: `email_change_tokens`, `applicant_privacy_evidence`, `employee_entity_bank_accounts`, `employee_hr_cases`, `engagement_surveys`, `expense_category_policies`, `expense_reports`, `it_applications`, `it_managed_devices`, `legal_entity_profile_change_requests`, `offline_punch_claims`, `saved_report_definitions`, `separation_clearance_waivers`, `spend_cards`.
2. Dependent tier: `employee_hr_case_messages`, `engagement_survey_participants`, `expense_claim_evidence`, `expense_report_items`, `it_access_grants`, `it_device_events`, `legal_entity_statutory_registrations`, `spend_card_transactions`.
3. **BLOCKED, no SQL here:** `hcm_document_expiry_notices` on `hcm_employee_document_compliance`; `legal_entity_transfer_liability_evidence` on `entity_transfer_requests`. Neither the existence of a historical numbered migration nor a present catalog table authorizes replay.

**This PR's exact execution order** is `it_applications`, `it_managed_devices`, `it_access_grants`, `it_device_events`. Guard checks `organizations`, `users`, `employees`, `assets` and rejects ANY already present IT target before CREATE. One explicit BEGIN/COMMIT; plain CREATE (not IF NOT EXISTS) ensures a race fails, never silently succeeds.

## Runtime compatibility DDL overlap

The `#1097` source-side crosswalk's `runtime_compatibility_create_sources` field is empty for all four IT tables, and no static CREATE TABLE overlap was identified for these 24. This is **limited source-scanner evidence, not proof** that a dynamic/indirect writer or compatibility column alteration does not exist. Recheck `docs/engineering/runtime-schema-writer-audit.md` and the full AST writer audit at DBA review; do not activate or modify auto-migrations. No runtime or application code changes in this PR.

## Disposable tests (NOT production application)

- Source-only `tests/issue-1031-schema-only-it-assets.test.mjs`: four exact targets, four base prerequisites, fail-closed presence guard, additive-only SQL, exact one transaction, no DML / ALTER / DROP / receipt claims.
- Isolated CI-only PG16 **and PG18**: guarded `npm run db:push` installs full current schema; test verifies source manifest references and absence of outside FKs; drops **only the four IT tables** in reverse order; applies exact SQL with a deliberately changed `mdm_provider` varchar type and proves the catalog/AST comparison flags drift; drops the four again; applies the original SQL and compares direct `pg_attribute`, `pg_constraint`, `pg_indexes` etc. to the pre-drop full schema; proves partial-target and second-application rejection. A second guarded full `db:push` must report **No changes detected**.
- Rehearsal uses only GitHub Actions ephemeral localhost PostgreSQL at `127.0.0.1:5432/app_db`, `CI=true`, `GITHUB_ACTIONS=true`, and explicit `ISSUE_1031_IT_REHEARSAL=isolated-ci-only`. It never dispatches or edits a production environment workflow.

**Independently accounted whole-schema blocker (NOT FIXED):** [PayrollPH #1019](https://github.com/erwinmehehe/payrollph/issues/1019) independently reproduced the exact `drizzle-kit@0.31.11` **second-push** failure on a pristine disposable PG18 *before this candidate existed*: Drizzle proposes `ALTER TABLE "documents" DROP CONSTRAINT "documents_org_employee_id_hr_cases_unique"`, and PostgreSQL correctly rejects SQLSTATE `2BP01` because `employee_hr_cases_coe_document_tenant_fk` depends on that unique key. The current `schema.ts` declares **both** the parent key and child FK; the four IT tables reference neither. [Merged #1077](https://github.com/erwinmehehe/payrollph/pull/1077) corrected the false-green exit with `scripts/strict-db-push.mjs` (do not weaken this guard), but **did not fix stable introspection**. Its isolated PG18 comparison with matched `drizzle-kit@1.0.0-rc.4` and `drizzle-orm@1.0.0-rc.4` proved an explicit no-op and unchanged 278-table fingerprint, yet the RC is **not** approved for the normal application. Upstream [drizzle-orm #4789](https://github.com/drizzle-team/drizzle-orm/issues/4789) documents composite-unique phantom diffs. Do **not** reorder security keys, drop a referenced key, or adopt an RC to make this PR green.

**Evidence split:** The four IT-table catalog equality, wrong-type detection and retry-denial are candidate-scoped proof; the subsequent **stable full-schema push remains a separately known red gate**. The independent baseline-only PG16 job runs two pushes **without this candidate**, to reproduce the exact defect again at current head. Preserve its actual outcome, never treat a rejected DDL or catalog that happened to remain unchanged as a successful Drizzle no-op. A literal `npm test` runs on its own disposable PG16 service. **Zero whole-schema drift is NOT verified**. Follow-up stable-toolchain remediation for #1019 must be scoped separately with no tenant security change; this IT PR remains draft and NO-GO.

**Production remains NO-GO** after any green checks. DBA must separately witness an encrypted sanitized backup/restore and isolated-clone rehearsal, independently reconcile real receipts and 113 migration decisions, approve dependency order and exact source/checksums, sign off with security, use the protected manually reviewed forward-only pipeline, and verify post-change authenticated routes and role/tenant denials. This document authorizes **nothing** on Neon or any real database.
