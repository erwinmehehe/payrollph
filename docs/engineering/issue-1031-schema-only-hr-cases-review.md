# #1031 / P0-4 — HR cases schema-only review candidate (2 of 24)

**NO-GO / REVIEW ONLY:** This is not a numbered migration, execution receipt, production SQL or authorization to deploy. The only SQL under this branch lives in `docs/sql/issue-1031-schema-only-hr-cases-review.sql`; no application, `src/db/schema.ts`, existing `drizzle/`, package manifest, runtime DDL writer, guard or production workflow changes are permitted. Production may only advance through the full witnessed #1031 DBA procedure.

## Scope and source truth

The canonical definition is `src/db/schema.ts`, read through the existing `scripts/lib/issue-1031-schema-manifest.ts` TypeScript AST/Drizzle metadata. The merged #1097 `docs/engineering/issue-1031-source-table-crosswalk.csv` confirms **no numbered CREATE TABLE source** for either table. An earlier **read-only** 136-name catalog observation listed both among 137 absent source tables; this alone is not evidence of an applied/unapplied migration or of the live prerequisite constraint state.

| Creation order | Table | Reference prerequisites | Constraints / indexes |
|---|---|---|---|
| 1 | `employee_hr_cases` | Previously observed base `organizations`, `employees`, `users`, `documents` | 15 source columns; PK; unique (organization_id,id); 5 simple FKs; composite (organization_id,employee_id) employee-tenant FK ON DELETE CASCADE; composite (organization_id,employee_id,coe_document_id) COE-document-tenant FK NO ACTION; status CHECK; employee and SLA indexes |
| 2 | `employee_hr_case_messages` | Previously observed base `organizations`, `users`; newly created `employee_hr_cases` | 7 columns; PK; 3 simple FKs; composite (organization_id,case_id) same-tenant FK ON DELETE CASCADE; visibility CHECK; case index |

**Dependencies and fail-closed blockers:** Before attempting either CREATE, the candidate rejects missing base relations **or** a missing named composite tenant UNIQUE on employees(organization_id,id) (`employees_org_id_workflows_unique`) or documents(organization_id,employee_id,id) (`documents_org_employee_id_hr_cases_unique`). The runtime parser and PostgreSQL itself must verify the actual FK parent columns and actions. If any parent is absent/drifted, the exact candidate is **BLOCKED** and no SQL should be run in a real database. It also rejects if either target relation already exists. One explicit transaction, plain CREATE statements (never IF NOT EXISTS), no ALTER, DROP, DML, seed, backfill, receipt or account data.

This branch does **not** recreate unrelated missing-table prerequisites, does not touch the 113 numbered-source candidates, and does not attempt the separately blocked `hcm_document_expiry_notices` and `legal_entity_transfer_liability_evidence`. Those remain respectively dependent on `hcm_employee_document_compliance` and `entity_transfer_requests`, pending authenticated receipts and DBA decisions.

## Runtime compatibility

The existing #1097 source crosswalk has an empty `runtime_compatibility_create_sources` field for both HR tables; `docs/engineering/runtime-schema-writer-audit.md` does not list these targets. Static-source absence **does not establish** that indirect/dynamic runtime writers cannot collide. No compatibility DDL or auto-migration is changed or enabled.

## Isolated rehearsal only

- `tests/issue-1031-schema-only-hr-cases.test.mjs` enforces exact two-table, single-transaction, guard-before-CREATE, tenant FK and additive-only source boundaries without a database.
- The GitHub-only PG16 **and PG18** test workflow first bootstraps the full **pinned stable** schema on a fresh disposable `127.0.0.1:5432/app_db`. It drops **only these two tables** in reverse order. It proves named FK/index/default/check/unique/catalog equality against the pristine `pg_attribute`/`pg_constraint`/`pg_indexes` source baseline; deliberately corrupts `subject varchar(160)` to detect drift; exercises missing-base, missing-tenant-parent-unique, partial-existence and repeat-application rejects. It tests synthetic within-org COE acceptance, cross-org document denial by the named composite FK, and cross-org message denial by the named case-tenant FK; **all fictitious rows ROLLBACK**.
- Separate PG16/PG18 RC-only jobs run two full-schema pushes on **different fresh disposable databases** with matched `drizzle-kit@1.0.0-rc.4`/`drizzle-orm@1.0.0-rc.4`. The strict wrapper must affirm a real second No changes detected. This is **not** a pinned stable second push or a post-candidate no-op claim.
- `npm test` runs the unchanged pinned application toolchain in its own disposable PG16 service, with ephemeral fictitious-only encryption keys. No Neon branch or production environment is connected.

The persistent pinned Drizzle `0.31.11` repeat-push failure on the unrelated `documents_org_employee_id_hr_cases_unique` / `employee_hr_cases_coe_document_tenant_fk` dependency is tracked independently as [#1019](https://github.com/erwinmehehe/payrollph/issues/1019). [Merged #1077](https://github.com/erwinmehehe/payrollph/pull/1077) made that false-green fail closed; the application toolchain is **not fixed** and must never be promoted on the strength of an RC-only CI no-op.

**DBA handoff / NO-GO:** Verify exact roles/branch/target privately; independently attest historical migration receipts for all 113 numbered-source gaps; witness privacy-approved encrypted backup/restore; rehearse on a separately authorized isolated clone with zero unexplained schema/constraint/index drift; obtain independent DBA/security approval; use the protected forward-only pipeline; then verify authenticated endpoints, same-tenant allowed paths and cross-tenant/role forbidden paths. None of this is authorized by this PR.
