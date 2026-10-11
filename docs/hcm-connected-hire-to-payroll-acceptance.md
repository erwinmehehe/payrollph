# PayrollPH HCM: Connected Hire-to-Payroll Acceptance

**Status:** Engineering test and protected-staging plan. No production rollout, payroll certification, real employer sign-off, or bank/government acceptance is implied.

**Integration candidate:** #817 leave SQL security and #825 People Home → Worker 360 are merged. Source-minimized payroll input review #827 remains separately gated. The synthetic cross-source trace is tracked in #833.

## Product acceptance objective

An authorized company-wide HR operator selects a legal employer, follows an outstanding onboarding item from People Home to the **same worker** in People / Employee 360, checks the associated onboarding workflow, and opens the read-only hire-to-payroll input review. That review must expose only source presence and explicitly unresolved work—not issue pay approval or change any payroll, employment or bank source record.

Authoritative sequence (not a duplicated writable HCM ledger):

1. Approved position, requisition, candidate and governed hire business process in **Planning / Recruitment**.
2. Effective-dated worker, job/position, manager, org unit and employment history in **HRIS / Employee 360**.
3. Worker onboarding tasks in **Provisioning**, with updates audited by the existing tenant/unit/RBAC-checked PATCH.
4. Source presence for current worker status, pay basis/rate/work hours, government identifier fields, payout field presence and rest-day baseline in **read-only evidence review**.
5. Period-specific schedule, punch, exceptions, approved leave, pay rules and statutory computation through **WFM / Payroll**.
6. Separate checker decisions, payroll release, bank settlement and government filing receipts in governed **Payroll / Compliance**.

Steps 4 and 5 must never infer that approval in step 6 occurred.

## Automated evidence

- `tests/hcm-people-home-tenant-integration.test.ts`: role/permission gate, explicit legal employer, source-bound link and non-leakage.
- `tests/hcm-people-employee-focus.test.ts`: malformed IDs, changed employer, stale employee roster, demo and denied roles.
- `tests/hcm-hire-payroll-review.test.ts`: default-off allowlist, controlled evidence labels, missing/partial source handling, absence of payroll-authorizing outcomes.
- `tests/hcm-hire-payroll-review-tenant-integration.test.ts`: synthetic two-employer pay profile/checklist/source refresh, no raw salary/ID/account output.
- `tests/hcm-connected-worker-payroll-handoff-db.test.ts`: one source task through People Home → Worker 360 link → review model; completing it changes read-model state but does not create payroll.
- Existing hire business-process, effective-dated worker, schedule/leave, payroll golden and post-merge browser suites retain authority for their own state transitions.

Run against isolated PostgreSQL 16 and the **exact combined SHA**: TypeScript, pinned lint, full `npm test`, statutory/employee/lifecycle/Pay Rules goldens, Next production build, browser QA, CodeQL, security smoke and payout isolation. A PR's green check from an older SHA is not enough.

## Protected staging walkthrough (required before pilot)

| Scenario | Required observation |
| --- | --- |
| HR admin Employer A with authorized worker | A's task links to A's Employee 360 and A-only review; no foreign records |
| Same local staff number in Employer B | Explicit B context required; A's worker ID and task ID cannot resolve in B |
| Manager, employee, checker, payroll, bookkeeper, unit HR | No employer-wide HCM operational or payroll-input review access |
| Company-wide HR with deny-only People permission set | Access denied before any worker source read |
| Missing worker or malformed employer/worker query | Fail closed, no worker existence indicator |
| Onboarding open → task marked done in source | Follow-up disappears on refresh; input view notes recorded only, **not verified** |
| Missing pay profile, ID or payout field | Source status is needs review, never implicitly ready |
| More than 25 onboarding tasks | Partial preview, even if sampled tasks are all complete |
| Source DB outage, stale snapshot or rapid employer switch | Unavailable/retry or correct new employer; never 0/all-clear on failure |
| As-of position/job change and leave/attendance cutoff | Source-effective dates are honored and not derived from mutable current records |
| Recorded compensation recommendation | No automatic pay revision until independent governed review and approval |
| Approved payroll, external filing or bank evidence absent | Remains **not assessed** and never tagged paid, accepted or released |
| Accessibility: keyboard, zoom, screen reader, mobile | Real protected-staging browser walkthrough, no private data in trace |
| Rollback | Disable **server** feature flag and re-check direct route denial; navigation flag alone is insufficient |

## External gates and human sign-off

The organization must provide independent HR, payroll and security acceptance on protected synthetic staging, then separately satisfy `PILOT_GATES.md` for any real employer: independent payroll reconciliation, government outputs/agency receipts, bank positive/negative/reversal UAT, witnessed DR rehearsal and named release authorization.

Record evidence privately with: source commit SHA, deployment SHA, selected synthetic employer IDs, reviewer role, negative access results, screenshots without PII, issue list, observed browser results and dated HR/security reviewer signatures. Do not store account numbers, employee identifiers, tokens or raw wage data in GitHub.

**Current release disposition:** Not production approved. Source merge, CI success, protected staging acceptance and real employer GA evidence are four separate stages.
