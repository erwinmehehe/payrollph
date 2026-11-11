# Engagement Survey employee participation and privacy — independent follow-up

**Status: DRAFT / unaccepted, fictional PG16 proof only. Zero tenant page/action/API method credits, no production certification.**

This follow-up builds on merged PR #1876 and adds a **production authorization fix** for cross-employer employee identity confusion: an employee membership by itself can no longer expose survey questions unless the signed-in account's current employee record belongs to that employer. The existing fictional PG16 real-HTTP suite now covers the adversarial case. No schema, feature flags, tenant credit ledger, shared CI gate, financial code, or provider integration is modified.

## Reviewed source scope and drift guard

The proof requires exact Git blob hashes for the following unchanged sources:

- `src/app/api/hcm/engagement-surveys/route.ts` — `0440db4fb597953281769f154d73ad982f7c8efe`
- `src/lib/engagement-survey.ts` — `3cd87143f9a1be6d136a552ee4a3c4c4a0348057`
- `src/app/app/engagement/page.tsx` — `48132ee7356603136d7ac660086b3812ef28ed94`
- `src/lib/tenant-engagement-employee-scope.ts` — `6af77a09cb178b2d6111bb875ca21c722db5ac15`
- `src/components/engagement-survey-page.tsx` — `28bbb0fc7c7fe172301af414079c81182552177f`

If any reviewed source changes, the dedicated unit and HTTP proof jobs fail
until the new source is independently inspected and repinned. No silent
attribution of an older green receipt to changed source is allowed.

## Fictional-only HTTP evidence

The dedicated exact-head Actions job builds against a **fresh, empty,
localhost-only PostgreSQL 16** database and runs production-mode Next.js on
`127.0.0.1:3000` with **only ENGAGEMENT_SURVEY_ENABLED=true**.
Every other critical worker/payroll/provider flag remains off. An environment
guard rejects hosted DB URLs, credentials, non-CI execution, disabled MFA
policy, and real providers *before importing any app or DB modules*.

The runner creates three separate, genuinely persisted employers with
distinct authentication sessions and markers. Every employer gets one open
survey, six staff rows, six linked ESS employee accounts and an owner session.
The third employer is an actual higher-ID victim, not a fabricated ID or
a missing-record 404. The first two employers each prove successful own
employee SSR and GET/POST activity.

## New production tenant boundary

Before this change, employee access to the engagement-survey GET and the SSR
page required an active selected-employer membership and merely a non-null,
positive global `users.employee_id`. Those separate facts did not establish
that the employee record belonged to the selected employer. An employee
account linked to Employer A but with an active employee-role membership in
Employer B could receive B's survey question/status over GET and mount its
SSR client shell. The POST answer path had a deeper same-employer worker
check at the database write, but the route's gate was inconsistent.

The added `employeeBoundToEngagementEmployer` function joins the authenticated
current account, an active employee-role membership in the selected employer,
and the actual employee record **in that same employer**. A contradictory
non-null membership worker link also denies. GET, POST answer and SSR invoke
this same fail-closed binding. This is **not** a claim of a known externally
exploited production leak or an approved general permission grant.

The real adversarial test inserts an additional **active B membership** on a
genuine signed-in worker of A while B has a real, distinct employee directory
and survey. It first proves the account remains authenticated. B's survey GET
returns 403, B's SSR page returns 404, and B's survey answer returns 403;
no B or higher-ID victim marker leaks and SQL snapshots for all employers
remain unchanged. The same account still passes A's legitimate own survey
reads and submissions. No missing-row 404 or mock-only case is counted.

Covered positive and negative controls:

- Real linked employee sessions mount `/app/engagement` and see only
  their own survey and their own `submitted` flag. The owner has no
  employee-participation flags.
- Nine real employee ratings are committed via the HTTP answer action:
  four in the first employer, five in the second. Each answer updates only
  that survey's aggregate count/sum and inserts one participant ID row
  containing no rating. SQL snapshots verify no other personnel, payroll,
  audit, outbox, employer or survey records change.
- Repeat answers, invalid scores, employee attempts under another employer
  selector, real other-employer survey IDs, unauthorized owner-as-employee,
  unlinked employee accounts, anonymous and cross-site callers all deny
  without modifying the protected SQL snapshots.
- Private HTTP GETs and SSR deny real foreign-employer selectors. A revoked
  employee membership denies GET/POST/SSR **while the employee account
  remains signed in**.
- The five-answer survey remains hidden **while open**. After an authorized
  audited close, four responses remain **suppressed**; the other employer's
  closed five-response survey reveals only the count and aggregate average.
  All private reads require no-store cache control and contain neither
  respondent IDs nor raw counts/sums or individual scores.
- A successful close changes only the specific survey status/timestamp
  and appends exactly one own-employer audit record. A duplicate close
  and post-close answer are denied without additional changes. The
  higher-ID victim survey, participants and audit log remain unchanged.

## Explicit limits and review gates

This proof tests the **answer POST action plus close for the bounded privacy
lifecycle**, not complete `POST /api/hcm/engagement-surveys` coverage
(create and other applicable sequences need separate review). It does not
execute browser client hydration, interactive form taps, responsive UI,
accessibility review or employee consent/communications-policy review.
Participation entries carry an employee ID for replay prevention, even
though **per-person ratings are not stored**; the service must not be marketed
as fully untraceable participation. The work does not assess inference risks
from repeated aggregate release patterns in larger organizations.

- [ ] Exact-head fictional PG16 HTTP job and broad CI green
- [ ] Independent security/privacy reviewer verifies employee-role scope,
      linked worker identity, audit/aggregate behavior and negative controls
- [ ] Browser interaction and responsive UI accepted separately if required
- [ ] Data-protection stakeholder approves anonymous-score/participant-data
      wording, retention, consent and aggregate disclosure
- [ ] Only after every method/page condition is accepted, decide whether any
      GAP status can be changed in a **separate approved ledger PR**; none
      is promoted here
- [ ] No production feature activation or merge without the required human
      review; leave default-off flags unchanged

Rollback: close/revert this self-contained evidence PR. The existing
product code and feature flags remain unchanged.
