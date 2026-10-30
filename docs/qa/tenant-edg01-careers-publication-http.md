# EDG-01: careers-publication PATCH tenant isolation (review-only)

**DRAFT / NO METHOD CREDIT / NO PRODUCTION ACCEPTANCE / DO NOT DEPLOY.**

## Family and overlap boundary

This proof covers exactly **PATCH /api/careers/admin** in the EDG-01 public-careers
publishing control family. At the branch point it is **GAP** in
`scripts/qa/tenant-isolation-coverage-manifest.json`.

It is separate from open prior-evidence (#1609), PII approvals (#1607),
onboarding (#1612), Performance (#1602), workforce planning (#1610),
HCM decisions (#1615), and loan approvals (#1616). It changes **only five new
proof/workflow/doc files**. No application route, shared manifest, method
status, existing test, migration, schema, pay formula or live feature flag
is edited.

## Disposable real-HTTP acceptance candidate

The new
[`tenant-edg01-careers-publication-http.yml`](../../.github/workflows/tenant-edg01-careers-publication-http.yml)
job starts a fresh **PostgreSQL 16** container, applies the already-reviewed
isolated schema baseline, then rehearses the unchanged **unnumbered**
`careers-published.sql` proposal **only on that disposable database**.
This is not a numbered/applicable production migration or schema approval.
Next runs in production mode but binds only to `127.0.0.1:3000`.

The environment guard runs **before any database or app import**. It requires
the exact fictional localhost PostgreSQL target, `CI` and `GITHUB_ACTIONS`,
MFA and applicant-privacy feature gates, and an example.invalid-style
non-live test identity corpus. Payouts, workers, scheduler and provider
credentials must be disabled. The careers feature flag is enabled **only**
within this disposable job to exercise the guarded route; its normal
default-OFF production state is not changed.

The [source-pinned HTTP runner](../../scripts/qa/tenant-edg01-careers-publication-http.mjs)
creates three independent real employers, their owner sessions with verified
MFA, distinct job profiles, positions, requisitions and fictional applicants.
The victim is inserted **last**, with higher real employer, employee,
position and requisition IDs. Each employer also has real fictional draft
payroll source rows. Two attackers have independently signed-in own owners,
unit-scoped HR sessions and employee sessions.

Expected, but **not accepted until the new exact-head CI passes**:

- Each employer publishes its own open requisition, HTTP 200, with a real
  PostgreSQL `careers_published` column transition and exactly one
  correctly attributed audit event.
- Both attackers receive 403 for the real higher-ID victim employer, and
  409 for a **forged victim requisition under their own employer**.
  No victim marker or source mutation is allowed.
- Publishing a filled role and replaying a stale compare-and-swap decision
  are rejected with 409. Company-wide access is distinct from a valid but
  unit-only HR membership; unit HR, employee and anonymous actors cannot
  publish. MFA revocation is separately exercised on the actual owner session.
- Each attacker can legitimately unpublish its own prior published job;
  exactly one audit is appended. Duplicate unpublish is rejected.
- Every unsuccessful request is bounded by before/after complete fictional
  employer snapshots. Each successful request changes **only** the one owned
  publication flag and one employer-bound audit row; the other two employers
  remain byte-identical.
- Tenant organizations, units, employee/pay profiles, job profiles,
  positions, applicant rows, memberships and **nonempty draft payroll
  sources** remain unchanged throughout every publication transition.
  No actual pay run, transfer, posting, provider or statutory filing occurs.

The unit contracts intentionally reject a mutated second job, a changed
payroll row, a forged audit actor, wrong denial statuses, external DB targets,
production flags, and a manifest credit without separate acceptance.

## Required gates and limits

- [ ] Verify all source contracts, syntax, complete exact-head CI and security checks.
- [ ] Verify the specific PG16 real-HTTP log contains
      `EDG01_CAREERS_PUBLICATION_REAL_HTTP` with 3 owned publishes,
      2 owned unpublishes, 18 denied controls and zero mutation/leaks.
- [ ] Obtain independent HR/privacy/security and coverage-owner review.
- [ ] Reconcile the still-GAP method and credit separately, only after
      real evidence, flag/migration approval and no conflicts with other PRs.
- [ ] Obtain a separate production DPO/privacy notice, proposed SQL migration,
      public recruiting activation and deployment approval.

**Coverage credits: 0.** This is a bounded careers-publication proof, not
public careers GET/POST, an accepted real customer, a production recruitment
launch, a tenant-wide security certificate, or permission to move money.
