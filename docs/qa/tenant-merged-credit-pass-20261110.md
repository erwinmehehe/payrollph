# Merged-proof credit pass — SOLO_VERIFIED_DEV_RECOVERY

Based on `origin/main@75becb095ee209c88145c237a53afcb5b1e570e3`.
Synced by ordinary merge with `main@fcd688d60728532767f58f0ce1f002d2d5bdb4f5`
after readiness/golden Phase 10 landed. All nine route blobs still match their
merged proof sources; filing runtime/proof inputs are byte-identical. The
executed HTTP receipt remains honestly labelled with its actual `75becb095`
source; a fresh final-PR-head CI result is not claimed in this document.
Before: **450 COVERED / 22 GAP**. Proposed after this one-method pass:
**451 COVERED / 21 GAP**, among 498 methods (15 public, 11 operator-token-only).
No route, identity method, page/action, existing credit or classification changed.

| Candidate | Manifest says missing | Decision and exact closure requirement |
|---|---|---|
| PATCH approvals/[id] | Generic-task coverage is not all connected approval sources | **HELD.** #1785 additionally proves leave and chain decisions, but explicitly omits HCM business-process, workforce scenarios, governed handoffs, automation resume and dynamic-group routing. Needs own/victim/forged/unchanged PG16 HTTP cases for those sources; cannot promote a subset. |
| POST payroll-runs/[id]/exports | No valid whole-method own/victim proof linked | **HELD.** #1803 proves complete-manual, not successful preflight/disburse with the required flags OFF. #1811 exporter inconsistent-row regression does not supply these missing HTTP actions; #1768 is a different company-export GET. Needs eligible OFF-profile positives for all POST actions, real victim denials and unchanged SQL. |
| POST payroll-runs/[id]/xendit-payout | No valid whole-method own/victim proof linked | **HELD.** #1803 credits neither a real own POST nor provider-disabled refusals. Xendit rail/approval remain OFF; need a genuine successful persisted OFF-compatible POST, with mocked transport and no actual provider, or report that source cannot succeed under these constraints. No route change permitted in this pass. |
| POST hcm/work-items/escalate | Worker-token proof uncredited | **HELD.** #1849 proves a privileged global sweep, correctly partitioned outbox and invalid-token denials; the valid scheduler intentionally processes multiple employers. It does not provide an employer caller's genuine victim-only denial. Needs an explicitly approved operational classification, or a separately designed scoped boundary and its proof. No reclassification here. |
| PATCH compliance/filing-validations/[id] | Historical rejected-only proof lacks accepted outcome and current source matching | **CREDITED (one provisional method).** Fresh main [run 42728601391](https://github.com/erwinmehehe/payrollph/actions/runs/42728601391) passed accepted, rejected and guards, plus its aggregate. Two accepted writes (manual/file), two rejected writes, 34 input/tenant denials, 20 authenticated role/MFA/revocation denials and four reached audit-veto rollbacks. Genuine victim records above six and protected foreign SQL/audits unchanged. Agency/provider calls false. Exact route `09f642a67035dc9ce22fa502d80518ba18641b0f`; merged proof #1885. |
| GET marketing/leads | Exact-current-head credit reconciliation absent | **HELD.** #1848 is an allowlisted recent-MFA global aggregate report, not an employer-private read. It proves privacy/role refusals, not two tenant owners denied a genuine victim-only report. Needs an approved operator classification or separately scoped contract; do not fabricate tenant-denial credit from global aggregate success. |
| POST automation-studio | No whole-method own/victim proof linked | **HELD.** #1878 tests only triage-operational-case / acknowledge. Needs all remaining accepted action/transition positives and matching victim, forged-resource and unchanged-state proof with required flags OFF. |
| POST billing | No whole-method own/victim proof linked | **HELD.** #1874 supplies real two-owner 201s, forged/victim 403 and unchanged SQL using exact-host fake PayMongo transport with no real provider. Its fixture creates victim third, asserts only relative ordering, and never proves persisted victim IDs above six as the closure plan requires. No fresh main HTTP receipt; workflow is PR-only. Strengthen fixture ordering without weakening the contract, then execute exact-head PG16 with all required release flags OFF. |
| POST bir/annual-employer/candidate | Reason still says check/download and >6 floor missing | **HELD; reason is stale, not evidence of absent source cases.** Merged `90325afde` adds actual template/check/download, foreign organization/entity/worker denials and >6 assertions. But this pass has no exact-current-head OFF-only execution receipt. The existing browser workflow also starts a separate final-pay/centavos flag-ON server. Needs an isolated OFF-only three-mode PG16 HTTPS reproof; do not run that mixed-flag workflow or borrow its template-only historic receipt. |

## Receipt, flags and source protection

The committed sanitized filing receipt records the actual main SHA and jobs:
accepted `129540561266`, rejected `129540561557`, guards `129540561580`,
aggregate `129545232437`. Every job completed successfully, including real HTTP
steps, not just build/setup. The parsed result is sealed by Git blob hash.
No raw CI logs, keys, sessions, fictional agency payloads or database dumps are committed.

Workers/scheduler, Xendit billing/payouts, PayMongo disbursements and CSP were
explicitly false. Final-pay signed review, exact thirteenth centavos and
calculation history were unset: the source-pinned critical-release registry
accepts only exact `true`, so all three were effectively OFF. This is recorded
as `unset-default-off`, not falsely represented as an explicit environment value.
No real agency acknowledgement, payroll release, money or deployment is certified.

The new dedicated verifier checks all sealed runtime/proof inputs and exact
receipt equality. Historical manifest-status assertions in two contract tests
are the only pinned test compatibility exceptions: their runtime/proof pins
and HTTP oracles are unchanged, and each new COVERED branch must pass this
complete verifier. Their replacement test bytes are separately sealed;
the old executed receipt is not rewritten. Historical rejected-only evidence
cannot be reused as full-method credit.

Reconcile the manifest through `node scripts/qa/tenant-filing-patch-credit.mjs --write`;
verify with `--check`. Counts/headlines are derived from actual statuses, not
hand-edited. The separate invitation verifier permits this single disjoint
promotion only after the full filing verifier passes; inherited invitation
routes and receipts must remain identical.

Requires normal rebase/sync, source review and repin if another manifest PR
merges first. Draft only; owner decides merge. No production acceptance.

## Verification on the synced branch

- Focused filing/credit, inventory, high-risk, gap-promotion and six-method
  review guards: **72 passed, zero failed**.
- Full tenant guard selection: **1,597 tests; 1,580 passed, 8 failed, 9 skipped**.
  Seven failures are unchanged DL-02 private-file POSIX permission/symlink
  fixtures; the eighth is the unchanged private-0600 allowlist preseed fixture.
  These fail on this Windows host. They are reported, not skipped or weakened.
- Manifest repin: **2,391 unchanged, 7 new citations, zero repinned, zero
  requiring review**.
- Dedicated filing credit reconciliation `--check`: PASS, idempotent, no new
  credits on repeat. Generic table-credit check: PASS in preview only; its one
  unrelated suggested promotion was **not applied**.
- TypeScript: PASS after main sync. Full lint: **0 errors, 10 existing warnings,
  zero warning-baseline violations**. No application source is changed by this PR.
- Exact diff audit: only the filing PATCH method record changes; every other
  method, existing proof/classification, route blob and scoped page is identical
  to current main. New open BIR refusal work #1891 is not duplicated here.
- NOT_RUN: new HTTP proofs for the eight HELD methods, real provider/agency
  operations, production/staging acceptance and final draft-PR-head CI.

The three-leg PG16 HTTP execution is real GitHub Actions, not a fabricated
local `GITHUB_ACTIONS` environment. The full local tenant suite is not claimed
green; Linux CI still needs to validate its filesystem security fixtures.
