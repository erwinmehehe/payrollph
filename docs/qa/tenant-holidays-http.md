# Holiday Calendar — four isolated tenant-boundary methods

**Candidate GAPs:** GET, POST, PATCH, DELETE /api/holidays (all four methods remain
GAP in the authoritative manifest). **No methods credited in this PR.**

This batch is independent of open Invitation, Careers, ESS documents and
identifiers, HMO, Performance Governance, Leave Preview, Offline Attendance
Claims, Payroll Overpayment, HCM Skills/Development, Automation Studio and
API v1 Journal PRs. Its five files are entirely new and do not change their
test runners, the application, migrations, manifest or production configuration.

## Synthetic authenticated PostgreSQL 16 acceptance

1. Verify exact CI-only environment **before importing app/DB modules**.
   Require fresh, empty disposable PostgreSQL 16 app_db on
   127.0.0.1:5432 and production-mode Next on 127.0.0.1:3000.
   Reject external provider credentials, worker/scheduler and payout
   activation, cross-tenant/multi-entity mode or non-ephemeral configuration.
   Only fictional holiday dates in **2040** are used.
2. Create three real employers in attacker A, attacker B, then higher-ID victim
   order. Each has a real owner session (MFA-marked), a unit-scoped HR session,
   two distinct units and worksites, an employee, one Released fictional
   payroll run with a persisted payroll entry, and one Queued payroll run.
   Both roles must be genuinely authenticated, not mocked route calls.
3. Seed four distinct persisted holidays **per employer**, plus a separate
   read-only system/national holiday: company-wide, authorized local unit,
   hidden peer unit, and a busy-payroll-period holiday.
4. GET must return the exact nonempty owner-only holiday IDs and fields.
   Unit-scoped HR must see company-wide and own-unit events only, never the
   same-employer peer worksite/unit or any other employer. Read-only requests
   must not alter SQL employer, holiday, payroll, approval or audit snapshots.
5. Both attackers must fail on GET and POST selecting the real victim
   employer (403), POST or PATCH stealing the victim's existing org-unit
   or worksite IDs (422), PATCH or DELETE using the higher-ID victim
   holiday (403). Every denial must leave all three employer snapshots
   and national holiday unchanged. Any victim marker in denial response
   body or headers fails acceptance. Anonymous GET must be 401.
6. Both unit-scoped HR accounts must be denied POST/PATCH/DELETE (403)
   even against their actual employer and its real holiday IDs. PATCH and
   DELETE of system/national holidays must be 409 and preserve the row.
7. For each of the three genuine owners, POST a real fictional event (201),
   PATCH just that row's name, date and kind (200), then DELETE it (200).
   Every change must be persisted with exactly one matching owner/employer
   audit, and no other holiday in that or any other employer may change.
   Between changes, GET must reflect current rows. A fake success response
   with no persisted row/audit change is not proof.
8. Every allowed change in the Released synthetic period must leave
   all payroll run and payroll entry fields untouched, with a correct
   releasedPayrollRunIdsRequiringRetroReview audit marker. Deny
   POST/PATCH/DELETE overlapping the separate Queued period with 409;
   no payroll state, approvals or audit may change.
9. Dedicated pure tests reject empty GET successes, wrong tenant/worksite,
   hidden peer markers, leaking 403s, no-op writes, audit omissions,
   collateral holiday/employee mutations, missing retro-review signals,
   and alterations to synthetic payroll fields.

## Run and review gates

The dedicated GitHub Actions workflow checks source syntax and 20 pure tests,
sets up isolated PostgreSQL 16, builds production-mode Next, then runs the
actual session-cookie HTTP harness. It must pass on the **exact PR head**.
It does not require or start any real payroll, disbursement, statutory filing,
government integration, applicant processing or outbound provider action.

- [ ] Exact-head source syntax, 20 pure tests and dedicated PG16 HTTP job green.
- [ ] Related repository CI, security HTTP smoke and CodeQL green.
- [ ] Independent reviewer verifies real DB IDs, actor/role permissions,
      scope boundaries, audit proofs, unchanged victim and payroll snapshots.
- [ ] Separately accept and reconcile **each method** in the manifest.
      This PR intentionally does **not** update its GAP statuses.
- [ ] Release/deployment/financial workflows remain independently gated.

**DRAFT / NOT ACCEPTED / ZERO COVERAGE CREDITS / NO PRODUCTION DEPLOYMENT /
NO REAL PAYROLL OR MONEY MOVEMENT.** Tests are fictional and do not constitute
general tenant-isolation certification for the entire product.
