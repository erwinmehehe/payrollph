# WRK-02 workforce-planning root POST/PATCH — foreign worker proof extension

**Scope:** existing frozen batch WRK-02, exact two methods: `POST /api/workforce-planning` and `PATCH /api/workforce-planning`. Initial base `main@9fb1ddd79a7517085097dae4d0e66e2552efc0f9`. Neither is assigned to the open PRs #1712, #1727–#1731, #1736, #1738 or #1739.

## Why the existing POST candidate was incomplete

The earlier `workforce-planning-root.mjs` source-bound PG16 HTTP runner already executes job-family, job-level, job-grade, org-unit, plan, profile, position and direct assignment positives, victim organization refusals, genuine foreign object IDs and unchanged victim snapshots. It also exercises PATCH freeze, governed approval/closure requests, forbidden transitions, neutral missing-versus-foreign 404 and concurrent freeze audit idempotency.

However the direct-assignment recovery previously checked a real foreign **position** and a duplicate filled own position. Neither check proves the outcome for an *otherwise valid open own vacancy* paired with a genuine foreign employee ID. A filled own vacancy could return 409 before even reaching the worker lookup.

This PR seeds an additional **real open own vacancy** after the signed-in, persisted 201 direct assignment positive. Each owner now submits its actual higher-ID victim worker ID against that open own vacancy. The expected result is exact 404, unchanged full own/victim PostgreSQL snapshots, and its own vacancy still open. The change is fail-closed in the dedicated contract: the exact victim selector and denial case are mandatory and the forged-reference count rises from four to five. The existing PATCH scenarios and positives are not weakened.

The WRK-02 dedicated disposable-PG16 workflow explicitly keeps worker, scheduler, billing and CSP OFF in addition to payout and provider gates. It uses production-mode Next on localhost and fictional authenticated employer sessions; it does not touch live HCM or payroll money.

## Decision and credit gate

**DRAFT / ZERO NEW CREDITS.** Both root methods are still GAP with `testedBy:null`. Do not credit either method until every supported mode plus full own positive / real victim denial / byte-identical victim DB / forged selector and object denial passes on the exact final PR head. A historical green or older #1649 candidate is not the final-head receipt. On a failure, retain GAP and specify the check. Any later promotion must reconcile manifest, ledger, source/test/workflow blobs, citations and metrics together, then rerun exact-final-head CI.

The repository owner `@erwinmehehe` is the **only reviewer**. After an actual complete pass, the proper label is `SOLO_VERIFIED_DEV_RECOVERY`; never claim independent review.

No production/Neon SQL, real people, external provider calls, payout, feature activation, CSP enablement, application route change, schema migration or merge is authorized.
