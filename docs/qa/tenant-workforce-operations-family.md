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
| POST workforce/schedules | Create one shift definition, without publishing a roster | **GAP:** create_pattern, assign_schedule and create_override not covered by this scenario |
| POST workforce/overtime | Create a pending pre-approval request | **GAP:** budget/decision branches not covered |
| POST workforce/attendance-corrections | Create pending timestamp correction; preserve original punch | **GAP:** approval/application branch not covered |
| POST workforce/coverage | Record a preferred-availability rule | **GAP:** recovery, staffing requirement, open shift and claim/decision branches not covered |
| POST workforce/schedule-swaps | Request a swap from actual pattern assignments; preserve assignments/overrides | **GAP:** rejection/approval/application not covered |
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

The provisional inventory now counts **259 COVERED / 225 GAP** API methods,
plus 10 PUBLIC-BY-DESIGN. Five Workforce mutation routes remain GAP pending
separate executable scenarios for each meaningful action. The three new
policy credits are narrowly scoped and do not certify update-existing-policy
behavior, other roles or feature-off behaviors. This is **NOT ACCEPTED** for
all-tenant isolation or launch; all human/reviewer acceptance gates remain open.

Require final-head CI across the relevant profiles, independent reviewer
inspection of source-pinned proof lines, and additional branch-level tests before
expanding credit. **Do not auto-merge.**
