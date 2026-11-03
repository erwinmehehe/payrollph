# PII-01 unclaimed salary-preview POST recovery — November 2, 2026

## Method and ownership

- Exact method: `POST /api/hcm/salary-corrections/preview`.
- Existing frozen batch: **PII-01**. One method and one method family in this PR.
- Initial base: `main@9fb1ddd79a7517085097dae4d0e66e2552efc0f9`.
- No November 2 open PR (#1712, #1727, #1728, #1729, #1730, #1731, #1736) claims this method.
- Source authorization fix from merged #1585 is retained. No production source, data, schema or money behavior is changed here.
- Sole owner: `@erwinmehehe`. There is no second reviewer. The evidence label, only **after** exact-final-head verification, is `SOLO_VERIFIED_DEV_RECOVERY`, never independent approval.

## Existing proof, and what this PR hardens

Existing executable `scripts/qa/tenant-hcm-salary-correction-preview-http.mjs` and dedicated `tenant-hcm-salary-correction-preview.yml` already seed two independent signed-in fictitious owners, an ungranted sibling legal employer per attacker, distinct persisted salary revisions and a real higher-ID victim employer. They require positive, genuine revision-backed own HTTP 200, legitimate foreign 403 and forged object 404, exact no-write SQL snapshots, and denial after an entity grant is revoked. The earlier #1585 PG16 run (40864201403) is historical **not** an exact-head acceptance for this PR.

This PR adds:

1. A real forged **victim legal-employer ID plus victim employee ID** under each attacker's authenticated session, denied with exact HTTP 403.
2. The joined payroll entry rows to the exact SQL snapshot for every fictional employer, not only payroll-run headers, pay profiles, revisions, grants and audit.
3. Fail-closed runner and unit contract guards for `WORKER_ENABLED=false`, `CENTRAL_SCHEDULER_ENABLED=false` and `NEXT_CSP_ENABLED=false`. The real workflow writes these values explicitly, alongside disabled payout, billing and provider flags.
4. A fixed 18-denial gate; adding cases without updating the real assertions must fail. Existing positive/foreign/forged/revocation checks remain intact.

## Verification and credit rule

The dedicated workflow must execute against a **disposable PostgreSQL 16** database and a real Next.js localhost server on the exact **final PR head**. It must pass:

- Positive: two separately signed-in fictional owners, two distinct persisted revision-backed own 200s.
- Real victim denial: real higher-ID third employer forbidden (403).
- Unchanged victim DB: full snapshots after each denial, including payroll entries and employer grants.
- Forged selectors: real higher-ID victim employee/entity, victim worker under own org, sibling ungranted entity, conflicting header, repeated query, noncanonical selector and group selector denied.

No screenshots or mocked HTTP response count. No production/Neon SQL, real workers, integrations, provider requests, payouts, feature activation or CSP. The source remains release-gated and feature default OFF.

**Current status: DRAFT / ZERO NEW CREDITS.** The main manifest remains authoritative and the method remains GAP with `testedBy:null` until this exact head passes and source/receipt pins, inventory and metrics are reconciled together. If a check fails, report the exact failed assertion; do not weaken the guard or credit the method. Do not merge or claim tenant-wide acceptance.
