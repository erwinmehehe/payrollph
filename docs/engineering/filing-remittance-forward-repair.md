# Filing and remittance schema repair

The original #1031 permissions/planning incident is closed. A fresh catalog-only
check on 17 October 2026 found 154 public tables versus 271 source models:
124 model tables absent (including optional modules), and three existing tables
missing fields. Those counts are inventory, not 124 confirmed user-facing errors.

This repair addresses two confirmed dependencies in the filing lifecycle:

- `government_filing_validations` has 19 columns instead of 22. Full Drizzle
  selects and generation writes reference absent `applicable_month`,
  `employee_count`, and `reported_total`.
- `statutory_remittance_payment_evidence` is absent. Existing payment-proof
  reads/writes and monthly close evidence cannot work against that catalog.

## Forward source and preservation

`drizzle/0132_filing_remittance_evidence_forward.sql` is a single atomic block.
It refuses incompatible legacy shapes, missing parent keys or employer FKs,
partial/replayed repairs and occupied target names. NOWAIT locks refuse active
contention. It adds three nullable columns, the month lookup index and the
14-column proof table with the existing model's foreign keys and indexes.
The month index is also declared in `src/db/schema.ts`, reconciling a historical
0026 index omitted from the model. Historical 0026 and 0031 are untouched.

No filing amount, employee count, month, agency acceptance, file hash, payment,
approval, payroll entry or employer attribution is inferred or backfilled.
Old snapshot fields remain NULL. New evidence storage mirrors the existing
Base64 model; object-storage conversion remains the separate A5 workstream.
Existing API role checks, MFA, upload scanning, and maker/checker rules remain.
The existing model uses separate organization and batch FKs; this migration
does not claim composite tenant-FK enforcement or add RLS. Scoped read tests
prove the actual query predicates, not a database-wide isolation guarantee.

## Executed acceptance required

The dedicated PG16/PG18 workflow bootstraps an empty localhost database, records
its exact catalog, recreates the observed old shape, and reproduces actual
Drizzle 42703/42P01 errors. It executes the new source, requires exact catalog
parity, preserves old accepted filing rows and hashes, exercises month/amount
queries and two fictional employers' proof reads, rejects duplicates/bad FKs,
checks uploader SET NULL and batch CASCADE, rejects seven malformed catalogs
and concurrent reader locks, and proves compound failure and outer rollback.

No UI code or route response changes. With no migration execution, runtime and
all flags retain existing behavior. The source index declaration alone does not
run DDL. Do not enable optional features or payroll/bank/agency flags to test it.

## Apply and rollback boundary

Source merge is not live execution. Apply requires a fresh exact target/catalog
check, reviewed source SHA/checksum and the approved runner/operational path.
The owner has classified the connected site as customer-free development and
deferred paid storage/staging; do not silently provision either or claim a
production recovery certification. Do not create historical receipts from
present tables, replay 0026/0031, use live `db:push`, or reset the database.

A failure before commit rolls the complete repair back. After new proof rows
or snapshot values are written, retain the additive schema and roll application
code back if needed; dropping these objects would destroy evidence. Live apply,
authenticated owner/browser acceptance, real agency filing acceptance and the
remaining schema inventory are explicitly separate completion items.
