# Approvals PATCH whole-method recovery

This separate main-based proposal owns only `PATCH approvals/[id]`. It does not
claim billing (#1910), readiness (#1908), or Automation Studio POST work.

The current ledger is 452 COVERED /20 GAP among 498 methods. The target is one
additional method, not one credit per approval type. No status is promoted
before the complete current-head execution receipt exists.

The dedicated workflow runs the original generic task, leave/chain, HCM/
workforce/handoff/automation, typed/delegated/payroll-rejection proofs and both
payroll approval-link profiles on fresh disposable PG16 databases. Existing
guards, seeds and HTTP/SQL assertions are reused intact. Every checkout is
pinned to the PR head. Required money/CSP/history flags stay OFF.

This closes an acceptance hole: the generic-task workflow used a literal
bracket path that does not reliably trigger for edits to the parameterized
approval route. The combined gate triggers on `src/app/api/approvals/**` and
the recovery tooling; no single successful job can stand in for all branches.

Promotion requires all six jobs to pass, exact route/dependency/proof pins,
real owned decisions, genuine victim denial, forged-selector containment and
unchanged victim SQL/audit across the combined receipts. Existing #1904 typed
and source proofs passed, but their success is not borrowed to claim that a
missing current-head generic-task execution ran. Provider, production and
independent acceptance are not authorized. Evidence label:
SOLO_VERIFIED_DEV_RECOVERY.

The source workflows remain unchanged. A deterministic generator and tests
ensure all proof families stay present, payroll profiles remain distinct and
the rendered combined workflow matches its reviewed inputs. No runtime route,
schema, existing proof body or current method credit is changed.
