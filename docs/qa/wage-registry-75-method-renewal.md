<!-- wage-renewal-v2:start -->
# Wage-source API renewal v2 (per-method source closures)

SOLO_VERIFIED_DEV_RECOVERY. 498 methods = **430 COVERED + 25 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 31 GAP**. 51 of 75 methods CREDITED from one fresh run; 24 remain zero-credit holds.

Execution: [run 44713061008](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008), 42 successful jobs at exact source head `a9ce9c0301105bd1871d958fbbce444487a957ff`. Receipt: [`wage-registry-renewal-receipt-v2.json`](../../scripts/qa/wage-registry-renewal-receipt-v2.json) (27 global pins; one closure per method).

A later change withdraws only the methods whose own closure or the global base contains the changed file: run `node scripts/qa/wage-registry-renewal-v2.mjs --withdraw-drifted` (zero credit) and commit the result.

| Method | Result | Closure files | Fresh executed evidence |
| --- | --- | --- | --- |
| `PATCH /api/approvals/[id]` | CREDITED | 216 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209380686) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381039) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381051) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381165) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381305) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381453) |
| `GET /api/auth/me` | CREDITED | 177 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381630) |
| `POST /api/automation-studio` | CREDITED | 317 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381454) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381791) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381627) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381732) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381437) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381555) + [PG16 7](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381709) + [PG16 8](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381325) |
| `POST /api/bir/annual-employer/candidate` | CREDITED | 217 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381168) |
| `GET /api/bir/annual-employer/module-evidence` | CREDITED | 261 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/bir/annual-employer/module-evidence` | CREDITED | 261 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/bir/annual-employer` | CREDITED | 187 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `GET /api/compliance/bank-validations/[id]/file` | CREDITED | 254 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `PATCH /api/compliance/bank-validations/[id]` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/bank-validations` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/bank-validations` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/bir-1601c-remittances` | CREDITED | 254 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/bir-1601c-remittances` | CREDITED | 254 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/calendar` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/contribution-issues/evidence` | CREDITED | 257 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/filing-validations/[id]/file` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `PATCH /api/compliance/filing-validations/[id]` | HELD | 218 | zero credit |
| `GET /api/compliance/filing-validations` | CREDITED | 258 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/filing-validations` | CREDITED | 188 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `GET /api/compliance/government-loan-remittances` | CREDITED | 257 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/government-loan-remittances` | CREDITED | 257 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/labor-inspection/drills` | CREDITED | 203 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `POST /api/compliance/labor-inspection/drills` | CREDITED | 203 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `GET /api/compliance/labor-inspection/evidence-pack` | CREDITED | 272 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/labor-inspection` | CREDITED | 196 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `POST /api/compliance/labor-inspection` | CREDITED | 186 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381691) |
| `GET /api/compliance/payroll-month-close` | CREDITED | 201 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `POST /api/compliance/payroll-month-close` | CREDITED | 194 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381100) |
| `GET /api/compliance/remittance-actions` | CREDITED | 82 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381281) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381794) |
| `POST /api/compliance/remittance-actions` | CREDITED | 82 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381281) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381794) |
| `GET /api/compliance/remittance-month-close` | CREDITED | 256 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/remittance-month-close` | CREDITED | 256 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/statutory-remittance-corrections` | CREDITED | 262 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/statutory-remittance-corrections` | CREDITED | 262 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/statutory-remittances/posting-import` | CREDITED | 257 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/compliance/statutory-remittances` | CREDITED | 254 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/compliance/statutory-remittances` | CREDITED | 176 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381100) |
| `POST /api/compliance/validate` | CREDITED | 186 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `GET /api/dashboard` | HELD | 307 | zero credit |
| `POST /api/employees/import` | CREDITED | 187 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381763) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381788) |
| `GET /api/employees/import` | CREDITED | 267 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/employees` | CREDITED | 272 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/employees` | CREDITED | 192 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381763) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381788) |
| `PATCH /api/employees` | CREDITED | 192 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381763) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381788) |
| `POST /api/enterprise` | CREDITED | 182 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381035) |
| `GET /api/first-payroll/preview` | HELD | 287 | zero credit |
| `GET /api/hcm/governance-readiness` | CREDITED | 255 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `POST /api/managed-payroll/runs/[id]/approve` | CREDITED | 178 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381511) |
| `GET /api/migrations` | CREDITED | 198 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381074) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381097) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381144) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381189) |
| `POST /api/migrations` | CREDITED | 193 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381388) |
| `GET /api/payroll-runs/[id]/assurance` | HELD | 375 | zero credit |
| `GET /api/payroll-runs/[id]/close` | HELD | 375 | zero credit |
| `POST /api/payroll-runs/[id]/close` | HELD | 375 | zero credit |
| `GET /api/payroll-runs/[id]/connected-impact` | HELD | 352 | zero credit |
| `GET /api/payroll-runs/[id]/explain/[employeeId]` | HELD | 375 | zero credit |
| `GET /api/payroll-runs/[id]/exports` | HELD | 375 | zero credit |
| `POST /api/payroll-runs/[id]/exports` | HELD | 340 | zero credit |
| `GET /api/payroll-runs/[id]/payout-reconciliation` | HELD | 375 | zero credit |
| `POST /api/payroll-runs/[id]/payout-reconciliation` | HELD | 340 | zero credit |
| `POST /api/payroll-runs/[id]/pilot-signoff` | HELD | 340 | zero credit |
| `POST /api/payroll-runs/[id]/process` | HELD | 365 | zero credit |
| `GET /api/payroll-runs/[id]/release-checklist` | HELD | 375 | zero credit |
| `POST /api/payroll-runs/[id]/release` | HELD | 365 | zero credit |
| `POST /api/payroll-runs/[id]/submit-review` | HELD | 365 | zero credit |
| `GET /api/payroll-runs/[id]/variance` | HELD | 375 | zero credit |
| `GET /api/payroll-runs/[id]/xendit-payout` | HELD | 340 | zero credit |
| `GET /api/payroll-runs` | HELD | 375 | zero credit |
| `POST /api/payroll-runs` | HELD | 340 | zero credit |
| `GET /api/reports` | CREDITED | 265 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136211984603) |
| `GET /api/self/contribution-evidence` | CREDITED | 90 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381318) |
| `POST /api/spend` | CREDITED | 179 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381511) |
| `PATCH /api/spend` | CREDITED | 179 | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/44713061008/job/136209381511) |
| `GET /api/year-end` | HELD | 219 | zero credit |
| `POST /api/year-end` | HELD | 219 | zero credit |
| `GET /api/payroll-runs/[id]/pre-run-readiness` | HELD | 375 | zero credit |
<!-- wage-renewal-v2:end -->

> **HISTORICAL #2005 PG16 RENEWAL — SUPERSEDED BY #2006:** The original 75 method receipts below remain authentic evidence for the previous payroll engine only. The modified #2006 engine invalidates their current-source status; all 75 affected methods are GAP / zero-credit until fresh verification. This document does not authorize production or restore credits.

# Fresh wage-source API credit renewals

SOLO_VERIFIED_DEV_RECOVERY. Before: 386 COVERED / 75 GAP. After: 461 COVERED / 0 GAP; 498 methods total, including 25 public and 12 privileged-token methods.

Execution: [42 successful jobs, run 43982852756](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756), exact source head `756934135ead375f9b9346844adf732764b407c5`. The later accounting commit is not represented as that execution head. Every runtime and HTTP proof input remains source-pinned; original withdrawals and receipts remain historical.

Existing synthetic CI profiles retain their actual flag settings and loopback providers. Local runs kept protected flags OFF. This is developer recovery evidence, not independent review or production/payroll/provider acceptance.

| Method | Result | Fresh executed evidence |
| --- | --- | --- |
| `PATCH /api/approvals/[id]` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436805) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436817) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436898) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436946) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437060) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437572) |
| `GET /api/auth/me` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437203) |
| `POST /api/automation-studio` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437431) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437230) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437335) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437147) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437348) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437385) + [PG16 7](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436876) + [PG16 8](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437414) |
| `POST /api/bir/annual-employer/candidate` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437243) |
| `GET /api/bir/annual-employer/module-evidence` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/bir/annual-employer/module-evidence` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/bir/annual-employer` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `GET /api/compliance/bank-validations/[id]/file` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `PATCH /api/compliance/bank-validations/[id]` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/bank-validations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/bank-validations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/bir-1601c-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/bir-1601c-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/calendar` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/contribution-issues/evidence` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/filing-validations/[id]/file` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `PATCH /api/compliance/filing-validations/[id]` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436924) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437275) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437467) |
| `GET /api/compliance/filing-validations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/filing-validations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `GET /api/compliance/government-loan-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/government-loan-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/labor-inspection/drills` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `POST /api/compliance/labor-inspection/drills` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `GET /api/compliance/labor-inspection/evidence-pack` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/labor-inspection` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `POST /api/compliance/labor-inspection` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437161) |
| `GET /api/compliance/payroll-month-close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `POST /api/compliance/payroll-month-close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437086) |
| `GET /api/compliance/remittance-actions` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437180) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437291) |
| `POST /api/compliance/remittance-actions` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437180) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437291) |
| `GET /api/compliance/remittance-month-close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/remittance-month-close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/statutory-remittance-corrections` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/statutory-remittance-corrections` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/statutory-remittances/posting-import` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/compliance/statutory-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/compliance/statutory-remittances` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437086) |
| `POST /api/compliance/validate` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `GET /api/dashboard` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/employees/import` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437225) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437350) |
| `GET /api/employees/import` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/employees` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/employees` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437225) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437350) |
| `PATCH /api/employees` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437225) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437350) |
| `POST /api/enterprise` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436987) |
| `GET /api/first-payroll/preview` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/hcm/governance-readiness` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/managed-payroll/runs/[id]/approve` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437285) |
| `GET /api/migrations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `POST /api/migrations` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437313) |
| `GET /api/payroll-runs/[id]/assurance` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/payroll-runs/[id]/close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/payroll-runs/[id]/close` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/payroll-runs/[id]/connected-impact` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436894) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437115) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437174) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437182) |
| `GET /api/payroll-runs/[id]/explain/[employeeId]` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/payroll-runs/[id]/exports` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/payroll-runs/[id]/exports` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437082) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) |
| `GET /api/payroll-runs/[id]/payout-reconciliation` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/payroll-runs/[id]/payout-reconciliation` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437390) |
| `POST /api/payroll-runs/[id]/pilot-signoff` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436797) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437550) |
| `POST /api/payroll-runs/[id]/process` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436805) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436817) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436898) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436946) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437060) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437572) + [PG16 7](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) |
| `GET /api/payroll-runs/[id]/release-checklist` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/payroll-runs/[id]/release` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436805) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436817) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436898) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436946) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437060) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437572) + [PG16 7](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) |
| `POST /api/payroll-runs/[id]/submit-review` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436805) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436817) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436898) + [PG16 4](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436946) + [PG16 5](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437060) + [PG16 6](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437572) + [PG16 7](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) |
| `GET /api/payroll-runs/[id]/variance` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/payroll-runs/[id]/xendit-payout` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436797) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437550) |
| `GET /api/payroll-runs` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `POST /api/payroll-runs` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436797) + [PG16 3](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437550) |
| `GET /api/reports` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
| `GET /api/self/contribution-evidence` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437040) |
| `POST /api/spend` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437285) |
| `PATCH /api/spend` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437285) |
| `GET /api/year-end` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436535) |
| `POST /api/year-end` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703436535) |
| `GET /api/payroll-runs/[id]/pre-run-readiness` | CREDITED | [PG16 1](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133703437360) + [PG16 2](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756/job/133709894888) |
