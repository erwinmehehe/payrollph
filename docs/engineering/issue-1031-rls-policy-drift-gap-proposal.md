# Proposed small PR — #1031: Surface unmodeled RLS/policy drift (source-only design)

**Status: REVIEW-ONLY PROPOSAL / NOT IMPLEMENTED / NOT EXECUTED.**

**Evidence tag:** `CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL`.

## Concrete gap found from exact existing source

`scripts/check-issue-1031-full-schema-diff.ts` has `fullSchemaCatalogSql` that inventories seven kinds of schema objects: tables, columns, foreign keys, CHECK constraints, primary keys, unique constraints and nonconstraint indexes. `scripts/lib/issue-1031-schema-manifest.ts` supplies those kinds from `src/db/schema.ts`. `src/lib/issue-1031-full-schema-diff.ts` considers `PASS` only for the object kinds that were requested.

**Neither side collects nor compares** PostgreSQL `pg_class.relrowsecurity` / `relforcerowsecurity` or `pg_policy` definitions. A clean existing table/column/FK/index diff can therefore coexist with absent, added or changed row-level security configuration. This is a **coverage omission**, not proof that any particular PayrollPH table should have RLS enabled, nor evidence of a live breach. The present comparator also does not certify standalone triggers/functions or sequence ownership; those deserve **separate** bounded follow-ups, not a combined change that disguises unmodeled objects as `PASS`.

## Small, proposed source-only implementation for a FUTURE separately approved PR

1. Add a **pure**, testable `pg_catalog` RLS/policy metadata mapper with explicit, bounded fields: table identity; `relrowsecurity` / `relforcerowsecurity`; policy name, command, permissive/restrictive flag, roles, USING/`WITH CHECK` SQL; identity/definition normalization must be conservative and distinguish unknown expressions. No app rows or policy evaluation.
2. Record all `public` base/partitioned tables in catalog-only inventory. Extend the *evidence coverage report* with `rlsCoverage: "UNMODELED_REQUIRES_DBA_EXPECTATION"` unless an independently DBA-approved expected policy manifest exists. Do **not** silently infer that `RLS OFF` is expected because `schema.ts` does not declare a policy. Never assert full security parity from absent expected sources.
3. Compare to any future **reviewed exact-source** policy manifest only after an explicit DBA/security decision. Unexpected enable/force state, missing/excess policy, changed role, command, or expression must be flagged as `DRIFT`/`UNKNOWN`, not normalized away. Preserve every `CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL` tag.
4. Add **pure fixture-only** tests covering RLS enabled→disabled, FORCE toggles, changed `USING`, `WITH CHECK`, policy command or role, unknown/truncated metadata and same named table in unrelated schemas. Tests must not connect to any database or apply DDL. Preserve all existing full-schema checks and no mutation path.

## PR scope and suggested acceptance

**Suggested PR title:** `audit(#1031): report unmodeled RLS-policy coverage separately from schema PASS`.

**Allowed changed files for that later PR:** one small catalog metadata module, a focused pure fixture test, and the protected full-schema-diff output/report integration **only if its review proves no prod-only data/secret read and no migration executor dependency**. No numbered `drizzle/` edits, no runtime schema writers, no role/journal changes, no new workflow dispatch, no application release flags, and no production queries.

**Acceptance:** Source-only unit fixtures PASS; no DDL or database connection; a baseline `PASS` for existing compared schema objects does not imply RLS verification; unknown policy expectations stay visibly **UNMODELED**, never Green; labels and exact SHA retained; human DBA/security reviewer named before any future protected catalog run.

**Safety:** This proposal is documentation. It does **not** claim RLS is already enabled/disabled on any deployed table, authorize a row-policy change, establish tenant security, certify receipt history or complete `docs/engineering/issue-1031-schema-drift-remediation.md` steps 1–7. A later PR would trigger GitHub Actions that may run disposable PostgreSQL DDL; **do not open or run that PR while the instruction is "no DDL anywhere."**
