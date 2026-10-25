# Worksite tenant-isolation HTTP candidate

Base: main `41d5046ee`, independent of #1366 benefits. This batch targets `GET/POST /api/workforce/worksites` and only the POST actions `create_worksite`, `update_worksite` and `assign_employee`.

The guarded second-pass runner unconditionally awaits `scripts/qa/tenant-worksites-http.mjs` against its existing production-mode localhost server and disposable PostgreSQL 16 fixture. Two independent employer owners have genuine privileged sessions with fictional MFA state. Both owned worksite and assignment rows are persisted before seven real victim rows; victim IDs must exceed both attackers and six.

Required controls:

- Nonempty own GET including actual persisted site and assignment; foreign-employer 403; forged header, worker and site selectors cannot change employer scope.
- Own create 201, update 200, assignment 201, persisted employer/worker/site and audit evidence. A new assignment closes only the owned prior record on January 31; its distinct February 1 start avoids collision with the seeded January 1 assignment.
- Foreign employer mutations 403; foreign site/worker 404; foreign organization unit 422; victim worksite, assignment, arrangement, authorization, employee, payroll and audit snapshots unchanged after every denial and at completion.
- Unit-scoped manager may read visible owned sites but cannot create/update company master data. Ordinary employee and anonymous access denied. Mutation without MFA remains 403 with MFA_REQUIRED.
- Same session remains authenticated after membership revocation while another employer grant remains active; GET and all three POST actions denied. Role/MFA/revocation attempts also preserve owned workforce, payroll and audit rows exactly.

**Prepared evidence only; NOT ACCEPTED.** Syntax/source-contract checks are not production-mode HTTP evidence. The actual exact-head Security HTTP Smoke run is required. Both methods remain GAP in the manifest and no inventory count changes: current base is 149 COVERED / 10 PUBLIC-BY-DESIGN / 335 GAP among 494 methods, with 18 page/action gaps. This partial POST action batch cannot certify photo/geofence configuration, HCM arrangements, site authorizations/restrictions, other scope combinations or the entire route. Reclassification needs reviewed method/action-specific evidence, not subtraction.

No production SQL, Neon operations, provider credentials/calls, release flags, payroll math or runtime authorization/audit guards are changed. All records are fictional and written only by existing isolated CI. Rollback removes the additive suite and runner call. Source contract: `tests/tenant-worksites-source.test.mjs`.

## CI fixture correction

At synced head `20aed3446`, Security HTTP Smoke, DL-02 and salary-correction-case CI reached the owned worksite create and persisted its row. The assertion compared the API's canonical uppercase code with the fixture's lowercase UUID fragment. The request fixture now supplies an uppercase code, matching the existing `cleanCode` contract, while the exact persisted-code equality check remains required. No API normalization, authorization or status assertion changes. Fresh exact-head HTTP CI is still required; failed executions grant no coverage credit. Base inventory counts above describe the original base before subsequent main syncs.


## Evidence reconciliation after passing merged-head CI

Only GET receives a method credit linked to passing merged-head receipt [d733b1f34](https://github.com/erwinmehehe/payrollph/actions/runs/40091436728/job/120864754791). POST remains GAP because only three of its action branches have real acceptance evidence. Current reconciled inventory is 156 COVERED / 10 PUBLIC-BY-DESIGN / 328 GAP, with 18 page/action gaps. Prior preparation counts and inventoryCreditsAdded=0 log fields are historical; the manifest and bounded receipt verifier now define the reviewed credits. No global or production acceptance.
