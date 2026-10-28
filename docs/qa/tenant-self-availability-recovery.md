# ESS employee availability GET and POST: supplementary tenant-isolation proof

**DRAFT / NO ACCEPTANCE / NO MERGE / ZERO NEW METHOD CREDITS.**

## Selection and existing work

At the initial selection point (historical `main@a7dc1f5184f59f3c5ac348e37b4ca88810f10651`),
the manifest listed **GET /api/self/availability** and
**POST /api/self/availability** as **GAP**. Since then, independently
integrated `main` has provisionally classified both as **COVERED**
using exact-source proof from PR #1455 (fictional PG16/localhost HTTP
run #40444843870). That is an existing, digest-pinned claim, **not** a
credit from this PR and not global or production acceptance. The canonical
`scripts/qa/tenant-self-availability-http.mjs` is restored byte-for-byte
from `main`, and its original `tenant-gap-promotion-pins.json` SHA-256
must continue to verify. All stronger checks are in the new separate
`scripts/qa/tenant-self-availability-recovery-http.mjs`; this PR does not
edit any previously pinned proof line or the coverage manifest.

The existing source-pinned canonical proof remains untouched. The dedicated
PG16 workflow executes the new supplemental file on a fresh disposable
database. The strengthened test does not replace or invalidate any already
credited evidence. A source edit alone does not establish additional coverage
or independent security/privacy acceptance.

## Real HTTP evidence to collect at the updated head

The extended job runs only on disposable PostgreSQL 16 at
127.0.0.1:5432/app_db, a clean local application, production-mode Next at
127.0.0.1:3000, fictional keys, and the isolated-only WFM availability flag.
Workers, scheduler, Xendit billing, payouts and overpayment review stay off;
the browser/UI flag stays off. A pre-import guard requires GitHub Actions,
explicit CI isolation, no demo mode, exact localhost URLs, fake worker token
and no live provider API keys.

- Two independently authenticated fictional **employee** attackers A/B.
  Their employers and source rules are genuinely persisted before requests.
  A separate victim employer owns a higher-ID worker and availability rule.
  The test also creates a separate employee peer and peer login in each
  attacker employer. Sessions use actual database-backed cookies.
- **Own GET 200**, including real employee-availability SQL row IDs and own
  notes, must match every own active source row and exclude both the victim
  and a different worker in the same employer. **Peer GET 200** must show only
  that peer's own persisted rule. Each GET must remain non-cacheable.
- **GET with forged employer/employee query parameters** returns **400**
  without changing any availability, workforce, audit or payroll rows.
- **POST create 201** must insert the exact new own-company and employee IDs,
  weekday, times, effective dates, type, notes and authenticated creator.
  Match HTTP ID to SQL INSERT. Exactly one audit row must have the correct
  actor, organization, employee and rule, and both no-roster/no-payroll flags.
  Older own/peer source rows and the other employer cannot change.
- **Duplicate POST create 409** and **POST remove with genuine victim,
  other-employer or same-employer peer rule IDs 409** must write nothing.
  Forged URL or JSON identifiers return **400**. All employers' source
  snapshots are compared after each denial rather than only at the end.
- **POST remove 200** deletes only the own new future rule, retains older
  own/peer source rows, records one matching withdrawal audit and makes the
  ID disappear from GET. This proves future deletion, not all withdrawal
  dispositions.
- **403 owner ESS access**, **403 forged victim employee-ID linked only to
  an attacker employer**, and **401 anonymous GET/POST** are exercised with
  real sessions. Denial responses reveal no private source fields.

Each employer snapshot covers availability, employees, memberships, payroll
runs, assignments, time punches, leave and business-content audit. The
original proof also retains real victim and peer snapshots. Actual localhost
HTTP and SQL are required; a mocked 201 or empty 200 is insufficient.
Adversarial source tests reject missing audit, wrong actors, private markers,
mutated payroll, unsafe caching, enabled providers and invented source data.

## Execution and limitations

Employee availability is a **preference**, not published roster, employee
consent, employer approval, shift guarantee, paid leave or payroll deduction.
No live provider or employer is used. The checks do not cover current-rule
closeout, historical rejection, 60+ row pagination, races, rate-limit
exhaustion, multi-entity delegation or downstream manager scheduling.
The feature remains default-off for production; test-only enablement is
not a rollout approval.

## Exact-head acceptance gates

- [ ] New and existing syntax and Node contract tests pass at exact SHA.
- [ ] Dedicated PG16 and real localhost HTTP job passes own/peer/victim proof.
- [ ] CI, CodeQL, security smoke, money isolation and other relevant jobs pass.
- [ ] Independent privacy/security reviewer checks tenant scope, identity,
      minimization, audit evidence, cache and race limits.
- [ ] Original SHA-256 pinned PR #1455 proof remains unchanged; no new manifest
      credits or silent downgrade of existing provisional COVERED statuses.
- [ ] A separate reviewed manifest reconciliation is required for any future
      new credit or status change.

**DRAFT / NOT ACCEPTED / DO NOT MERGE / NO COVERAGE PROMOTION.**
