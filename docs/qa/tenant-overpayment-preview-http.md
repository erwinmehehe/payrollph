# Payroll Overpayment Preview POST — tenant-isolation candidate

**Exact manifest method:** `POST payroll-overpayment-preview` — **GAP** (zero coverage credits). **Base:** `main@de8c88bc103a17545f6513f34fc993e92e344dec`. At selection no open PR targeted this API family; currently open Payroll v1 journal, HCM, Benefits, Attendance, Performance, Leave, ESS and UI PRs have different route scopes and no changed-file overlap.

## Safety and actual scope

This endpoint is an authenticated, MFA-required, company-wide payroll-checker **read-only POST**. It compares a source entry in a historically `Released` payroll run with independently entered gross/net evidence. It returns a classification of possible discrepancies, an SHA-256 source fingerprint and mandated human-review warnings. **It cannot recover wages, authorize deductions, change payroll runs, make a loan, execute a payout or modify employment status.**

The feature flag `HCM_OVERPAYMENT_PREVIEW_ENABLED` stays default-off in production. A new isolated **GitHub Actions job only** enables it against synthetic, fresh PostgreSQL **16** with disabled payment providers, ephemeral cryptographic inputs and a real production-mode **localhost** Next HTTP server. The script refuses to import any application or database code unless all disposable environment guards pass. No real customer data, production API, provider or external money endpoint is touched.

Three fictional employers are seeded in sequence: two independent authenticated owner attackers A and B, followed by a **genuine higher-ID victim** (org/entity/unit/worker/user). For each employer the script writes a real in-range Released payroll run with exactly one real payroll entry and employer-distinct protected line-item/trace markers, an in-range Draft decoy, and an ambiguous Released decoy with **two**
entries in a **separate non-overlapping pay period** (September 16–30). This
preserves the PostgreSQL `payroll_runs_no_overlapping_release` exclusion
constraint while exercising the duplicate-entry failure path. The latest real victim run and entry IDs are verified higher than both attacker IDs.

Source `Released` rows are **directly inserted fictional historical fixtures**; they do **not** constitute evidence that any legitimate payroll approval/release workflow was executed. The actual source fingerprint is computed over the committed original entry ID, run/worker IDs, centavos, status, `lineItems`, and `trace` and must match the HTTP result. One victim worker is deliberately marked Separated *before* the snapshot, confirming historical review cannot change employment state.

## Required real PG16/HTTP assertions

| Probe | Required result |
| --- | --- |
| Attacker A and B each submit their own persisted released run, employee and verified gross/net | **200**; exact own employee ID/number/name, period, run/entry IDs, 64-character source hash, rank-distinct source/verified amounts and full **centavo-exact** variance; `reviewOnly=true`, `saved=false`, `automatedRecoveryAllowed=false`, private no-store |
| Victim's real higher-ID owner submits own source | **200**; genuine positive victim evidence exists and is independently validated |
| Swap A's actual own HTTP 200 source into B's proof (and vice versa) | Validator must **fail**; a default/empty/fake 200 is not accepted |
| A or B uses its session with victim's real organization, employee and run | **403**, no source or marker exposure |
| A or B forges victim employeeId within its own employer | **404** with source-not-found code; no review results |
| A or B forges victim runId within its own employer, with own or victim employee ID | **404** with source-not-found code |
| Attacker selects its own Draft payroll run | **404**; draft data cannot stand in for a Released source |
| Attacker selects its own real Released run with **two** persisted entries | **409**; never choose an arbitrary source row |
| Attacker A pairs a different real same-employer worker with A's Released run | **409**; a worker/run mismatch is not silently treated as payroll source evidence |
| Signed-in employee without payroll-checker role; privileged owner session lacking recent MFA | **403**; MFA-specific failure is `MFA_REQUIRED` |
| No session, cross-origin request | **401**, **403** respectively |
| Invalid request, exponential amount notation, verified net greater than gross | **400** or **422** with exact relevant error codes |
| Any attempted denial returns line items, trace, private employer marker, authorized employee source or amounts | **Fail** |

The dedicated CI workflow also prepares the existing, reviewed SQL-only
`hcm_work_item_events` table in the **empty disposable PostgreSQL 16 instance**
before seeding. This is necessary because the shared deep victim snapshot reads
that migration-only table; it does not apply a production migration.

The positive-response test permits Next.js to normalize
`private, no-store` into `no-store, max-age=0`, but rejects any missing
`no-store`, `public`, positive/shared cache lifetime or other caching
contradiction.

The script snapshots **all three employers** immediately before network traffic: full worker rows, pay profiles, payroll runs, all entries linked to those runs, employee loans, leave requests, payout batches, and business-content audit events. The after-snapshot must be **identical**. In addition, the existing shared deep victim organization/unit/entity/employee/audit/recovery source snapshot must remain identical. Session last-used and distributed rate-limit counters are the only unrelated security bookkeeping outside these source snapshots.

## Changed artifacts

- `scripts/qa/tenant-overpayment-preview-contract.mjs`: disposable-only guard, distinct fictional exact-centavo inputs, strict own/denied HTTP body validators, and state immutability.
- `scripts/qa/tenant-overpayment-preview-http.mjs`: real PostgreSQL three-employer fixtures, signed-in HTTP success and 20+ foreign/invalid probes, sworn source-fingerprint checks, before/after invariants.
- `tests/tenant-overpayment-preview-contract.test.mjs`: **ten adversarial source tests** that reject swapped employers, forged source hashes, wrong centavos, recovery authorizations, private source fields and changed SQL snapshots.
- `.github/workflows/tenant-overpayment-preview-http.yml`: isolated PG16, Node source tests, real production-mode localhost Next and HTTP proof.
- This document: scope, limitations and no-credit acceptance gates.

## Mandatory acceptance gates

- [ ] `node --check` all three new JS scripts/test files and `node --test tests/tenant-overpayment-preview-contract.test.mjs` **pass at the exact PR head**. No pass assumed before a CI receipt.
- [ ] Dedicated **Overpayment preview tenant HTTP** workflow passes fresh PostgreSQL 16, three genuine positive sources, foreign/forged/negative requests and full before/after unchanged source checks.
- [ ] CI, CodeQL, Security HTTP Smoke, Tenant GAP factory and independent security review complete, including any failures.
- [ ] Independent reviewer confirms there is no live salary change, final-pay offset, wage recovery, loan/deduction, provider payout or production activation.
- [ ] Manifest reconciliation only after full exact-head evidence and independent acceptance. Until then `POST payroll-overpayment-preview` remains **GAP**.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / ZERO NEW CREDITS.** This candidate proves the review-only source boundary, not authorization for real wage recovery or global tenant-isolation certification.
