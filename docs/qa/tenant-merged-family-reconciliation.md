# Merged family evidence reconciliation — 2026-10-26

Recorded baseline: **257 COVERED / 228 GAP / 10 PUBLIC-BY-DESIGN**, 495 API methods.
This review adds **three distinct provisional method credits**, producing
**260 COVERED / 225 GAP / 10 PUBLIC-BY-DESIGN**. The 18 page/action GAPs are unchanged.
This is source-pinned synthetic evidence, not blanket tenant-isolation acceptance.
Until this reconciliation PR merges, main still records the baseline counts.

## Executed evidence

- Merged #1406 final head `c638d271a0adb29f4318abdfda83bc5f3f011c70`:
  [default job 121308491508](https://github.com/erwinmehehe/payrollph/actions/runs/40239644034/job/121308491508)
  passed 76 GET rows/152 pairs and 31 write rows/62 pairs, with 31 discriminating
  write proofs, 38 forged-reference proofs and unchanged victim DB. The other two
  profile jobs in the same run also succeeded.
- Merged #1410 final head `c8de88438c358a42b9aef53c1300c95b23ceef81`:
  [default job 121343443572](https://github.com/erwinmehehe/payrollph/actions/runs/40251255765/job/121343443572)
  passed 77 GET rows/154 pairs and 35 write rows/70 pairs, with 35 discriminating
  write proofs, 42 forged-reference proofs and unchanged victim DB.
  [Multi-entity](https://github.com/erwinmehehe/payrollph/actions/runs/40251255765/job/121343443894)
  and [flagged-reads](https://github.com/erwinmehehe/payrollph/actions/runs/40251255765/job/121343443897)
  also succeeded. These new methods execute in default; the other profiles do
  not add credits for them. Cancelled earlier duplicate runs are not evidence.

The #1410 final run also executed the unchanged #1406 family. All six credited
route/family source files match that successful head after newline normalization;
their SHA-256 hashes, exact head, job IDs and actual default summary are stored in
`scripts/qa/tenant-merged-family-reconciliation.json`. Shared execution pins still
point at actual own/foreign HTTP calls and unchanged-victim DB assertions.

## Credit decisions

| Method | Decision and boundary |
| --- | --- |
| POST performance/calibration | COVERED provisionally: single session-creation path, owned completed review, exact returned/persisted session and entry, original review retained, real foreign/forged cycle denial. Scoring/finalization are separate PATCH actions. |
| GET enterprise | COVERED provisionally: nonempty exact inactive/unassigned own permission set, same-employer row identity, victim employer denied. This does not prove permission assignment or SSO. |
| PUT organizations | COVERED provisionally: one organization-update path, tested with rename only, exact own audit and every other field retained. Tax/calendar/government-field edits and other roles are unexercised. |
| POST performance | GAP: goal only; cycle/template/cycle-template/review creation missing. |
| PATCH performance | GAP: goal progress only; review-item/review/cycle decisions missing. |
| POST performance/competencies | GAP: requirement only; skill/expectation-default creation missing. |
| PATCH performance/competencies | GAP: requirement only; template mapping/expectation defaults missing. |
| POST performance/continuous | GAP: meeting only; feedback and linked-goal ownership cases missing. |
| POST performance/development-plans | GAP: milestone only; other plan actions missing. |
| PATCH performance/calibration | GAP: policy only; score/flag/finalize missing. |
| PATCH performance/follow-through-governance | GAP: reminder policy only; evidence policy/seal/verify/legal-hold/amend missing. |
| POST enterprise | GAP: security policy only; permission set/assignment/lifecycle actions missing. |
| POST developer | GAP: revoke key only; issuance/webhook/other actions missing. |
| POST automation-studio | GAP: acknowledge only; other configuration/execution actions missing. |

There are **14 tested methods across these two merged PRs**, but **only 3 new
method credits**. #1409 is still open and its three provisional policy credits are
not included; #1402, #1418 and #1419 are also excluded. No test count, open-PR
receipt, duplicate row or successful partial action increases these totals.

## Reproduce and review

`node scripts/qa/tenant-table-credit.mjs --reconcile-merged-families --run-label "Reviewed merged receipts"`
updates the manifest and tracking document using only this reviewed selection.
`--check` previews without writing. Repeating the command adds zero credits.
Existing curated proof ownership, scope and status are retained. The inventory
guard rejects changing the receipts/source hashes, changing the accepted scopes,
or silently promoting any of the eleven held methods. Later complete evidence
requires an explicit reviewed reconciliation, not changing a count manually.

Fresh final-head CI must pass before merge. No production SQL, Neon operations,
provider calls, flags, payroll actions, live data or tenant/audit guard changes.
