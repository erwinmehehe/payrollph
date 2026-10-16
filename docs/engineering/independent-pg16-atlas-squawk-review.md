# Independent PG16 schema comparison (Atlas) and SQL lint (Squawk)

**Status: engineering synthetic-only review, production NO-GO.** This is not a
DBA release packet, a real production-shaped clone, an historical migration
receipt, a security approval, or evidence that a Neon backup can be restored.

## What the two independent tools do

- **Atlas v1.3.0** runs only `atlas schema diff` on two PostgreSQL 16
  databases inside one ephemeral GitHub Actions service. The #1031
  catalog query uses the dedicated `atlas_auditor` role (no table-row SELECT,
  REFERENCES, DML, DDL or elevated privileges). Atlas v1.3 PostgreSQL
  inspection instead needs `information_schema.columns` visibility, so it
  uses a separate `atlas_inspector` role granted **REFERENCES only** on the
  fictional disposable tables, but no table-row SELECT, DML, schema CREATE
  or elevated privileges; both roles default to read-only transactions.
  The synthetic migration runs through a separate disposable fixture writer
  before either role is used. `app_db` is created
  from one guarded `drizzle-kit push`; `atlas_candidate_db` is copied using
  `CREATE DATABASE ... TEMPLATE app_db`, then a synthetic missing-table
  baseline receives the exact source files 0115 through 0126, in order.
- **Squawk 2.65.0** statically lints the exact 0124, 0125, and 0126 migration
  source files using PostgreSQL 16 rules and the protected runner's
  single-transaction semantics. No parser rules are disabled and there is
  no automatic remediation.
- No Atlas or Squawk `apply`, `push`, `migrate set`, journal adoption,
  provider connection, production credential or Neon branch is used. Every
  connection string is hardcoded to the *GitHub Actions host's loopback*
  PostgreSQL 16 test service. PostgreSQL's `inet_server_addr()` inside a
  Docker service is normally a bridge address, not `127.0.0.1`; identity
  is therefore proven using the literal client URL, exact database name,
  PostgreSQL major version and restricted current role rather than by
  incorrectly asserting a Docker server-interface address.

## Synthetic baseline construction

The missing table list mirrors the prior #1121 rehearsal, including all
ten #1015/#1054/#1061 recovery tables and the historical 0115-0123 foundation
targets. The recreation executes exact SQL source, with the hardened #1054
preflight/postflight from the stacked #1120 candidate.

This is an **approximation**, not a restored or authenticated production
catalog. The fixture starts with the entire current Drizzle shape, then uses
`DROP TABLE ... CASCADE` in the disposable copy to imitate missing objects.
Collateral FK drops can produce Atlas diffs unrelated to an actual live
migration. Such differences remain visible and are not silently normalized.

The candidate SQL is committed **only inside the throwaway PG16 service**
because Atlas requires a separate session to inspect both states. No tenant,
worker, payroll, bank or provider records are seeded, and the service
disappears with the CI job.

## Evidence and interpretation

Artifacts (14-day retention): `independent-pg16-squawk` and
`independent-pg16-atlas-schema-diff`, including exact migration source
SHA-256s and the version of Atlas. A companion **read-only** #1031 report
runs against BOTH `app_db` (fresh source push) and `atlas_candidate_db`
(exact source replay), recording every MISSING/DRIFT/EXTRA. The latter is
the same database Atlas reads, so both comparisons can be triaged at the
same commit instead of inferring agreement between unrelated CI runs. Exact
migration SHA-256s and PR head SHA/Actions merge SHA are recorded separately,
not mistaken for receipt evidence.

The Squawk step records its actual exit code and full JSON warning/error list
before independently classifying *every* finding as blocking. A malformed,
truncated or unrecognized report also blocks. Atlas is invoked with
`--format '{{ sql . "" }}'` to emit SQL-only difference output; an empty plan
or the exact documented no-change notice is a PASS. All other output is
`DRIFT` and blocks pending review. Pure Node regression tests prove that
real generated DDL and Squawk warnings cannot be turned into PASS by these
classifiers. Tool failures are never hidden by `continue-on-error`.

Before interpreting Atlas diff output, a separate `atlas schema inspect`
invocation under the REFERENCES-only read-only `atlas_inspector` role emits JSON for BOTH fixtures. The
source-generated #1031 manifest is checked against each Atlas-visible
`public.tables` inventory: a zero-table or partial-visibility inspection
fails closed instead of being misreported as schema parity. This is a critical
guard because catalog-only roles can be more limited than database owners.

The jobs fail closed on tool/runtime errors and on structural/lint findings;
a red CI result requires reviewer triage.
A green result would mean only that the inspected **synthetic** resources
match under these specific tools and PG16 setup.

Atlas Community schema diff covers schema/tables/indexes/constraints by
default; it does **not** independently prove application data, migration
journals, trigger/function parity, tenant security or payroll centavos.
The separate #1031 full catalog comparator is still a mandatory, independent
report. Where Atlas and #1031 disagree, record both reports with exact SHAs,
inspect false-positive deparsing/name differences, and resolve the physical
catalog discrepancy without lowering the checks.

## Observed initial Squawk results — 2026-10-16 (synthetic CI only)

[First exact-head check](https://github.com/erwinmehehe/payrollph/actions/runs/38876347019)
at PR head `93b7e81c261a7edf369c7e4d72bc388337cbc93b`
finished **red**, with an independently recovered GitHub Actions
`squawk.json` artifact. Squawk v2.65.0 produced **115 Warning** results
(0 Error results), as follows:

| Raw SQL file | Lock timeout | Statement timeout | bigint-over-int | identity-over-serial | text-over-varchar | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0124 | 1 | 1 | 7 | 1 | 6 | **16** |
| 0125 | 1 | 1 | 19 | 3 | 13 | **37** |
| 0126 | 1 | 1 | 36 | 6 | 18 | **62** |
| **Total** | **3** | **3** | **62** | **10** | **37** | **115** |

This report is historical evidence from the specified head, **not** a PASS
for the current PR head. It is intentionally retained without any exclusions.

The protected reviewed-migration runner source at #1120 sets
`lock_timeout=5000ms` and `statement_timeout=90000ms` transaction-locally;
Squawk lints the raw files, so the six timeout warnings require an explicit
review of the effective runner execution path, not an automatic suppression.
The numeric/serial/varchar warnings must be judged against the existing
Drizzle schema, application/foreign-key contracts, and historical numbered
source immutability. An AI reviewer cannot approve changing foundational
integer IDs or rewrite previously merged migration SQL to appease a linter.

The initial Atlas job also stopped before a comparison on a
`inet_server_addr() = 127.0.0.1` assertion (Docker bridge-interface
mismatch). An intermediate [independent Atlas CI run](https://github.com/erwinmehehe/payrollph/actions/runs/38879180388)
then passed the synthetic source train and the catalog-only #1031 comparison,
but Atlas v1.3 failed parsing `applicant_privacy_legal_basis_check` because
the no-column-privilege role did not see `legal_basis` through its use of
`information_schema.columns`. The Drizzle model DOES declare this column;
this is a tool-role visibility problem, **not proven database schema drift**.
The current source uses a separate REFERENCES-only metadata inspector role
with no data-row SELECT or DML; new exact-head Atlas inspect/diff CI is still
required to establish structural parity. Never use production data or
grant wider privileges on Neon to work around this synthetic issue.

## #1031 companion report — observed intermediate exact-head run

[Run 38879180388](https://github.com/erwinmehehe/payrollph/actions/runs/38879180388)
on PR head `fb093c8fda0d9b2ddfbd1603225cf1a7e83fc704` successfully
reconstructed the fictional 0115–0126 candidate and generated two genuine
read-only #1031 reports for the same 271 modeled tables. The retained JSON
contains the following **object-level** results:

| #1031 classification | Fresh Drizzle source | Replayed candidate |
| --- | ---: | ---: |
| PASS | 5,564 | 5,455 |
| MISSING | 0 | 109 |
| DRIFT | 155 | 155 |
| EXTRA | 127 | 273 |
| **Total non-PASS** | **282** | **537** |

These differences are not all proven real semantic defects: the fresh Drizzle
database itself has 155 textual/deparser DRIFT and 127 EXTRA under #1031.
The replay candidate also includes PostgreSQL-created FK names and possible
synthetic DROP CASCADE side effects. Do **not** mark 537 entries fixed,
waived or false-positive; compare row-by-row, distinguish baseline-common
from candidate-only before proposing changes, and preserve all statuses.
The PR's companion report now exports those exact subsets without weakening
any structural comparison.

Atlas failed **before producing an independent diff** at this old head due
to insufficient `information_schema.columns` visibility for its auditor
role. The separate, no-data-SELECT `atlas_inspector` role was added afterward
and needs its own exact-head CI proof.

## Verified third-party Atlas structural cross-check (2026-10-16)

[GitHub Actions run 38880741093](https://github.com/erwinmehehe/payrollph/actions/runs/38880741093)
at exact functional PR head
`1b8d34b25c8cf54248573db2cdc284ccab041daa` completed the following
steps using **disposable localhost PostgreSQL 16 only**:

1. Fresh guarded Drizzle schema push and clone; synthetic source 0115–0126
   replayed successfully in the throwaway candidate DB.
2. Read-only #1031 catalog comparison reported, exactly:
   - Fresh Drizzle: **5,564 PASS / 0 MISSING / 155 DRIFT / 127 EXTRA**
   - Replayed candidate: **5,455 PASS / 109 MISSING / 155 DRIFT / 273 EXTRA**
   - Baseline-common non-PASS: **280**; candidate-only non-PASS: **257**;
     source-only non-PASS: **2** (full object-level evidence retained).
3. Atlas `schema inspect` through REFERENCES-only, no-row-SELECT
   `atlas_inspector` succeeded on **279 public tables in each database**,
   including all **271 generated Drizzle models**; the inspector's
   privileges and connection identity gate passed.
4. Atlas v1.3.0 `schema diff` produced a **30,716-byte, nonempty SQL
   plan** (43 proposed statements) and the independent classifier correctly
   returned **DRIFT**, leaving the Atlas job **red**. **Atlas did not
   execute its proposed DDL.**

The direction of the plan is *replayed candidate → fresh Drizzle schema*.
Its 43 suggested SQL statements comprise **29 ALTER TABLE statements with
constraint operations** (some also include DROP COLUMN),
**9 ALTER TABLE statements for only column drops**, and **5 DROP INDEX
statements**. Notable examples:

- Replay-created `legal_entity_id` fields on `bank_file_validations`,
  `historical_payroll_entries`, `payroll_jobs`, `payslips`,
  `separation_records`, `year_end_adjustments`, `payroll_entries`,
  `payout_batches`, `payout_transfers`, and associated scope/index
  structures do not match the freshly pushed Drizzle baseline.
- `organizations.module_navigation_mode` and `enabled_modules`,
  and `legal_entities.registered_address` also appear as candidate-only
  columns in the proposed reverse diff.
- Many forward SQL foreign keys get PostgreSQL-generated `_fkey` names
  rather than Drizzle source names, including the #1015 / #1054 / #1061
  repair tables. The dependent draft #1121 proposes independent `0128`
  renaming; **0128 was not run by this 0115–0126 audit**, and cannot be
  assumed to resolve non-FK differences.
- Several extra candidate indexes are reported, including
  `wfm_schedule_assignment_effective_window_idx`,
  `wfm_worksite_assignment_effective_window_idx`,
  `employee_org_id_for_entity_scope`,
  `user_org_id_for_entity_scope`, and
  `payroll_run_employer_identity_unique`.

The SQL plan is an **independent inspection artifact, not an approved
migration plan**. No statement from that plan may be applied or treated as
a fix without separate engineering/DBA review. The existing #1031
deparser differences already observed against the fresh source schema
remain recorded, not waived. Reconcile the source/forward-model conflicts
on disposable fixtures; never hide differences to make CI green.

Squawk separately still reports **115 warnings** for original numbered
0124–0126, with no linter exclusions or changes to their bytes. Therefore
the overall #1127 independent validation is **RED/BLOCKED as designed**.
This is useful engineering evidence, **not** a deployment release or DBA
approval. Any later code/doc-only SHA must be recorded separately from this
exact tested head.

## Remaining synthetic parity limitations

Atlas Community deliberately does not compare stored functions, triggers,
sequences, views, or other Atlas Pro-only resources. Its empty plan alone is
not full parity. Both read-only #1031 reports cover source-modeled objects;
#1121 separately fingerprints functions/triggers and tests migration behavior.
The synthetic `DROP ... CASCADE` may also remove external FK constraints:
report such deltas truthfully, distinguish them from actual numbered SQL
effects, and do not bypass or exclude a drift class just to make CI green.
An intentional structural difference still leaves the validation gate red
until reviewed; a linter warning is not automatically a deployment blocker
dispositioned by an AI assistant.

## #1127 engineering follow-up: separating provenance from parity

The previous 271-model #1031 evidence has **282 non-PASS** rows even on
the independently pushed fresh source fixture (155 DRIFT, 127 EXTRA).
Those are **baseline comparator/schema discrepancies**, not proof that
the 0115–0126 train introduced the problem. They are not waived: a
PostgreSQL-deparsed check expression can look different, but *semantic
equivalence has not been demonstrated* for every expression.

The same comparator has 537 non-PASS rows on the source replay, of which
**280 already occur identically on the fresh source**, 257 are
candidate-only, and 2 are source-only. The candidate-only rows include
49 expected-new-MISSING + 49 PG-generated-old-EXTRA recovery FK names that
match proposed #1121 migration 0128. No other row is deemed resolved by
similar naming alone.

The new exact-source **three-state disposable PG16 checkpoint** works
as follows:

1. `app_db`: freshly applied current `schema.ts` (source baseline).
2. `atlas_candidate_db`: clone source, drop the documented synthetic
   missing foundation/recovery targets, replay immutable 0115→0126.
3. `atlas_reconciled_db`: *third* disposable clone of candidate, execute
   exact proposal `drizzle/0128_recovery_foreign_key_names_forward.sql`
   once in a savepoint, prove **all 49 FK OIDs and definitions unchanged
   except names**, **verify full rollback** to the before catalog, then
   execute it once more on this throwaway database for read-only inspection.
   Never insert a journal row or claim authentic 0127 receipts.

A three-way read-only #1031 catalog report compares every model and
records actual before/after 0128 PASS/MISSING/DRIFT/EXTRA, common baseline
differences, candidate-only residuals, and exact matched FK pairs.
**Each of the 49 old/new pairs must have the same FK columns, parents,
ON DELETE/ON UPDATE actions and validation bit**. All ten recovery targets
must be clean after this specific rename pass. That narrow result is
`RECOVERY_0128_NAMES_PAIRED_ONLY`, explicitly **not full-app parity**.

Atlas independently inspects all 271 source-model tables in each of the
three databases under a REFERENCES-only/no-row-SELECT role and emits BOTH
unaltered SQL plans: `atlas-source-vs-train.diff.sql` and
`atlas-post-0128-vs-source.diff.sql`. Every proposed DROP COLUMN / DROP
INDEX / DROP CONSTRAINT in either plan is **inspection evidence only**.
All remaining nonempty post-0128 Atlas plans are blocking and **never
executed**. A before/after comparison does not authorize an Atlas push or
SQL normalization.

**Candidate-only differences outside 0128 still need case-by-case review:**

- Source-code compatibility versus migrations 0115–0123 for
  `legal_entity_id` columns, tenant-employer relationships, organization
  module settings, legal-entity address and effective-window indexes;
  determine whether a forward train is intentionally newer than
  `schema.ts`, not whether Atlas's destructive reverse plan can be run.
- Foreign keys referencing a restored table that were removed by the
  fixture's `DROP TABLE ... CASCADE` can be *synthetic collateral*. Prove
  the starting live catalog shape independently; neither call them real
  production missing constraints nor silently ignore them.
- #1031 CHECK/default/index text DRIFT seen even on the source fixture
  requires semantic/catalog equivalence proof before downgrading it to a
  formatting issue. Keep its original raw row evidence and exact SHA.

### Squawk findings: 115 / 115 retained, 0 waivers

| Rule | Count | Review required before any disposition |
| --- | ---: | --- |
| `require-lock-timeout` | 3 | Protected PLAN/APPLY runner is source-coded to set 5-second `lock_timeout`; human must verify exact runtime/connection and transactional scope |
| `require-statement-timeout` | 3 | Same runner sets 90-second `statement_timeout`; human must verify real runtime and lock duration |
| `prefer-bigint-over-int` | 62 | Existing Drizzle integer PK/FK and downstream type contracts; no unilateral type conversion |
| `prefer-identity` | 10 | Legacy serial sequence ownership, identity/ORM compatibility and historical checksum |
| `prefer-text-field` | 37 | Existing varchar boundary and application validation contracts |
| **Total** | **115** | **OPEN — independent engineering/DBA review** |

The workflow now emits `squawk-independent-review.json`: every finding,
severity, exact original SQL file and SHA-256, source line, rule, explanation,
and an **open** human review question. It emits **zero waivers** and retains
all five original rule families. The existing fail-closed lint gate still
fails for any warnings, errors, missing JSON, or process failure. Do not
silence these failures by changing historic 0124–0126 SQL, inventing
receipts, or turning off a rule.

**Important:** the 0128 three-state checkpoint and new Squawk triage have
not been accepted as final simply because their source code was committed.
Use only exact-head CI artifacts to report PG16 post-0128 and independent
Atlas outcomes. Any unexecuted check remains **NOT_RUN**; on any CI
failure, production remains **NO-GO**.

## Release gates not covered here

Historical path+SHA receipts and DBA baseline (#744/#910); full live catalog
comparison (#1031); the unresolved restore routing incident (#899);
operator-witnessed encrypted backup and offline restore (#907); strict
production DB identity verification; qualified DBA/security approval;
tenant-denial/role tests; money-path acceptance and post-migration smoke.
The #1120 source migration history guard must also be adjudicated, never
bypassed because a synthetic test or third-party linter is green.

**DO NOT MERGE into a production migration workflow or dispatch against Neon.**
The workflow has only a PR trigger and `contents: read` permission.
