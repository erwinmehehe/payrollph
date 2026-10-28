# Executed employee self-service development plan recovery

Three GAP methods share one family: GET/POST/PATCH
`self/performance/development-plans`. No open PR owns this family at selection.
Main already contains an uncredited, prepared ESS development scenario; this
batch preserves its source and negative tests, consolidates its existing PG16
workflow, and extends the active proof with private/closed plans, full returned
record comparison, both supported milestone transitions, null/numeric progress,
revoked membership, and real mutation discrimination. It does not register
duplicate table rows or create a second CI workflow/build.

## What runs

The existing guarded local tools create an empty fictional database and launch
production-mode Next on localhost. The extended runner seeds two independent
employee attackers and a higher-ID victim employer, with real skills, plans,
milestones, historical progress and same-employer peers. No fake foreign ID or
empty result can pass. A separate account intentionally linked to the victim
worker without victim membership must also be refused.

- GET returns the exact own employee's populated visible plans, skills,
  milestones and historical progress. Private plans and peer plans must stay
  absent. Forged employer/employee query selectors cannot override the cookie.
  A real victim employee's own GET separately succeeds.
- POST persists exactly one own-authored progress record and exact audit for
  numeric and null progress. Forged body identity/author fields cannot move that
  write to the victim. Source plans, employees, pay profiles and payroll stay
  unchanged.
- PATCH runs `in_progress` and `completed` on the real own milestone, preserving
  immutable fields and checking exact completion author, timestamp and audit.
- Both attackers receive exact denials for foreign/peer IDs, hidden plans,
  completed/cancelled plans, reopening completed milestones, invalid progress,
  anonymous sessions, owner impersonation, stolen employee links, and revoked
  membership: 48 denied requests total. Every denial compares both employers'
  actual target-table and audit snapshots. Final victim source/core snapshots
  must match before and after the entire proof.
- All three method validators reject the other attacker's actual successful
  response or database delta. A deliberately empty POST validator must fail the
  actual HTTP run with `POST proof accepts another employer's data`.

The local source-bound receipt records actual PostgreSQL engine metadata and
successful counts. Local PostgreSQL 18.6 evidence is not PG16 CI evidence. The
original local DB is restored using its exact initial parked name, preserving
the fictional evidence database without dropping either database.

## Credit and acceptance

Only the canonical `tenant-table-credit.mjs --self-development` entry point
writes these three credits and recomputes manifest/inventory totals. It validates
the executed receipt, every source hash, exact method set, mutation failure and
all read/write/denial/discrimination counts first. `--check` is non-mutating.
All unselected methods and their proof provenance must be identical to main.

The receipt and generated credits are **provisional**, pending the exact-head
PostgreSQL 16 HTTP job and normal CI/security/reviewer acceptance. No production
SQL, Neon/Vercel operations, provider calls, mail, financial release flags,
authorization guards or application routes are changed. A draft PR is not global
tenant-isolation or payroll release approval.
