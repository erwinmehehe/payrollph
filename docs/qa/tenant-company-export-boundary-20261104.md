# Company export tenant boundary hardening — draft source re-pin, no new credits

## Separate family and re-inventory
Only `GET /api/exports`, its source-owned parser, test, note, and **the mandatory one-method SHA entry** in the shared tenant-isolation coverage manifest are modified. No changes to shared coverage policy, promotion tests, migrations, payout, payroll engine or provider routes. The source-pin update can cause a **mechanical file conflict** with other open PRs that also touch the shared manifest; reconcile serially without discarding either method's evidence.

## Changes
- Require exactly one explicit, canonical positive `organizationId`, never implicit tenant 1.
- Authorize the authenticated session, active workspace membership and export role before employer-data reads. No GET-triggered `ensureSeedData()` write before authorization.
- Push organizational-unit restrictions into employee SELECT, and continue to apply existing legal-employer predicates.
- Select only employee, payroll or audit tables required by each export kind. The full JSON export still selects all three, with existing MFA and identifier masking.
- Serve all CSV/JSON downloads with private/no-store and nosniff headers.

## Historical coverage and new source
The **current main** manifest already classifies `GET /api/exports` as **provisionally COVERED** by historical two-owner fictional PG16 HTTP proof in `scripts/qa/tenant-high-risk-01-http.mjs`. The original source was `5a1156feb8d74d1f344e6e40e7bba8ebaee6849a`; this change pins the revised handler at `c7cabcccb0d618070ed0b36cfbeb8cd1aabc5584` while preserving the **same existing credit, not awarding a new one**. Historical HTTP proof is **not automatically transferable** to the new handler.

The previous CI run **Security HTTP Smoke** failed at the source-drift guard before the fresh cross-tenant acceptance could complete. That is why a source-only PR without updating the manifest could not pass CI. This commit reconciles the SHA and source metadata without relaxing the drift guard, changing the method's classification, or claiming completed acceptance.

## Required verification
- `npx tsx --test tests/company-export-tenant-boundary.test.ts`
- `npm run typecheck`
- Exact-final-PR-head **Security HTTP Smoke** in disposable PostgreSQL 16, which exercises `GET exports` for both real owners, a distinct populated victim employer, foreign-denial 403, and unchanged victim SQL snapshots.
- Independent security/coverage review to determine whether further evidence is needed for duplicate selectors, revoked membership and multi-entity ON/OFF cases.

**No new coverage method credits or new production authorizations.** Existing provisional credit is pending current-head revalidation. No production database, payment provider connection, money movement, or deployment.
