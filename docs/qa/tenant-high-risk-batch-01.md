# Tenant isolation — high-risk Batch 01 (16 methods)

**Status: PENDING EXACT-HEAD REAL-HTTP CI. NOT CERTIFIED, NOT A PRODUCTION SECURITY CLAIM.** This is a separate first batch against the main branch, not another synchronization of draft PR #1260. The machine inventory on #1260 still has 447 GAP API methods and 20 scoped page/action GAPs. **Do not decrement those figures until this batch's real-HTTP, database and evidence checks pass and the source-pinned manifest is reconciled in a later substantive evidence integration.**

## Acceptance model

- Use the existing `Security HTTP Smoke` GitHub Actions workflow, `npm run build`, production-mode Next.js on `127.0.0.1:3000`, and disposable PostgreSQL 16 at `127.0.0.1:5432/app_db`; existing `requireDisposable()` fails closed outside the isolated CI environment.
- Existing seeded victim employer A and independent attacker employers B and C each have **real employee IDs and payroll-run IDs > 6**; both B and C have actual valid owner sessions, a real Released payroll entry, and tenant-owned legal entities and employee records. This batch additionally seeds a second authorized payroll checker per employer and actual linked employee self-service sessions.
- **For each of 16 GET methods**, demand an actual authenticated 200 for the attacker's own real data, verify a record ID/employee ID/legal entity ID/csv employee number where available (not empty-response success), and demand the correct explicit cross-employer 403 (or **404** for employee self-service direct pay entry). A forged self-service document-selector query must still return only the signed-in worker.
- Real membership revocation for each employee self-service account must preserve the session (`/api/account` returns 200 for the same user) while both `self/documents` and `self/payslips/[id]/explain` become explicit 403. The victim employer's employee, payroll-run, payroll-entry, document, legal-entity and audit-event database snapshots must be exactly unchanged.
- **No money movement, bank payout, payroll release, close mutation, remittance, official filing, or provider call.** The `GET /api/payroll-runs/[id]/exports?kind=journal` test generates an internal journal in disposable CI only and may record a fictional own-employer audit event. This does **not** exercise `POST /api/payroll-runs/[id]/exports`, which can submit payouts.

## Batch methods (real HTTP only)

| Method | Tested resource | Required own proof |
|---|---|---|
| GET `/api/payroll-runs/[id]/assurance` | Real Released own run vs victim Released run | Actual own run ID and employer ID |
| GET `/api/payroll-runs/[id]/close` | Same direct-object swap | Own run and employer ID |
| GET `/api/payroll-runs/[id]/variance` | Same direct-object swap | Own run, org and nonzero calculated entries |
| GET `/api/payroll-runs/[id]/release-checklist` | Same direct-object swap | Own run/org and real checklist array |
| GET `/api/payroll-runs/[id]/explain/[employeeId]` | Own run+worker vs victim run+worker | Real own run and explanation |
| GET `/api/payroll-runs/[id]/exports?kind=journal` | Own vs victim Released run | Nonempty CSV and no real provider call |
| GET `/api/compensation` | Forged `organizationId` | Own worker present, victim workers absent |
| GET `/api/payout-profiles` | Forged `organizationId` | Own legal-entity profile, victim entity absent |
| GET `/api/payroll-underpayments` | Forged `organizationId` | Own worker and own Released run present |
| GET `/api/compliance/statutory-remittances` | Forged `organizationId` | Own org and legal entity identified |
| GET `/api/compliance/filing-validations` | Forged `organizationId` | Own legal employer and actual filing-form definitions |
| GET `/api/organizations/[id]/payroll-approvers` | Real owned vs victim organization | Actual second payroll checker for own employer |
| GET `/api/exports?kind=employees` | Forged `organizationId` | Own employee number in actual CSV, victim absent |
| GET `/api/reports?key=headcount` | Forged `organizationId` | Own organization marker and nonempty report rows |
| GET `/api/self/documents` | Linked employee role; forged selectors and revoked membership | Same self employee ID before revocation, 403 after |
| GET `/api/self/payslips/[id]/explain` | Real Released own pay ID vs victim pay ID and revoked membership | Own pay 200; victim 404; formerly own pay 403 after revoked grant |

## Observed first CI attempt (synthetic fixture correction)

Exact first-head GitHub Security HTTP Smoke executed all 16 methods for both attacker employers. **15/16 passed for both**. Journal export correctly returned **HTTP 422** for the original second-pass fixture because gross ₱5,000, net ₱4,500 and ₱500 unclassified deductions cannot form a balanced export (₱5,340 debit vs ₱4,840 credit). This is a **fixture accounting defect**, not proof of a tenant leak. The exporter fail-closed guard was **not** changed. The batch now seeds an additional standalone fictional Released journal run with ₱5,000 gross, ₱0 deductions and ₱5,000 net for a proper positive control. The original auth fixture remains untouched. **Fresh exact-head CI must pass; do not count any of these methods as covered yet.**

## Evidence collection and failure policy

The `scripts/qa/tenant-high-risk-01-http.mjs` module is called from **the existing** `scripts/qa/tenant-second-pass-http.mjs` second-pass smoke with its existing `request`, `expectStatus`, and `makeSession`. No stubbed HTTP or fabricated foreign identifiers. `tests/tenant-high-risk-batch-01.test.mjs` asserts all 16 production route handlers still exist, proves the live harness actually invokes the module, and pins the expected own/denial/DB invariants. A failing request prints its endpoint label and results in a **failed workflow**, never provisional `COVERED`. This document does not claim an observed pass before the exact-head GitHub Actions run.

## Next deliberately separate risk batch

The unclosed **mutation and bank-document** methods—`GET /api/compliance/bank-validations/[id]/file`, `PATCH /api/payout-destination-changes/[id]`, `PATCH /api/approvals/[id]`, `POST /api/payroll-runs/[id]/release`, and `POST /api/payroll-runs/[id]/exports`—need actual positive authorized fixtures and extra MFA/maker-checker/provider safety conditions. Do **not** claim they are covered from early 403s caused by an absent MFA cookie or disabled feature flag. Only fully isolated test fixtures and nonproduction safety guards should be used when tackling them.
