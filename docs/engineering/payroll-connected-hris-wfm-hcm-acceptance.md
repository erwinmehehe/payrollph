# Payroll-first HRIS / WFM / HCM connected impact — acceptance and rollout

**Release candidate:** draft PR #685. **Default: OFF. No salary, approval, payout, or statutory calculation mutation.**

## Intended behavior

For a company-wide, legal-entity-unspecified payroll run, an authorized payroll reviewer can see cutoff-scoped, read-only upstream evidence:

- **HRIS:** pending/scheduled/failed effective-dated worker changes, pending or inconsistent payout destination requests, and applied changes that occurred after the payroll run was opened.
- **WFM:** unresolved timekeeping exceptions, unapplied corrections, corrections applied after run creation, and the latest timesheet approval status for the exact cutoff. Existing timesheet policy and cutoff-lock gates remain authoritative.
- **HCM:** unresolved compensation proposals effective by cutoff end; effective-dated pay revisions inside cutoff; late/retroactive revisions created after payroll run creation; and whether an applied, explicitly approved compensation proposal references a matching employee/revision/effective date.

This does **not** establish that wages are correct or that an unknown source is unauthorized. Reviewers still use original HR, finance, timesheet, payroll and treasury approval records.

## Enabling / disabling

- Feature is disabled unless \`PAYROLL_CONNECTED_IMPACT_ENABLED=true\`.
- Without the flag, signed-in requests receive **204 No Content**; the client hides the panel. No extra evidence is loaded.
- Enable **only in an isolated test environment** after engineering, privacy, payroll and HR reviewers agree to the test. No production enablement merely because CI passes.
- Roll back immediately by unsetting the flag and revalidating HTTP 204. The endpoint is GET-only with no schema migration or write path; disabling must not alter payroll runs or source records.

## Required staging acceptance

Use a fresh **synthetic** tenant and payroll period. Do not put real workers, compensation, payout coordinates, bank details, statutory IDs, auth tokens, or secret keys into GitHub issues or logs.

| Test | Expected |
| --- | --- |
| Flag absent or \`false\`, signed-in viewer | HTTP 204; no response body; panel hidden |
| Anonymous request | HTTP 401; no evidence |
| Employee/non-payroll role | HTTP 403; no evidence |
| Different-tenant or unscoped run ID | HTTP 403/404; no cross-tenant findings |
| Branch-scoped run | HTTP 409; no misleading company-wide clearance |
| Entity-scoped run | HTTP 409; historical entity assignment remains unsupported |
| Valid company-wide run | HTTP 200; bounded, data-minimized counts/findings |
| Future-dated employment or compensation change | Not flagged for earlier cutoff |
| Overdue scheduled worker change | HRIS attention |
| Applied worker change after payroll-run creation | HRIS late-source attention; don't rewrite historical payroll |
| Pending payout change | HRIS attention, no account number exposed |
| Applied payout change after run creation | HRIS changed-payee attention; confirm bank-export snapshot |
| Pending attendance correction | WFM attention |
| Approved correction after run creation | WFM late-source attention; confirm stale timesheet and approval invalidation |
| Older approved timesheet + newer stale version | WFM attention for **latest** version |
| Older submitted timesheet + newer approved version | No obsolete-approval warning |
| Open attendance exception within cutoff | WFM attention/review by severity |
| Applied HCM compensation proposal and linked revision | Source-linked review; not automatically certified |
| Unlinked effective-dated revision | Source-verification review; do not infer misconduct |
| Backdated revision created after run creation | HCM late-source attention; recalculate/reapprove if required |
| >500 source rows | Incomplete indicator, no all-clear assertion |
| >60 aggregate findings | Truncated on screen with true total shown |
| Reopen/refresh for another run | No previous run's findings leak |
| Concurrent approval or time correction during fetch | Review is informational, not a locking guarantee; transaction-safe release gates still decide |

## No-GO boundaries

1. **Never use this endpoint as a substitute for** \`buildPayrollReleaseChecklist\`, payroll assurance, time/premium trace, workforce timesheet gate, or independent expected-payroll reconciliation.
2. No merge/activation without exact-head CI + independent developer/security/privacy/payroll reviewer approval and isolated staging role/tenant UAT.
3. PR #640/#669 retain the authoritative HRIS salary, hire, migration, bank-payee approval work; do not copy unapproved money-bearing source code into this read-only PR.
4. PR #667 migration train, #666 compensation/final-pay/loan integration and #668 payroll-engine loan validator remain separately gated. Do not apply staging/production SQL from these branches without authorized DBA reconciliation.
5. HRIS, WFM and HCM changes affecting *released* runs require the existing audited correction/retro/final-pay path; never rewrite released payroll.
6. First real-employer payroll pilot #579, production readiness #112, independent reviews and real bank/agency acceptance are **not complete** merely because a source review has no findings.

## Known remaining gaps

- Historical org-unit and legal-entity assignments are not reconstructed, so the endpoint rejects scoped runs. Extend only with versioned source evidence and tenant authorization proofs.
- Missing timesheet coverage is already handled by the authoritative configured timesheet gate; this advisory view reports submitted records but does not replace the missing-timesheet calculation gate.
- An applied compensation proposal link is not a substitute for evidence of source identity, approvals, budget control, final pay rate, or bank settlement.
- Query caps intentionally fail incomplete rather than silently omit additional rows; implement cursor-paginated reviewers only after authorization and performance acceptance.
- Review is a best-effort read, not a transactional input snapshot. To enforce release-level freshness, independently sign and compare the source-version manifest against the locked payroll calculation and checker approval inside a properly reviewed transaction.

**Do not market this as certified payroll integration before the independent real-data parallel-payroll evidence exists.**
