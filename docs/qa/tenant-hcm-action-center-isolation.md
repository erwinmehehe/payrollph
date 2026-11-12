# HCM Action Center: organization-scoped SSR isolation

Status: proof candidate; **ZERO credits; NOT ACCEPTED**. The page remains GAP.

## Scope and finding

This adds a dedicated real-HTTP proof for `/hcm/action-center` on a production-mode
Next server with disposable, fictional PostgreSQL 16. Source inspection found
existing organization/role/custom-permission checks and tenant-filtered source
queries. This change does **not** claim a newly discovered runtime vulnerability
or alter the application, coverage ledger, production flags, or deployment.

The page and 14 supporting source files are sealed by Git blob SHA. A changed
source blocks the proof until reviewed; passing historical evidence cannot be
silently reused for different source. The workflow checks the exact commit and
writes that commit and source hashes into its sanitized evidence artifact.

## Required execution evidence

Seven filler employers precede two independent company-wide HR actors (8 and 9)
and a real, populated higher-ID victim (10). The victim is rollout-enabled and
its own session must successfully render its real sources before and after the
negative cases. No empty-tenant or disabled-feature denial counts as tenant proof.

The expected receipt contains eight populated own-page successes and 41 exact
404 denials, including eight foreign-employer requests (ordinary and forged
organization/tenant headers). It also checks missing, duplicate, malformed and
nonexistent selectors, disabled-rollout employers, bookkeeper/employee/manager
and unit-scoped HR roles, active-account membership revocation, and deny-only
custom-permission revocation. An anonymous request must redirect to `/login`.
Access restoration must recover the populated own page using the same session.

Own-page assertions require the actual employer header, one rendered decision,
two lifecycle/provisioning follow-ups, and one assigned case. A success status,
empty panel, unavailable source, or generic shell cannot pass. Real victim cases
assigned to the foreign actors must not inflate either actor's own case count.
Private source markers are checked across the complete HTML, embedded React
Server Components payload, and response headers, including Unicode escaping.

All ten employers are snapshotted across 19 protected organization, membership,
grant, permission, employee, HCM, provisioning, case, payroll, payout, outbox and
audit tables after each own/denied page request. Intentional fixture changes are
separately validated against exact expected field changes before rebaselining.
Session housekeeping timestamps are not included in business-data snapshots.

## Safety and limitations

The runner refuses nonempty fixture databases, non-PG16 databases, remote targets,
missing safety flags, external credentials, or enabled payout/worker/scheduler
capabilities. Database writes seed and adjust only fictional fixtures. HTTP uses
GET only with manual redirects, fixed loopback origin and bounded timeouts.

This is server-rendered page evidence, **not** a hydrated-browser interaction,
client inbox API/decision test, same-parent legal-employer isolation proof,
production security certification, or independent acceptance. Multi-entity mode
stays off, and the production HCM embargo stays unchanged. The existing separate
page/API authorization gates still apply. No approval or payroll action occurs.

## Review

Run `node --test tests/tenant-hcm-action-center-contract.test.mjs` for source-seal
and anti-false-pass controls. Actual PostgreSQL/HTTP evidence comes only from the
successful dedicated workflow and its `evidence.json`, not these contract tests.
Inspect the artifact's exact commit, eight successes, 41 denials, eight foreign
denials, protected-table/snapshot counts, and zero-credit limitations. Full CI
and independent security review are still required; source merge does not
approve activation or promote this page from GAP.
