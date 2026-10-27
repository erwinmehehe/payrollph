# Asset custody tenant-isolation candidate (four methods, no coverage credits)

## Scope and ownership

This independent, new-file-only batch targets \`src/app/api/assets/route.ts\`,
which has no open PR for its asset-custody family at authoring time. The four
method identities were all marked GAP on the inspected \`main\` baseline:

| Method | Own positive and negative cases |
| --- | --- |
| \`GET /api/assets\` | Persist an assigned private asset for each of two signed-in employers and the real higher-ID victim; require the own asset and no foreign rows; signed-in foreign employer query must be 403. |
| \`POST /api/assets\` | Register and read back an own asset assigned to a real active employee; a foreign employer selector is 403; an own employer with the victim's real employee ID is 404. |
| \`PATCH /api/assets\` | Update only an existing own asset's name; the real higher-ID victim asset is denied 403 and assigning the victim worker to an own asset is denied 404. |
| \`DELETE /api/assets\` | Delete one genuinely persisted own assigned asset, leaving all other assets unchanged; a DELETE by the same session against the existing higher-ID victim asset is 403. |

The existing tenant table runners exercise **two distinct signed-in attacker
employers**, a third genuinely persisted victim whose objects have greater IDs,
exact response statuses, employer-discriminating own-data assertions, and
unchanged victim business rows and audit trail. The write runner additionally
snapshots the victim's **entire asset table state**, not just the requested ID.
No \`404\` on invented IDs, feature-disabled \`404\`, empty response or anonymous
\`401\` is accepted as a successful isolation proof.

## Execution and acceptance

New source rows are auto-discovered under \`scripts/qa/tenant-table-rows/\`; the
existing Tenant table proof workflow runs them under \`default\`. A separate
focused asset-custody workflow provides an exact-head, production-mode
\`127.0.0.1:3000\` Next.js/HTTP + disposable PostgreSQL 16 \`127.0.0.1:5432/app_db\`
run. Both read and write proofs use the shared fail-closed isolated-CI
configuration. Focused source-contract tests run before the HTTP proof.

This candidate changes **no production code, schema, tenant manifest, release
flags, sessions, payroll calculations, payout provider, external account or live
employee data**. No credits are promoted. It does not prove the separate IT
Operations managed-device workflow, unit-scoped same-employer roles, or
production/multi-entity acceptance. Never claim full-family security closure
from a partial or canceled run.

**DRAFT / NOT ACCEPTED / DO NOT MERGE** pending successful final-head focused
and shared CI/PG16 proofs, source pin review, and independent maintainer/security
approval. Only after those checks may a separate reviewed credit reconciliation
consider the four exact method GAPs.
