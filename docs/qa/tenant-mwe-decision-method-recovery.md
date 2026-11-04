# PII-02 MWE classification PATCH: isolated tenant recovery candidate

**Review state:** DRAFT / PROVISIONAL METHOD CREDIT ONLY / NOT ACCEPTED.
The single proposed method is `PATCH /api/employees/[id]/mwe-classifications/[classificationId]`.
This is not the transfer/profile batch, workforce staffing-policy family or public API catalog.

## Source-identified problem

The previous handler selected a globally addressed classification before establishing an active
membership, returning 403 on a real foreign ID and 404 for an unknown ID, which may reveal
record existence. It enforced organizational roles and units but omitted the independently
selected legal-employer boundary in multi-entity mode. The classification decision transaction
also did not recheck employer attribution while holding the employee row lock.

## Containment

- Join the target classification to an **active membership** before inspecting its employee.
  Nonexistent and foreign IDs return identical private/no-store 404 replies.
- Resolve the authenticated legal-employer context and reject unrelated legal employers
  before MFA, rate-limited business decisions and any audit or payroll mutation.
- Inside the serializable decision path, hold the employee row with `FOR SHARE` and
  recheck that its current legal employer equals the authorized selected employer.
  Feature-OFF legacy behavior remains unchanged.
- Do not change the sibling MWE GET/POST credits, approve other financial actions, or
  activate production payroll, statutory filing, payout or provider operations.

## Required executable evidence

The new isolated CI workflow runs in production Next.js mode against disposable localhost
PostgreSQL 16 with no payout, billing, worker, scheduler or provider secrets. It seeds two
independent signed-in owner employers and a real higher-ID third victim, each with current
employees and pending MWE tax requests. Both owners must successfully approve and reject
their own seeded records (four real positive HTTP 200 responses). Both must receive the
same 404 for the victim's real classification and a missing classification. Forged employer
selectors, a second ungranted legal employer in the same organization, and revoked
membership must fail. The victim's classifications, employees, payroll, memberships, grants
and audit SQL snapshots must be unchanged after all attacks.

Only a **provisional** one-method PII-02 COVERED classification is proposed.
A passing exact-PR-head PostgreSQL 16 real-HTTP job, all repository CI/security gates,
an independent security reviewer, and method-specific owner approval are required
before counting it as accepted. 17 page/action gaps remain; no tenant-wide acceptance.
