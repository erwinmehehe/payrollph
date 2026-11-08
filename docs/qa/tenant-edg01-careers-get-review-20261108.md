# EDG-01 public Careers GET — independent, zero-credit privacy test

**Scope:** [issue #1740](https://github.com/erwinmehehe/payrollph/issues/1740), `GET /api/careers` only. There are **zero new method credits**. Both public Careers GET and POST remain `GAP` in the canonical manifest; production recruitment and tenant-wide acceptance remain unapproved.

## Historical proof integrity (mandatory)

The previously executed [EDG-01 Careers PATCH proof](https://github.com/erwinmehehe/payrollph/pull/1751) has a fully source-pinned runner and workflow. Its original runner `scripts/qa/tenant-edg01-careers-publication-http.mjs` **must remain byte-for-byte unchanged** (Git blob `9f799cc2344561ab8f4a47a2c0ddc162335f8096`), including historical line citations and separately credited positive/negative PostgreSQL 16 write evidence. This new GET task therefore does **not** edit the original runner, its contract, old workflow, canonical ledger or application route.

## Separate real-HTTP GET evidence

The new workflow `.github/workflows/tenant-edg01-careers-public-get-http.yml` runs with a fresh, empty, disposable PostgreSQL 16 database. It first invokes the **unchanged** original `--migrate` and `--prove` runner, which creates three real fictional employers, publishes one genuine open position for each, then unpublishes the two attackers' positions. The new `scripts/qa/tenant-edg01-careers-public-get-http.mjs` separately checks anonymous public Careers GET against the three **persisted** employers and the remaining higher-ID published victim.

It checks that the two unpublished employers return empty lists; the still-published victim returns one real, open requisition; responses contain only the five intentional public job fields and no other employer marker or private applicant email; responses have `Cache-Control: no-store`; and the underlying organization, requisition, applicant, employee, payroll and audit tables remain completely unchanged by all reads. The public employer selector is **intentionally anonymous**, so foreign-employer public GET is not a 403/404 tenant-private denial.

A new Node source contract rejects modifications to the original source-pinned PATCH evidence or attempts to give either public Careers method a credit without separate executed proof and privacy review.

**Execution gate:** Wait for this **exact-head** public-GET PG16 job, baseline security/CI checks and maintainer review before further changes. A successful synthetic HTTP test may support a future independent `PUBLIC-BY-DESIGN` classification; it does not by itself approve it. No real tenant, provider, payout, production database, migration, payroll operation or feature-flag change occurs.
