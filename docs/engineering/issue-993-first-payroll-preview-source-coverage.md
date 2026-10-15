# Issue #993 — first-payroll preview source coverage (engineering checkpoint)

**Status: source-scope hardening, not canonical complex-pay parity or release approval.** Updated 2026-10-15.

The GET-only preview runs inside a `REPEATABLE READ, READ ONLY` transaction and receives only a `select` database capability. It still invokes the existing `calculateEmployeePay` for **simple monthly** workers only; it does not clone gross/net, SSS, PhilHealth, Pag-IBIG or withholding formulas. Any complex inputs must remain **amount-null** until their exact worker-specific canonical payroll context is assembled and independently compared to an unreleased canonical run.

## Current source parity boundary

| Canonical payroll worker reads | Preview behavior on this branch |
| --- | --- |
| Active employee cohort, legal employer, pay profiles, payroll calendar and statutory rule pack | Shared calculation path for otherwise genuinely simple monthly workers; multi-legal-employer mode refuses reads |
| Punches, attendance corrections, overtime requests, work schedules/overrides, worksite assignments, rest-day revisions | Scoped by organization + selected worker + relevant cutoff/effective window; **blocks affected worker**, never invents premiums |
| Pay revisions, recurring/supplementary earnings, retro and year-end adjustments | Scoped by organization + selected worker, with available effective dates; **blocks affected worker**, not yet a canonical projection |
| Approved leave, conversions, loans, advances, expense claims, benefit enrollments, de minimis and historical/MWE evidence | Scoped by organization + selected worker; **blocks affected worker** pending the normal worker inputs, lookbacks and approved-period reconciliation |
| Employer policies, local holiday calendar, calamity advisories, previous payroll runs | Conservative company-wide blockers; these can influence employees, prior cutoffs or global review state |
| Bank/provider instructions, filing, approvals, payroll entries, audit writes | Not executed or previewed; endpoint remains GET only and read-only transaction enforced |

**Improvement:** An unrelated worker's loan, pay revision, time punch or benefit no longer hides an otherwise simple worker's figures. The response is **not** `previewReady` while any worker is blocked. Each affected worker has money fields `null` and a named source category. Future-dated records outside the supported window do not become current earnings. A missing SQL relation or incompatible schema fails the entire read, never a partial assumed calculation.

**Still open for #993:** factor the canonical payroll worker's full read-side input assembler out of `processPayrollChunk`; preserve exact tenant/legal-entity/worker/period scoping, effective scheduling and monthly prior-cutoff statutory history; prove WFM locks/approval states, five diverse fictional workers, preview-versus-unreleased canonical calculation with zero centavo difference, no writes, desktop and 375px/390px mobile recovery. This source-only step **does not** mark the checklist, #993, #853, #691 or #579 accepted and does not enable a feature flag or authorize migration, payout or agency submission.
