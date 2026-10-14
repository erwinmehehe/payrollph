# PR #886: exact-blob HCM source-freeze exception

**Review proposal only. The freeze policy in trusted `main` is not changed until this PR is reviewed and merged.**

Target: [PR #886](https://github.com/erwinmehehe/payrollph/pull/886), head `573dee55628e5898b174656020bb752a98a65d30`. Only this PR number, **exact head**, complete five-file diff, statuses and Git blob SHAs may bypass the optional HCM/WFM **source-integration** freeze:

- `.github/workflows/hcm-gaps-focused.yml` — modified, blob `3976e0ec07afd13328d47902aa929ee95a97831b`
- `docs/engineering/pr-886-mainline-reconciliation-2026-10-14.md` — added, blob `ba75a0f2324a22e4db1eda6ea1524221b331cec2`
- `src/app/api/hcm/engagement-surveys/route.ts` — modified, blob `8355956668eb8bdc0f767f9f72bd01992e964349`
- `src/lib/engagement-survey.ts` — modified, blob `3cd87143f9a1be6d136a552ee4a3c4c4a0348057`
- `tests/engagement-survey-atomic-audit-db.test.ts` — added, blob `2b43a9860e132ca2f7308de852ce1e172a8f18a8`

The corrections fix the already-default-OFF engagement-survey atomic audit, conflict/error response and aggregate privacy suppression. This is a **runtime change to survey behavior when enabled**, and a legacy direct-library close call also creates an audit. It is not a test-only change.

**Never inferred or authorized:** independent HR/DPO privacy review, real pilot start, consent/retention acceptance, canonical survey database migration, real employee exposure, payroll or WFM acceptance, production deployment, flag activation, payout or government filing.

**Controls retained:** unchanged `PILOT_HCM_WFM_STARTED` and `PILOT_START_EVIDENCE_REF`; only the exact #886 audited bytes bypass the freeze. Any changed head, file, status, rename or extra file fails closed. Existing GitHub branch rules, exact-head CI, risk classification, author/stale-review policies and configured independent approvals still apply. In strict mode the PR remains blocked while draft or without human approval.

Review `scripts/lib/independent-pr-review-policy.mjs`, `scripts/check-independent-pr-review.mjs`, and `tests/independent-pr-review-gate.test.mjs`. Run `node --test tests/independent-pr-review-gate.test.mjs` and applicable full CI. Do not bypass a failed protection check. Once policy is merged, rerun the trusted-main review workflow for #886 and reevaluate the effective diff against current main.

## 14 October 2026 reconciliation and regression repair

- Integrated current trusted `main` without a force update, preserving the already approved Spend #896/#981 and multi-entity HCM #963 policy exceptions and unrelated code.
- The previous fake #886 GitHub API fixture returned its default `aaaaaaaa...` head, which the review gate correctly rejected. All positive and negative cases now pass the exact pinned `573dee55628e5898b174656020bb752a98a65d30` head to the existing test adapter.
- New negative test asserts that a future #886 head cannot reuse this source exception. Different PR numbers, changed blobs, added or renamed files, and extra code also remain frozen.
- No pilot-start flags, production migrations, feature activation, live data, payroll, payout, or production release changes are authorized.
