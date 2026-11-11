# Approvals PATCH whole-method recovery

This separate main-based proposal owns only `PATCH approvals/[id]`. It does not
claim billing (#1910), readiness (#1908), or Automation Studio POST work.

The starting ledger was 452 COVERED /20 GAP among 498 methods. The proposed
ledger is now 453 COVERED /19 GAP: exactly one additional method, not one
credit per approval type. The complete executed receipt is source-sealed in
`scripts/qa/tenant-approvals-recovery-receipt.json`.

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

## Executed combined proof and promotion

[Run 42842335605](https://github.com/erwinmehehe/payrollph/actions/runs/42842335605)
passed all six actual PG16 HTTP executions plus the complete-method aggregator
on `6f1a193f8b56eb52174c33e7caf4335d8a8c95e7`:
generic task 129920572308; leave/chain 129920571928; source flows 129920573869;
typed/delegation/payroll rejection 129920572175; payroll profiles false/true
129920572272 and 129920572479; aggregate 129928633002.

The payroll profiles each passed 301 assertions and 42 denial snapshots.
Typed results include 19 owned decisions, 18 victim denials, four foreign-link
refusals and 18 audit-veto rollbacks; named delegation and payroll rejection
have separate successful owned/refusal/rollback evidence. All results are
preserved from the actual job logs. Original proof jobs awarded zero credits.

The restricted `tenant-approvals-credit.mjs --write` writer generates one
method credit and the inventory/frozen-plan counts. `--check` verifies the
same result without writing. Its 127 execution-input pins must still match;
receipt, source or proof drift fails closed. Negative tests refuse partial
families, counterfeit receipts and borrowed method evidence. Other method
receipts and API/page classifications are preserved.

This covers the tested disabled-money/legacy entity profile and both exact
payroll-link profiles. It is not new acceptance of multi-entity/group-HR
activation, live providers, production payroll or tenant-wide certification.
New credit-head CI is required before review; the PR remains draft.

Validation of the promotion: 51 focused inventory/credit/source-review tests
and 21 focused historical-hold reconciliation tests passed. The final full
tenant selection against another fresh private PG16 had 1,669 tests: 1,652
passed, eight preexisting Windows POSIX-permission fixtures failed and nine
were skipped. No guards or skips were relaxed. Lint: zero errors/ten existing
warnings; TypeScript passed. Repin: 2,414 unchanged, five new citations, zero
repinned/review needed. Restricted credit reconciliation `--check` passed.
