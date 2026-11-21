<!-- wage-renewal-v2:start -->
# Wage-source API renewal v2 (per-method source closures)

SOLO_VERIFIED_DEV_RECOVERY. 498 methods = **379 COVERED + 25 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 82 GAP**. 0 of 75 methods CREDITED from one fresh run; 75 remain zero-credit holds.

Execution: [run 44740145138](https://github.com/erwinmehehe/payrollph/actions/runs/44740145138), 42 successful jobs at exact source head `c5f9b8439a6a9f22742330b60da59fa50879787a`. Receipt: [`wage-registry-renewal-receipt-v2.json`](../../scripts/qa/wage-registry-renewal-receipt-v2.json) (27 global pins; one closure per method).

A later change withdraws only the methods whose own closure or the global base contains the changed file: run `node scripts/qa/wage-registry-renewal-v2.mjs --withdraw-drifted` (zero credit) and commit the result.

| Method | Result | Closure files | Fresh executed evidence |
| --- | --- | --- | --- |
| `PATCH /api/approvals/[id]` | HELD | 216 | zero credit |
| `GET /api/auth/me` | HELD | 177 | zero credit |
| `POST /api/automation-studio` | HELD | 317 | zero credit |
| `POST /api/bir/annual-employer/candidate` | HELD | 217 | zero credit |
| `GET /api/bir/annual-employer/module-evidence` | HELD | 261 | zero credit |
| `POST /api/bir/annual-employer/module-evidence` | HELD | 261 | zero credit |
| `GET /api/bir/annual-employer` | HELD | 187 | zero credit |
| `GET /api/compliance/bank-validations/[id]/file` | HELD | 254 | zero credit |
| `PATCH /api/compliance/bank-validations/[id]` | HELD | 255 | zero credit |
| `GET /api/compliance/bank-validations` | HELD | 255 | zero credit |
| `POST /api/compliance/bank-validations` | HELD | 255 | zero credit |
| `GET /api/compliance/bir-1601c-remittances` | HELD | 254 | zero credit |
| `POST /api/compliance/bir-1601c-remittances` | HELD | 254 | zero credit |
| `GET /api/compliance/calendar` | HELD | 255 | zero credit |
| `GET /api/compliance/contribution-issues/evidence` | HELD | 257 | zero credit |
| `GET /api/compliance/filing-validations/[id]/file` | HELD | 255 | zero credit |
| `PATCH /api/compliance/filing-validations/[id]` | HELD | 218 | zero credit |
| `GET /api/compliance/filing-validations` | HELD | 258 | zero credit |
| `POST /api/compliance/filing-validations` | HELD | 188 | zero credit |
| `GET /api/compliance/government-loan-remittances` | HELD | 257 | zero credit |
| `POST /api/compliance/government-loan-remittances` | HELD | 257 | zero credit |
| `GET /api/compliance/labor-inspection/drills` | HELD | 203 | zero credit |
| `POST /api/compliance/labor-inspection/drills` | HELD | 203 | zero credit |
| `GET /api/compliance/labor-inspection/evidence-pack` | HELD | 272 | zero credit |
| `GET /api/compliance/labor-inspection` | HELD | 196 | zero credit |
| `POST /api/compliance/labor-inspection` | HELD | 186 | zero credit |
| `GET /api/compliance/payroll-month-close` | HELD | 201 | zero credit |
| `POST /api/compliance/payroll-month-close` | HELD | 194 | zero credit |
| `GET /api/compliance/remittance-actions` | HELD | 82 | zero credit |
| `POST /api/compliance/remittance-actions` | HELD | 82 | zero credit |
| `GET /api/compliance/remittance-month-close` | HELD | 256 | zero credit |
| `POST /api/compliance/remittance-month-close` | HELD | 256 | zero credit |
| `GET /api/compliance/statutory-remittance-corrections` | HELD | 262 | zero credit |
| `POST /api/compliance/statutory-remittance-corrections` | HELD | 262 | zero credit |
| `POST /api/compliance/statutory-remittances/posting-import` | HELD | 257 | zero credit |
| `GET /api/compliance/statutory-remittances` | HELD | 254 | zero credit |
| `POST /api/compliance/statutory-remittances` | HELD | 176 | zero credit |
| `POST /api/compliance/validate` | HELD | 186 | zero credit |
| `GET /api/dashboard` | HELD | 307 | zero credit |
| `POST /api/employees/import` | HELD | 187 | zero credit |
| `GET /api/employees/import` | HELD | 267 | zero credit |
| `GET /api/employees` | HELD | 272 | zero credit |
| `POST /api/employees` | HELD | 192 | zero credit |
| `PATCH /api/employees` | HELD | 192 | zero credit |
| `POST /api/enterprise` | HELD | 182 | zero credit |
| `GET /api/first-payroll/preview` | HELD | 287 | zero credit |
| `GET /api/hcm/governance-readiness` | HELD | 255 | zero credit |
| `POST /api/managed-payroll/runs/[id]/approve` | HELD | 178 | zero credit |
| `GET /api/migrations` | HELD | 198 | zero credit |
| `POST /api/migrations` | HELD | 193 | zero credit |
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
| `GET /api/reports` | HELD | 265 | zero credit |
| `GET /api/self/contribution-evidence` | HELD | 90 | zero credit |
| `POST /api/spend` | HELD | 179 | zero credit |
| `PATCH /api/spend` | HELD | 179 | zero credit |
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
