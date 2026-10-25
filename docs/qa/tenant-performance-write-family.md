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

Current Performance rows remain GAP. Link-only refresh skips pending rows and
cannot credit them; a regression proves counts/statuses are unchanged. This lets
real CI execute uncredited rows before the full credit command is used. Refresh
only updates existing proof links, including the moved original development-plan
row. Curated proof ownership is retained.

Before credit or merge: all three real HTTP/PostgreSQL profiles must pass on the
current source. Then generate/review these three credits and their executed run
receipt in this same PR, update this evidence state and the pending-status test,
and require fresh CI on the final head. No global tenant-isolation certification,
production payroll, provider execution or statutory approval is implied.
