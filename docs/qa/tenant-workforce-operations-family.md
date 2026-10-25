# Workforce operations: eight pending method proofs

This independent main-based batch does not duplicate the People/platform #1402,
HCM #1404 or Performance growth #1406 methods. All eight remain GAP until actual
HTTP/PostgreSQL proof. Local assertion tests are not coverage credit.

| Method | Bounded own scenario |
| --- | --- |
| POST workforce/schedules | Create a shift definition; do not publish an employee roster |
| POST workforce/overtime | Create a pending pre-approval request |
| POST workforce/attendance-corrections | Create a pending timestamp correction; preserve the punch |
| POST workforce/coverage | Record an employee preferred-availability rule |
| POST workforce/schedule-swaps | Request a swap using real seeded pattern assignments; preserve assignments/overrides |
| POST workforce/schedule-guardrails | Create a disabled advisory policy and actor-bound audit |
| GET workforce/roster-rules | Read a distinct configured policy, not fallback defaults |
| POST workforce/roster-rules | Create a disabled advisory policy and actor-bound audit |

The existing family loader and runners execute two independent attackers against
a higher-ID victim. Own proofs bind response IDs to persisted employer, actor and
domain values. Forged foreign employee, punch and counterparty references must be
refused where applicable. The shared acceptance gates retain discrimination and
unchanged victim target/database/audit state. Audit comparison removes only the
existing three audit-sealer chain fields; every business field remains protected.

Correction proof checks both original/proposed snapshots and unchanged punches.
Swap proof checks both pattern assignments, actual shift IDs/codes/segments and
unchanged assignments/overrides; no swap is approved or applied. Overtime remains
pending. Policy responses intentionally omit row/employer identity; they must match
the scoped persisted policy and its exact signed-in actor/audit metadata instead.
Configured roster thresholds differ per employer, rejecting foreign/default reads.

The roster GET/POST run only in the synthetic flagged profile with
`WFM_ROSTER_SCALE_RULES_ENABLED=true`. Both policies are stored inactive/advisory.
The default profile remains flag-OFF and runs the other six methods. Production
configuration, money flags, scheduler, providers, payroll calculation, legal limits,
authorization/audit guards and application routes/schema are unchanged. This is
bounded method evidence, not every scheduling branch, employee role or multi-entity
publish approval.

Before credit: inspect exact-head real HTTP/PostgreSQL logs for the default and
flagged rows and all three profiles, fix failures, add reviewable executed credits
in this PR and require fresh final-head CI. Link-only refresh must add zero credits.
This PR is not authorized for automatic merge.
