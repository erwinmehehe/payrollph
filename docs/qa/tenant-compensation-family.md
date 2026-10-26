# Compensation: independent, pending HTTP scenarios

This main-based family has no method overlap with People/platform #1402 or Workforce
operations #1409. It reuses the existing disposable PostgreSQL/localhost HTTP runner.

| Method | Exercised action | Acceptance boundary |
| --- | --- | --- |
| POST compensation | Create an unassigned allowance component definition | Exact own employer, creator, code/name, frequency and statutory treatment; one actor-bound audit; no worker assignment |
| PATCH compensation | Decline a proposed salary recommendation | Exact returned proposal/worker/band/cycle; decline actor/time and audit; amounts and other fields retained; no scheduling/application |

Each runs with two independent attackers and a real higher-ID victim, exact foreign
denial, discriminatory positive state evidence and unchanged victim database/audit.
PATCH derives employer ownership from the actual proposal ID; it must reject the
victim ID even without a body organizationId. POST creates no referenced resource,
so its foreign control uses the real victim employer rather than an invented ID.

Fixtures use an inactive salary band, draft zero-budget cycle, fictional proposed
recommendation and the existing worker pay profile. No review approval, pay revision,
component assignment, payroll release, provider or notification action is requested.
Before/after snapshots preserve worker, pay profile/revision, compensation events,
component assignments, bands/cycles, HCM reviews and payroll-run records. Existing
audit business fields are retained; only the shared sealer normalization applies.

Negative unit tests exercise the actual row expectations with foreign/no-op/swapped
responses, missing/tampered audits, changed pay/review state and altered proposal
amounts or application fields. They are regression checks, not HTTP acceptance.

Both methods remain **GAP**, with **zero new credits**. POST has other branches
(bands, cycles, assignments, proposals); PATCH has other decisions and assignment
actions. These scenarios cannot establish complete method coverage. Actual
exact-head default HTTP/PostgreSQL logs and all three profile jobs must pass before
claiming these bounded actions executed. Record the resulting run/head separately;
local tests alone do not establish tenant isolation or production readiness.

No production SQL, Neon operations, feature/money flags, runtime routes, permission
guards, audit guards or provider settings change. Do not auto-merge.
