# #1113 — Worksite and separation forward repairs

Status: source repair and disposable-database verification; no live SQL applied.

## Verified gap and source provenance

On 2026-10-17, read-only catalog queries on the issue's original Neon branch
returned nine worksite-assignment columns (no `decision`) and exactly twenty
separation-record columns. No employee, bank, payroll or separation rows were
read. This does not attest the deployed application's actual connection role.

The twenty separation columns match `drizzle/baseline.sql`. The current
`src/db/schema.ts` declares thirty-eight. The eighteen absent fields are
already enumerated by `separationSchemaSpec` in
`src/lib/request-schema-readonly.ts` and by `ensureSeparationSchema` in
`src/lib/separation-schema.ts`. Historical 0102 supplies the three actor
references, maker/checker check and review index; it must not be replayed or
edited. Migration 0002's `final_pay_breakdown` is a different field from the
current `computation_snapshot` and is not silently substituted or copied.

| Missing fields | Exact existing app contract | Historical-data treatment |
| --- | --- | --- |
| thirteenth_entitlement, thirteenth_paid_ytd, unpaid_basic_salary, separation_pay, retirement_pay, other_benefits, final_statutory_deductions, gross_final_pay | numeric(12,2), NOT NULL, default 0 | Zero is the existing app default, not a reconstructed entitlement |
| basic_salary_earned_ytd, historical_basic_salary_earned | numeric(14,2), NOT NULL, default 0 | No source-payroll inference/backfill |
| computation_snapshot | jsonb, NOT NULL, default {} | No invented computation or approval evidence |
| final_pay_due_date | nullable date | NULL, no invented legal deadline |
| approved_at, released_at | nullable timestamptz | NULL, no inferred events |
| release_reference | nullable varchar(160) | NULL, no invented payout |
| prepared_by_user_id, approved_by_user_id, released_by_user_id | nullable integer, users(id), ON DELETE SET NULL | NULL, no actor-name mapping |

## Route impact and repaired behavior

`src/app/api/separation/route.ts` calls `ensureSeparationSchema` before its
list/create/mutation paths. Drizzle full-row selection requests the absent
fields. With an old schema, read-only compatibility mode rejects readiness;
unguarded ORM reads fail with PostgreSQL 42703. Legacy mode attempts DDL in a
request, which can fail under the proper restricted runtime role. These
forward migrations allow a separately authorized migration role to prepare
the schema instead. This PR does not change runtime compatibility mode or
introduce another request-time DDL fallback.

Restoring columns does not make historic approved/released records payable.
Existing release code requires stable preparer/checker identities and fresh
computation evidence. New actor fields remain NULL; old amounts, status,
clearances and dates are preserved. Operators must reprepare/reapprove legacy
packages through the existing flow; do not bulk-demote released records or
infer historic gross amounts from net. The existing distinct-actor CHECK is
restored at the database level. Tenant-scoped application predicates remain
unchanged; this migration does not introduce or claim RLS.

## Ordered source and preflight

- 0130 promotes the prior tested worksite candidate after merged 0129 (#1136).
  Its executable DO body is unchanged; the new path has its own source hash.
- 0131 takes an ACCESS EXCLUSIVE NOWAIT lock on the exact persistent public
  separation table. It requires all twenty observed legacy columns, their
  types/nullability, integer PK, validated nondeferrable tenant/employee FKs
  and integer users PK. Any already-present repair column, reserved constraint
  or index name aborts for explicit receipt/disposition review.
- One atomic DO adds the eighteen fields, three actor FKs, maker/checker CHECK
  and organization/status/id index. Postflight checks every added column's
  type, nullability and default. No DML, approval changes, grants, or receipt
  writes occur. Additional forward-only columns such as legal_entity_id are
  preserved; absence/presence is not guessed from synthetic fresh schema.
- The source worksheet includes both files, exact hashes and empty receipt
  fields. Historical SQL remains unchanged. New unique contiguous numbers are
  checked by the existing history guard.

## Behavior tests and limits

The existing dedicated workflow runs fresh disposable PostgreSQL 16 and 18
with no repository secrets. It executes promoted 0130 and a second actual
PostgreSQL test for 0131. The latter reproduces the 20-column state, executes
the real application's Drizzle selection to obtain 42703, repairs it and
compares all thirty-eight columns to the real model. Two fictional employers
prove original centavo values and tenant-scoped queries survive. Tests also
reject partial repairs, changed types, missing PK/FK, occupied names, replay,
reader-lock contention, invalid actor references and maker self-approval;
actor deletion retains SET NULL. The outer transaction restores the entire
original catalog including OIDs and removes every fixture row.

Exact-head CI must actually finish before any PASS claim. These are database
and ORM tests, not a claim that an authenticated deployed browser journey or
physical-phone UAT has been executed. No UI or API behavior code changes;
desktop/390px screenshots are not applicable to this source repair.

## Production application and rollback

Source merge does not execute migrations. The manual-only protected runner
requires its default-off `ORDERED_RELEASE_MIGRATIONS_ENABLED`, exact-main SHA,
SQL checksum, genuine historical receipts, ordered predecessor application,
verified target/role, approval reference and explicit confirmation. 0131
cannot bypass unapplied 0130 or earlier history. Do not use production db:push,
unrecorded direct SQL, fake receipts or blanket historical replay.

Before APPLY: resolve #899 restore impact, #907 offsite encrypted recovery,
actual target/role mapping and historical journal adoption. On an approved
isolated production-like target, perform protected PLAN/APPLY, authenticated
Live Floor/separation reads, tenant denial and final-pay reapproval tests.
Schedule the exclusive-lock window; NOWAIT rejects busy relations instead of
waiting. Index construction still consumes time and holds the exclusive lock.

Before commit, any pre/postflight error rolls back the complete DDL transaction.
After successful application, retain additive columns and roll back application
activation if needed. Do not drop populated columns or delete authentic journal
entries to simulate rollback; use a separately reviewed forward correction.
No production operation or historical approval reconstruction is authorized
by the synthetic tests. Keep #1113 open until live application is evidenced.
