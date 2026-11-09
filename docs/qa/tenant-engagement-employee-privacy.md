# Engagement Survey employee participation and privacy — independent follow-up

**Status: DRAFT / unaccepted, fictional PG16 proof only. Zero tenant page/action/API method credits, no production certification.**

This is the follow-up evidence missing from merged PR #1876. It adds only a
dedicated workflow, real-HTTP/SQL test runner, fail-closed assertions, unit
negative controls, and this runbook. **No existing application/UX code, API,
schema, production configuration, tenant-isolation manifest, shared CI gate,
financial code, or provider integration is modified.**

## Reviewed source scope and drift guard

The proof requires exact Git blob hashes for the following unchanged sources:

- `src/app/api/hcm/engagement-surveys/route.ts` — `8355956668eb8bdc0f767f9f72bd01992e964349`
- `src/lib/engagement-survey.ts` — `3cd87143f9a1be6d136a552ee4a3c4c4a0348057`
- `src/app/app/engagement/page.tsx` — `8ddecfc89f1f8b23deeaefa410c00f36b072922e`
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
