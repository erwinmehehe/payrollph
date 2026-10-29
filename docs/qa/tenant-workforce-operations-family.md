# Workforce operations: eight isolated tenant-isolation scenarios

This independent main-based batch does not duplicate People/platform #1402,
HCM #1404 or Performance growth #1406.

The **f6d115c** exact-head, production-mode localhost, disposable PostgreSQL 16
workflow completed all eight new HTTP scenarios with two authenticated attacker
employers, an existing higher-ID victim employer, own-positive and foreign-denial
requests, discrimination and unchanged victim state. The shared workflow's
`certified: false` is intentional: it is synthetic method evidence, not production
acceptance, a security audit, or a launch-ready claim.

| Method | Tested bounded scenario | Inventory status |
| --- | --- | --- |
| POST workforce/schedules | create_shift, plus create_pattern, assign_schedule and a rest-day create_override | **COVERED, provisional:** every action; forged victim shift, pattern and worker refused |
| POST workforce/overtime | create_request, plus upsert_budget, decide_request (approved) and bulk_decide_requests (rejected) | **COVERED, provisional:** every action; decisions on a second fictional manager's requests |
| POST workforce/attendance-corrections | create_request, plus decide_request approved (applied to the own punch) and rejected | **COVERED, provisional:** every action |
| POST workforce/coverage | create_availability, plus create_requirement, stage_recovery_plan, create_open_shift, claim_open_shift, decide_claim approved and rejected | **COVERED, provisional:** every action |
| POST workforce/schedule-swaps | create_request, plus decide_request approved (one override per worker) and rejected | **COVERED, provisional:** every action |
| POST workforce/schedule-guardrails | Store inactive advisory policy; persist actor-bound audit | **COVERED, provisional scope:** single `update_policy` action, new inactive policy only |
| GET workforce/roster-rules | Read own distinct, configured inactive policy (not fallback defaults) | **COVERED, provisional scope:** feature-on configured read |
| POST workforce/roster-rules | Store inactive advisory policy; persist actor-bound audit/reason | **COVERED, provisional scope:** single `update_policy` action, new inactive policy only |

## Exact-head CI evidence

- [Default profile, PostgreSQL 16 HTTP](https://github.com/erwinmehehe/payrollph/actions/runs/40244947762/job/121324440138):
  76 read rows, 152 own/foreign pairs, 76 discriminating; 37 write rows,
  74 own/foreign pairs, 37 discriminating and 46 forged-reference proofs.
  This includes six new Workforce write scenarios.
- [Flagged-reads profile, PostgreSQL 16 HTTP](https://github.com/erwinmehehe/payrollph/actions/runs/40244947762/job/121324440304):
  4 read rows, 8 own/foreign pairs, 4 discriminating; 1 write row, 2
  own/foreign pairs and 1 discriminating proof. This includes the
  configured `roster-rules` GET and `update_policy` POST.
- [Multi-entity profile, PostgreSQL 16 HTTP](https://github.com/erwinmehehe/payrollph/actions/runs/40244947762/job/121324440406):
  3 read rows (6 pairs), no write rows. This profile does **not** provide
  the eight Workforce scenario credits.
- [CI on f6d115c](https://github.com/erwinmehehe/payrollph/actions/runs/40244947617):
  complete and successful before the manifest credit changes. Fresh exact-head
  CI and independent maintainer/security acceptance are still needed.

The shared write runner verifies own PostgreSQL state changes, exact own HTTP
success and victim HTTP denial for two independent employer sessions; it rejects
a second employer's genuine data as a false positive and checks the victim's
business rows plus audit trail remain unchanged. Forged foreign employee/punch/
counterparty references are rejected where the row provides them. The audit
snapshot strips only the three chain-sealer fields; it preserves other business
and actor fields. These checks run with synthetic sessions on isolated localhost.

## Boundaries and next steps

The `WFM_ROSTER_SCALE_RULES_ENABLED` flag is set only in the synthetic
`flagged-reads` job. Neither policy activates enforcement: both are saved
inactive and advisory. The default profile remains flag-off for the other six
methods. No production configuration, live personnel data, payout, payroll
calculation, scheduling approval, roster publication or provider call occurs.

The provisional inventory now counts **260 COVERED / 225 GAP** API methods,
plus 10 PUBLIC-BY-DESIGN. (Superseded below: with every action branch now executed,
all eight Workforce scenarios are COVERED, provisionally.) The three new
policy credits are narrowly scoped and do not certify update-existing-policy
behavior, other roles or feature-off behaviors. This is **NOT ACCEPTED** for
all-tenant isolation or launch; all human/reviewer acceptance gates remain open.

Require final-head CI across the relevant profiles, independent reviewer
inspection of source-pinned proof lines, and additional branch-level tests before
expanding credit. **Do not auto-merge.**

## Every action branch (2026-10-29)

The five routes above were held as GAP because only one action each was exercised. Each row now proves
every `action` its route handles: the primary request through the shared runner, then the remaining
branches in the row's `exercise`, for both attacker employers. Each extra action has its own read-back
from PostgreSQL, one audit receipt naming the signed-in actor, a forged victim reference (a victim
worker, shift, pattern, worksite, requirement, open shift, claim, request or swap id under the own
employer) and a request naming the victim employer, and the victim's rows must stay unchanged.
Decisions use requests filed by a second fictional manager in the same employer, because each route
refuses self-approval. `tests/tenant-workforce-operations-family.test.mjs` reads the route sources and
fails if a route gains an action its row does not exercise.

`POST workforce/timesheets` is proven the same way in `write/workforce-timesheets.mjs`: update_policy
(saved advisory and inactive), submit, and decide approved (by the second manager) and rejected.

The shared runners are unchanged. Tables they do not pass are read from the application schema inside
the family files, because the runner's dependency list is bound by earlier reviewed receipts. Local run
on disposable PostgreSQL 16 with a production-mode localhost server: full write table 73 rows, 146
own/foreign pairs, 73 discriminating and 92 forged-reference proofs, victim unchanged. Exact-head CI
and independent review are still required. Synthetic method evidence only; **NOT ACCEPTED** for
all-tenant isolation or launch.
