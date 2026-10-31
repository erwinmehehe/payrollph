# WRK-02 Batch 3 root POST/PATCH — coverage follow-up

**Lane:** WFM, QA/security hardening, 2026-10-31  
**Scope:** `POST /api/workforce-planning` and `PATCH /api/workforce-planning` only.  
**Acceptance:** **DRAFT / NO-GO. Neither method is credited.** The shared method inventory and `tests/tenant-isolation-coverage-inventory.test.mjs` are intentionally unchanged.

## Why this follow-up exists

Merged PR #1649 demonstrated seven creation variants and several position lifecycle outcomes with two fictional attacker employers and one real higher-ID fictional victim in disposable PostgreSQL 16. However, it did **not** prove successful direct incumbent assignment, uniform foreign/missing ID responses, simultaneous position updates, independent human approval, or every business-process race. Successful tests alone must not change a method from `GAP` to `COVERED`.

## Added evidence

- **POST assignment success:** In the exact dedicated `TENANT_TABLE_FAMILY=workforce-planning-root` workflow, require the synthetic employer to be **ungoverned**. Create a new fictional active worker and a real owned open position, then POST today's Manila business date. Verify a persisted primary assignment, filled vacancy, updated worker profile, one employee employment event, audit receipt, no victim marker and unchanged victim snapshot. Repeat assignment and forged foreign-position attempts must fail without writes. The shared all-families job does not claim this positive case if earlier unrelated synthetic rows established movement governance.
- **PATCH ID privacy:** For authenticated accounts with **no membership** in the foreign position's employer, return the same neutral 404 `Position not found.` as for a nonexistent global position. Same-employer RBAC, unit, MFA, workflow and tenant checks are retained. Test both response bodies for equality and both employers' unchanged states.
- **PATCH simultaneous freeze:** Two concurrent requests against one freshly seeded owned vacancy must produce at least one 200; remaining requests may be idempotent 200 or stale 409. Assert the vacancy is frozen **once** and exactly **one** persisted audit record exists, with unchanged victim state. This is not a proxy for testing all HCM lifecycle or deletion races.
- **Source contract:** Pins required governance prechecks, foreign-ID masking order, race/audit assertions and the hard **GAP / zero-credit** requirement.

## Test gates

The dedicated workflow `.github/workflows/tenant-wrk02-batch3-root.yml` and the shared tenant-table workflow should run on the exact PR head after these changes. Both require the approved ephemeral GitHub Actions PG16 instance, 127.0.0.1, fictional employers, authenticated sessions and payment/provider flags OFF. The focused source check can be run with:

```bash
node --test tests/tenant-wrk02-batch3-root-contract.test.mjs
```

Exact-head full CI, lint, typecheck, security HTTP checks and independent reviewer validation are still required. A **previous** green #1649 run is historical and cannot accept this PR. On failures, fix the issue or leave the draft blocked; **do not** bypass failing safeguards or alter the global coverage counts.

## Residual gaps and non-claims

1. A completed, *independently approved* HCM business-process decision has **not** been proven by these read/write fixtures. Governed actions create review requests but do not grant approvals.
2. Concurrent **governed** approval/closure requests and all racing delete/application paths are still unproven. This follow-up checks only the same-vacancy freeze race, not every state transition.
3. The positive direct-assignment path is intentionally limited to a **fictional ungoverned** employer. Governed employers must remain blocked from direct assignment.
4. No real payroll runs, compensation calculation changes, bank/payment providers, filings, statutory due dates, schema migration, production data, feature activation or rollout are authorized.
5. The remaining `POST` and `PATCH` methods stay `GAP` and need fresh source-pinned complete-method proof plus independent security/tenant review before any provisional credit decision.

Rollback: revert this PR's narrowly scoped source guard and QA additions. No schema or data migration is involved.

## Exact-source inventory and whole-suite CI reconciliation (2026-10-31)

The dedicated synthetic PG16 workflow on PR head `46a18fd5` passed (run `41203115190`), as did the shared write table. Broader security acceptance and PG18 post-cutover smoke failed at the same fail-closed source-pin check: the root route changed from `0535a1bb935bc61c777b33c1ea01f161a314e8d2` to `0b045a5fdbddbf07020a2d5ab4a961578d5c9cb1` without re-inventory. The extra Security HTTP Smoke failure was a downstream required-check failure, not an independently demonstrated HTTP exploit.

The follow-up now re-inventories the *exact* new root route blob, preserves newer `main` tenant evidence, and pins the existing seven-variant synthetic fixture, dedicated PG16 workflow and source contract in a reviewed-unaccepted marker. The inventory guard explicitly validates foreign/missing 404 concealment, fixture bytes, method statuses, and strict zero new credits. The structural-access guard must still verify the complete 498-handler manifest; it has not been disabled.

**Status remains NO-GO:** root GET retains its previously provisional GET-only credit; root POST/PATCH remain GAP with `testedBy: null`. Fresh exact-head full CI, security HTTP and PG18 post-cutover tests, plus independent tenant/security review, are required. No payroll, external provider, production or release activation is authorized.
