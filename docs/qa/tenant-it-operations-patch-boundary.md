# EDG-02 IT operations PATCH ownership boundary

**Status: DRAFT / NOT ACCEPTED / NO-GO. Zero API-method coverage credits.**

## Why this work is isolated

This is a **single EDG-02 hardening** PR for `PATCH /api/it-operations`. The current separate open PRs concern EDG-01 careers publishing, WRK-02 workforce planning, worksites, Performance, HCM definitions/employment terms, onboarding, loans, prior-employer statutory evidence, and the common manifest repin. This change does **not** edit any of those families, the manifest, batch totals, global coverage metrics or the existing feature gates.

## Tenant isolation defect and mitigation

Previously, PATCH looked up `itAccessGrants.id` or `itManagedDevices.id` without a tenant predicate before checking whether the caller could administer the row's organization. An attacker could tell an existing **foreign** object (403) from a nonexistent object (404), an ID-existence oracle. The UI already passes the selected `organizationId`.

The handler requires a positive resource `id` and normally a positive, explicit `organizationId` (422 on malformed inputs). For compatibility with an existing separately evidenced ID-only caller, an **omitted** selector is accepted only if the signed-in actor has **exactly one active employer membership**. Zero or multiple active memberships fail 422 before any resource-ID lookup. The handler authorizes that employer before retrieving either resource, and applies the authorized `organizationId` to both lookups. **Explicit** caller-owned employer selectors return 404 for foreign or nonexistent IDs. **Legacy ID-only** calls with exactly one active membership return the same generic 403 and `Access denied.` for both real foreign objects and nonexistent IDs; existence cannot be distinguished. A request explicitly naming an unauthorized employer also yields 403. The existing final transaction writes remain restricted by both object ID and employer ID. The sensitive mutation rate-limit resource key includes employer plus object ID to prevent cross-employer collisions.

The endpoint remains a human-confirmed IT lifecycle record, not a remote device-management or identity-provider execution.

## Fictional integration acceptance

The dedicated workflow `.github/workflows/tenant-it-operations-patch-http.yml` provisions an empty disposable PostgreSQL 16 database named `app_db` and production-mode Next.js bound to `127.0.0.1:3000`. The proof **must fail closed before app or database imports** unless the exact CI/database/server environment matches its allowlist. Provider credentials and live payroll, payout, worker, scheduler and integration actions are prohibited.

`node --test tests/tenant-it-operations-patch-contract.test.mjs` checks refusal cases, foreign-data leak detection, authorizer-before-lookup ordering, tenant predicates, and UI request compatibility. `npx tsx scripts/qa/tenant-it-operations-patch-http.mjs` supplies:

- Two independent signed-in employers A and B, each with real owned app grants, assigned and available devices, and employee records.
- A third populated victim employer with higher SQL IDs for every tested victim object, including IDs above six. These are **persisted records**, never invented missing IDs.
- Exact 404 for victim grant/device IDs under an **explicitly** selected caller-authorized organization, including nonexistent IDs; exact uniform 403 for foreign and nonexistent grant/device IDs on the sole-membership **omitted-selector** path (including identical response text); 403 for a forged victim organization; 422 for an explicitly invalid organizationId or an ambiguous multi-employer membership; 404 for a forged victim employee assignment. Responses and headers must not contain the victim marker.
- Signed-in valid **200 own mutations**, including grant activation, available-device assignment and assigned-device return request, followed by PostgreSQL verification of changed access/device/asset rows and the expected audit/event records. The independent existing tenant-table proof requires legitimate single-employer ID-only access success and **403** for a real foreign victim ID; the new tests additionally prove nonexistent IDs return the exact same 403. Do not weaken or repin that frozen fixture.
- Exact before/after PostgreSQL snapshots of victim grants, apps, devices, assets, events, employees, memberships and audit rows for every denial and after successful attacker-owned transitions. A real second active employer membership is added only after the two-actor proof, then a legacy ID-only request is denied 422 with no changes to either other employer.

### Commands in isolated GitHub Actions only

```bash
node --check scripts/qa/tenant-it-operations-patch-http.mjs
node --test tests/tenant-it-operations-patch-contract.test.mjs
npm run db:push
node scripts/qa/apply-isolated-baseline.mjs
npm run build
# Then start production-mode Next.js on 127.0.0.1:3000 with the CI-only environment.
npx tsx scripts/qa/tenant-it-operations-patch-http.mjs
```

No one should run the HTTP proof against a production database, an existing development database with customer records, a hosted deployment, a real employer account or an external mail, payroll or payment provider.

## Release / accounting decision

**Zero method credits; `PATCH it-operations` stays GAP** in the tenant-isolation ledger. The PR's proof covers representative grant and device transitions but is not a claim that *every* possible PATCH action/state combination is proven. Do not mark the method COVERED or change any manifest totals based on this PR. Passing exact-head CI and independent owner/security review are still required before any merge. This is not a tenant-wide certification or production/payout approval.
