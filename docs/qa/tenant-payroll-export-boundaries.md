# Tenant-isolated payroll payslip exports and payout IDs — draft proof

This is an **implementation and regression-testing batch**, not a tenant
coverage credit, production acceptance, or authorization to move money.

## Hardened boundaries

- GET/POST `/api/payroll-runs/[id]/exports` and GET/POST
  `/api/payroll-runs/[id]/xendit-payout` use canonical positive path IDs.
  Signs, leading zeros, exponents, decimals, zero and unsafe integers are rejected.
- Duplicate export selectors, unsupported `kind`, invalid explicit `payslipId`
  and a payslip ID sent with a non-payslip export fail closed with 400.
  Invalid input no longer switches an intended one-payslip read into an entire
  employer payslip list.
- A payslip list or PDF is serialized only when **both** the payroll-entry
  employee and the payslip employee refer to the same worker of the run's
  persisted employer. One mismatched/foreign association denies the whole
  operation with a generic 409. No silent row filtering.
- Payslip responses use `private, no-store` and `nosniff`.
  Existing payroll role/MFA, company policy, unit, legal-entity and treasury
  controls remain unchanged.

## Proof and limits

Existing `tenant-payroll-run-path-boundaries.yml` now runs the pure unit
tests, source contracts and a production-mode Next server on disposable
PostgreSQL 16 in **default and multi-entity** profiles, with no real
provider credentials. The fixture seeds two independent attacking employer
owners and a third, higher-ID victim employer, proves positive reads of each
attacker's own populated payslip list and foreign-run 403 denials, and tests
malformed/duplicate selectors.

Two additional negative cases deliberately insert a payslip pointing to the
victim worker into the attacker's own run, once via a mismatched slip worker
and once via a foreign-entry worker. Both must return 409 before disclosing a
victim marker. Victim and attacker state are snapshotted and checked unchanged
after clean-up.

The added read proof exercises only the **GET payslip-list branch**. It
does not accept the entire exports GET method, single-PDF audit semantics,
government/journal/bank branches, provider preflights, or money-moving POST
methods. **Zero new method credits.** Wait for exact-PR-head CI and
independent security review before considering broader acceptance.

The manifest's export route SHA and handler positions are re-inventoried without
changing any status or count. GET retains its prior provisional credit, with
fresh-head revalidation explicitly pending; POST remains GAP. Its entire body
is pinned byte-for-byte after normalizing only the stricter ID parser. The
separately credited Xendit route and the shared export ownership helper are
unchanged; payslip validation lives in a new module so unrelated historical
receipts are not silently repinned. Updated negative-only fixture pins remain
unaccepted until the default and multi-entity PG16 jobs actually pass.
