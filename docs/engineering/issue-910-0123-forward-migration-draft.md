# Issue #910 — proposed canonical 0123 additive repair (DRAFT)

**Source:** `drizzle/0123_multi_entity_forward_schema_repair.sql`
**State:** SOURCE-ONLY DRAFT / UNAPPLIED. This file is not an approved release migration, not production execution evidence, and not a substitute for historical 0121 accounting. **Never run it against Neon or a real employer as part of this engineering task.**

## Number reservation

The current `main` tree already includes `drizzle/0122_tenant_module_disclosure.sql`. The repository's `scripts/check-sql-migration-history.mjs` requires strictly consecutive new prefixes, does not allow editing historical files, and checks against the **current base branch**. Therefore this proposal uses the next `0123` slot only on its own **draft PR**. Recheck that reservation before merging; if main acquires another `0123`, this draft must be renumbered on a new candidate, not used to rewrite migration history.

## Exact source derivation

`0123` is a frozen, complete inline SQL file, not a psql `\\i` include or a dynamic import. It combines only the three previously reviewed schema-only stages in this order:

1. `docs/sql/issue-910-review-only-forward-predecessor.sql`: reviewed missing 0022/0050/0051/0052/0110/0112–0114 predecessor **DDL only**; intentionally excludes 0050/0051 historical employee/department data updates.
2. `docs/sql/issue-910-review-only-0121-schema.sql`: the 0121 additive table/column/index **DDL only**; excludes bootstrap PRIMARY rows, linked payroll attribution, historical employment interval insertion and initial employer grants.
3. `docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql`: additive composite tenant/employer FK safeguards (13 named tenant, employer and membership constraints).

Each stage has its original exact-source SHA-256 marker. `tests/issue-910-numbered-migration.test.mjs` reconstructs the exact stage bodies, hashes the raw file bytes, and refuses deviations. The generated candidate's own SHA-256 is a **source checksum**, never a production applied receipt.

The leading `DO $issue910_preflight$` block checks that canonical 0115–0120 dependencies (particularly `payout_batches`/`payout_transfers`) and original tenant payroll objects exist before any DDL starts, and that `user_organizations(organization_id, user_id)` contains no duplicate membership keys. A missing prerequisite or unsafe duplicate fails closed before schema construction. No `INSERT`, `UPDATE`, `DELETE`, `EXECUTE`, explicit `BEGIN` or `COMMIT` occurs in the numbered SQL. The reviewed migration runner—not this file—owns the atomic transaction boundary if the source is ever approved for release.

## Isolated testing only

`.github/workflows/issue-910-0123-numbered-rehearsal.yml` provides:

- Exact-byte static source assertions plus 14-day source-only checksum artifact; no database, provider calls or production credentials.
- PostgreSQL **16 and 18** disposable localhost service containers; `npm ci`, `npm run db:push` guarded to `127.0.0.1/app_db`, and `tests/issue-910-numbered-migration-postgres.test.mjs`. The integration test executes **this exact numbered SQL**, not an unnumbered generator.
- Mandatory isolated CI/environment assertions and one encompassing transaction with final `ROLLBACK` and before/after catalog + employee/run/payroll centavo comparisons.
- Negative tests for absent canonical prerequisites, duplicate tenant-user membership, cross-tenant legal entity/employee grants and assignments, cross-tenant payroll-run employer changes, same-tenant attempted change of a payroll run already linked to a payroll entry, and retry after installing the schema.
- Explicit checks that the schema does not synthesize employment history, employer grants or retroactive payroll-entry employer attribution; future payroll/filing decisions must not infer historical employer from an employee's *current* legal entity.

**Do not mark this draft's PostgreSQL 16/18 tests PASS until the exact-head workflow finishes green.** The earlier green #958 test of the equivalent unnumbered builder cannot substitute for exact-file execution of `0123`.

## Dependencies intentionally not silently resolved

On the original live Neon main (previous read-only checkpoint), `worker_employment_events`, `provider_events`, 0121 grants/assignments and **0115–0116 payout prerequisites** are absent. Even though the synthetic local `db:push` fixture includes 0115–0120 shapes, **Neon does not**. The original historical `drizzle/0121_multi_entity_v2_scope_transfer.sql` also still mixes real payroll/worker data DML with schema changes, and there is no authenticated applied-migration journal; `0123` does not retroactively repair or certify that file's execution. Treat canonical release ordering/provenance and issue #899 restore/write impact as separately unresolved. `0123` is **not** a runnable shortcut past migrations 0115–0122.

**Production NO-GO remains in force:** no live SQL, number/journal adoption, snapshot restore, entity transfer, payout, regulatory filing or multi-entity flag enablement from this draft. The requested engineering deliverable ends at a numbered source candidate and isolated test evidence.

## PR #860 integration

Once source `#958` is integrated and the 0123 exact-head synthetic workflow passes, link this branch as a proposed database dependency to [draft #860](https://github.com/erwinmehehe/payrollph/pull/860). Do not cherry-pick an unverified `0123` into #860, alter 0121 historical SQL, or merge/enable #860 on the strength of these synthetic results alone.
