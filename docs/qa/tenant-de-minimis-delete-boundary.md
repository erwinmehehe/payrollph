# De minimis benefit grant — ID-only DELETE tenant isolation

**Scope:** `DELETE /api/de-minimis` only. This is a runtime authorization
hardening change and new disposable real-HTTP PostgreSQL 16 proof candidate.
The method remains **GAP / zero coverage credit** in the canonical tenant
manifest until its exact-head CI and independent review pass. GET and POST remain
GAP; their evidence is not claimed here.

## Isolation defect and fix

Previously, an authenticated user could supply another employer's real grant ID.
The handler queried the global `de_minimis_grants` table before authorizing the
target employer. A real foreign ID produced a role/membership denial (403);
a nonexistent ID produced 404. That distinguished another employer's records.

Now the ID lookup is an inner join to the caller's **active**
`user_organizations` membership, keyed to the grant's actual employer.
Foreign, revoked and nonexistent grant IDs return the same 404 response.
Existing payroll-role and employee-unit checks still apply before a write.
The final update is constrained by **both** grant ID and employer ID. Invalid
nonpositive or unsafe IDs return 400 before any lookup.

## Exact-head tests

The dedicated workflow starts with an empty, disposable **PG16** database and
a production-mode Next server bound to localhost. Real fictional employer
records, active memberships, signed-in sessions and valid-schema benefit
grants are inserted. The victim is created last and owns a genuine
higher-ID grant. Two independent attacker owners must each:

- Receive identical 404 responses for real foreign vs missing grant IDs,
  without foreign names, IDs or metadata in the response.
- Leave every employer's grant and audit snapshot unchanged on denial.
- Fail after their active employer membership is revoked (404), and when
  their role is only employee (403), without changes to any protected rows.
- Successfully end their own active benefit (200), persisting an inactive
  record/end date and exactly one own-employer audit event.
- Leave the victim's real higher-ID grant, audit and all unrelated rows
  unchanged.

Pure tests deliberately reject a fake status-only success, foreign/missing
response differences, leaked markers, altered peer grants and missing audits.
The CI guard refuses non-loopback databases/servers, populated databases,
provider secrets, workers, schedulers and money/payout activation.

## Integration and release

- [ ] Exact-head de minimis PG16 HTTP workflow and focused tests green.
- [ ] Repository security/typecheck/CI checks green; no covered credit claimed.
- [ ] Independent security reviewer verifies lookup ordering, real foreign
      identity, persisted write/audit and cross-employer immutability.
- [ ] Maintainer approves separately from the unrelated open migration,
      HCM and email-verification PRs.

**Overlap:** No edits to open PRs #1814, #1815, #1816 or their shared
manifest, inventory and method-credit files. No migration, HCM, email,
provider, schema, feature flag, production data or payout changes.

**Rollback:** revert the method fix and isolated proof files; no deployment
or production toggle is part of this PR. **DRAFT / NOT ACCEPTED / NO
PRODUCTION OR MONEY AUTHORIZATION.**
