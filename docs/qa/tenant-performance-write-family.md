# Performance write-family isolation batch

Prepared methods: PATCH performance/action-items (status to in_progress), PATCH
performance/continuous (reschedule), POST performance/action-items (employee-owned
shared action). These are exact-method scenarios, not proof of every action branch.

The shared runner creates two independent attacker employers and a higher-ID
victim, each with employees/pay profiles and distinct meetings/action items. The
family assertions verify persisted row identity, employer, employee and values;
action-item writes additionally verify one corresponding event and its actor.
The runner requires non-noop own changes, foreign 403, forged own-org/victim-ID
404, rejection of the other attacker's real evidence, and unchanged victim target
rows plus shared victim/audit snapshots. No route, schema or production flag changes.

## Evidence state

Real discovery run 40181854474 on main 27c10b395 built the localhost PG16 server,
but all seven candidates stopped at binding: 0 works, 7 unavailable, 162 manual
review, 0 credits. The directory binding needs an explicit employee pay profile;
that fixture repair is separate PR #1392. No candidate write success is claimed.
The user subsequently requested starting the first family now. This family uses
the already-working shared runner's explicit pay-profile fixtures; its branch
is directly based on main and does not depend on #1392's code.

PR #1393 merged after real HTTP/PostgreSQL acceptance on exact head
`296ca9582d34f44b088f759d1506eccb5f60773e`, but its three manifest rows were
still GAP. [Run 40192690047](https://github.com/erwinmehehe/payrollph/actions/runs/40192690047)
passed default, multi-entity and flagged-reads profiles. The default write job
121166880853 recorded 16 rows, 32 own/foreign pairs, 16 discriminating proofs,
14 forged-reference proofs and unchanged victim database state. These include
the three Performance methods, not 16 newly recovered methods.

The People/platform follow-up reconciles exactly these three executed credits
using repeated `--only-key` selectors. Its 12 new methods remain GAP until their
own HTTP proof passes. Link refresh preserves curated proof ownership and cannot
credit pending rows. Fresh acceptance is required after source or credit changes.
No global tenant-isolation certification, production payroll, provider execution
or statutory approval is implied.
