# Typed approval source boundaries

SOLO_VERIFIED_DEV_RECOVERY. This extends draft #1904; it is not another competing
approval proof PR. The original four-flow harness is retained unchanged.

## Source fix

An approval task's active employer membership does not authorize an inconsistent
reverse link from a foreign HCM step or automation execution. In a disposable
fixture, an owned task with a foreign HCM step returned 200 before this fix.
This demonstrates a missing source-ownership invariant on synthetic inconsistent
data, not an established production exploit or a way to create that link through
an ordinary API request.

The handler now reads only ownership columns for those links inside its existing
decision transaction, before the first task/source update. It rejects a foreign
step, foreign/missing HCM instance, foreign execution or ambiguous pair of links
with the existing generic 409 conflict response. Both indexed reads are bounded
to two rows. Existing membership, role, maker/checker, live Dynamic Group,
legal-employer, source-state, audit and payroll controls remain in place.

## Executed local HTTP proof

See [sanitized source-tree receipt](tenant-approval-types-local-receipt.json).
The test used a newly created private PostgreSQL **16.14** instance on loopback
port 55436 and a production Next server on port 3310. It did not reuse, rename or
reset the existing development database. The schema was exported offline and
applied only to that newly created empty private database; the db:push guard was
left unchanged, and GitHub Actions was never impersonated locally.

Two authenticated attacker employers and a later real victim exercise:

| Family | Owned persisted effect |
| --- | --- |
| HCM effective change | Approved process schedules the future change; decline records declined source |
| HCM position creation | Approval applies the planned position; decline leaves it planned |
| HCM position closure | Approval closes the unoccupied position; decline leaves it approved |
| HCM compensation recommendation | HCM approval leaves the recommendation proposed for its separate pay approval; decline declines it |
| Workforce scenario | Approves/rejects the exact scenario and linked whole-company plan |
| Separation readiness handoff | Decides the chain while leaving final-pay/separation source draft |
| Roster claim handoff | Decides the chain while leaving claim pending and shift open |
| Dynamic Group routing | Live matching worker can decide the exact frozen group version |
| Automation gate | First decision moves the waiting pointer to the next task; final approval resumes and completes the gate; decline fails the execution |

The final run executed **19 own decisions, 18 victim task denials, four forged
reverse-link denials, 20 source/maker/group refusals, 18 audit-veto rollbacks and
nine cross-employer oracle discriminations**. Every main decision is followed by
a refused replay. Ten separate victim-owned control decisions prove every source
family is reachable; attacked victim tasks remain pending. Those controls execute
before the adversarial snapshot. Protected organization-scoped tables plus payroll-entry rows
are read from PostgreSQL and compared using deterministic SHA-256 row-set
digests; raw private keys/session data are not printed. Victim IDs exceed both
attackers and six. Foreign task errors must be exactly the generic JSON object,
without victim markers in body or headers.

An additional named-delegation HTTP sub-proof uses both attackers' real delegated
decisions, verifies the persisted original approver and authenticated audit actor,
and rejects a role-only success. It refuses expired, future, inactive and
foreign-employer delegation edges, genuine victim tasks and replay, comparing
all three employers' SQL/audit state after each refusal. Forged body selectors
cannot redirect either successful decision. It adds two own writes and twelve
refusals without changing any runtime permission or feature flag.

A separate fresh-db run with the owned-result oracle replaced by a no-op fails
with `Missing expected exception: proof accepts another employer's data`.
The same pre-fix forged-HCM case now returns 409 without task/source/audit changes.

The changed approval dependency also required re-executing both existing
onboarding profiles. The fresh legacy/preview runs preserve their four existing
credits: **38 own / 38 victim / 30 forged / 64 negative / 19 discrimination**.
Their prior receipt label and approval-source digest are retained as history;
the new helper is included in the receipt's strict source seal.

## Verification and remaining acceptance

- Initial focused approval/onboarding/inventory selection: 70 passed. The
  delegation extension's focused approval/inventory selection: 38 passed.
  TypeScript passed;
  lint returned 0 errors, 10 existing warnings and no warning-baseline violations.
- Final full tenant selection against another fresh private PG16: 1,629 tests,
  **1,612 passed / 8 failed / 9 skipped**. The eight failures are seven existing
  DL-02 POSIX-permission/symlink fixture checks and the existing private-0600
  allowlist fixture check on Windows; those tests and guards were not changed.
  This is not a full local green claim. Linux CI must pass before source acceptance.
- The full fresh-PG16 delegation-noop mutation run also failed as required with
  `Missing expected exception: proof accepts another employer's data`.
- Manifest repin: 2,407 unchanged, 0 repinned, 0 needing review. Generic table
  credit check ran in preview mode only; its two unrelated suggestions were not
  applied. Both approval workflows parse as YAML; new scripts pass syntax checks.
- The dedicated workflow checks out the exact PR head and runs real HTTP/PG16;
  its current-head result is **NOT_RUN locally / pending GitHub CI**.
- Existing generic-task, leave/chain, four-flow, payroll lifecycle and onboarding
  workflows must also pass on the new source. Old green heads are not accepted.
- No new method credit is written. `PATCH approvals/[id]` remains **GAP** with
  `testedBy: null`; global counts remain **451 COVERED / 21 GAP** at the
  `2a6878aa4` main baseline. A separate whole-method credit review must reconcile
  all of these proofs after current-head acceptance.
- Named delegation is exercised in the legacy profile. Multi-entity/group-HR
  activation is not newly certified. No production acceptance is claimed.
- Final-pay signed review, exact-centavos, calculation-history, CSP, payouts,
  provider billing, workers and scheduler stayed OFF. No real provider, employer,
  payroll release, bank operation, production SQL or Neon operation was used.
- Rollback is a source revert of this guard and its evidence proposal. It applies
  no production schema or flag change and grants no deployment authorization.
