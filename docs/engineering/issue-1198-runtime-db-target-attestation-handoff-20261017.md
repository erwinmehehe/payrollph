# Issue #1198 — protected runtime database target attestation handoff

**SOURCE-ONLY / READ-ONLY / PRODUCTION NO-GO.** This package does not create users or roles, execute SQL, change Vercel configuration, apply migrations, restore branches or read business records.

## Current evidence, October 17, 2026

- Vercel project: erwinmehehe-payrollph in team payrollph, linked to GitHub erwinmehehe/payrollph. A READY production deployment exists for PR #1189's merge 3d9cac95b5c58fa611a1b4b36fa4815d6ff36919, with a newer READY production deployment 7c7d38b773ac949f4abae2b3f969e35e01cf050e.
- Independently inspected Neon project calm-wave-70219564, primary/default branch br-lucky-sound-b79i56jw, endpoint ep-cool-hat-b7e7gpoo, database neondb, PostgreSQL 18.6. **A Vercel READY deployment does not prove which database session the app uses.**
- Current schema.ts declares 271 distinct pgTable application tables. Inspected live public schema has 154 tables: 124 declared tables are missing and seven extra live-only tables exist. All 23 PR #1189 table candidates are absent. Neither a blanket CREATE nor dropping extra tables is authorized.
- Repository history contains 145 numbered SQL files, 131 contiguous numeric prefixes through 0131 and 13 historical duplicate-prefix groups. File presence proves *source provenance*, not execution or an applied migration receipt.
- The inspected primary has no payrollph_release_migration_receipts, payrollph_migration_cutover, payrollph_schema_migrations or Drizzle journal. Migration path/hash history is **UNPROVEN**.
- Existing payrollph_schema_auditor inherits neon_superuser, app table write/SELECT and database CREATE privileges; it is **unsafe** as independent auditor. The separate payrollph_catalog_audit_1031 role cannot authenticate. No verified least-privileged production login exists for controlled receipt audit.

## Safe identity attestation

The accompanying manual-only GitHub workflow, **Production Runtime DB Target Attestation (Read Only)**, is permitted to run on exact reviewed GitHub main only, through the protected production environment. It calls the app's already-present authenticated readiness endpoint exactly once with the separately managed production readiness token. It does not have a PostgreSQL connection string.

Before dispatch, an authorized operator must independently inspect the production database service and pin these **nonsecret** GitHub production environment variables:
- PRODUCTION_NEON_PROJECT_ID
- PRODUCTION_NEON_BRANCH_ID
- PRODUCTION_NEON_ENDPOINT_ID
- PRODUCTION_RUNTIME_DB_ROLE

The deployment role must be read from approved runtime configuration; do not guess or infer it from the Neon default owner. Reuse the preexisting protected GitHub secret PRODUCTION_READINESS_TOKEN only if its exact deployment counterpart is authorized. No secret should be copied to issues, PR comments, artifacts, local files or chat.

Dispatch inputs: reviewed_sha (the exact main commit SHA that is also deployed) and expected_database_name (DBA-reviewed neondb). The workflow verifies that reviewed_sha equals GitHub's executing main SHA and that the private response matches the expected production commit, Neon project, branch, endpoint, database, role, non-replica state and immutable schema evidence contract. It fails closed on absent/invalid token, unexpected redirect, wrong target, schema evidence inconsistency or mismatched deployed code.

The job prints only sanitized success booleans and fixed catalog-presence counts; it never prints the token, response, database hostname, role or a customer row. Even when successful, it explicitly reports **no production migration approved and no historical receipt proven**.

**Not yet performed:** No private production token was available to this source-authoring session, and the runtime identity probe was not invoked. A successful, independently witnessed protected workflow run is required before changing Issue #1198's runtime target status.

## Release blockers unaffected by this PR

1. Independently recover genuine historical numbered-source receipts with full file paths, SHA-256, DB target, DBA/operator actor and approved applied timestamps; record unavailable evidence as UNPROVEN, and resolve 13 duplicate prefix groups. Never backfill fabricated executed/applied entries.
2. Independently reconcile restore incident #899 and establish an authorized encrypted off-provider backup and witnessed, privacy-eligible isolated restore; do not delete Neon branches, swap defaults, restore snapshots or increase paid capacity without review.
3. Restore a truly limited catalog reader under its own operator-approved security change only after authentic migration control tables exist; see the existing p0-4-catalog-auditor-bootstrap-template.sql which deliberately fails closed today. Do not weaken the gate or reuse privileged owner/legacy auditor roles.
4. Propose the smallest ordered, forward-only final-state repair set, with exact checksums, parent constraints and tenant/financial negative tests in isolated PG16/18 and an explicitly approved protected environment. Do not replay historical DML or infer employer ownership.
5. Production SQL application requires independent DBA, security, release and payroll controls through the existing protected runner; this source-only identity workflow is not a PLAN or APPLY approval.

**Release decision remains NO-GO.** See Issue #1198 and the merged review-only source PR #1189.
