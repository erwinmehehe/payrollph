# PR #927 — 14 October 2026 mainline reconciliation (source-only)

> **Status: BLOCKED / DRAFT / NOT RELEASE-CERTIFIED.** This file is an engineering source inventory and follow-up plan, not a DBA migration approval, DPO decision, production verification, or witnessed human acceptance. No live database, payroll, payout, government filing, candidate deletion, document provider, or production feature flag is authorized by this record.

## Exact sources examined

- Existing integration PR: [#927](https://github.com/erwinmehehe/payrollph/pull/927), head `5ab9bb0c9d7888c96e97d87f6fcba24b2c8e9c52`, branch `integration/a1-a6-release-rehearsal-20261012`.
- Observed mainline HEAD: `bf0281d7b8a5800655c390025043ab7654389af6`.
- GitHub comparison: **30 integration-only commits ahead; 271 main commits behind**; mergeability is false. Recheck every SHA and comparison at the next review; these figures are a timestamped observation, not a permanent baseline.
- Governance: [#920](https://github.com/erwinmehehe/payrollph/issues/920) reports the active P0-3 HCM/WFM source freeze; [#910](https://github.com/erwinmehehe/payrollph/issues/910) governs historical migration/receipt reconciliation. Keep this integrated source **out of main** until trusted source policy, DBA, independent reviewers and relevant acceptance gates permit a reviewed successor.

## Constituent PR disposition — do not replay merged changes

| Owner | Scope | 14 Oct disposition |
| --- | --- | --- |
| [#924](https://github.com/erwinmehehe/payrollph/pull/924) | A-1 schedules and floor preview | Merged |
| [#925](https://github.com/erwinmehehe/payrollph/pull/925) | A-2 applicant privacy/retention | Merged; feature activation remains separate |
| [#926](https://github.com/erwinmehehe/payrollph/pull/926) | A-1 loan release settlement | Merged |
| [#888](https://github.com/erwinmehehe/payrollph/pull/888) | A-3 HR cases/COE recovery | Merged; external document-provider acceptance is separate |
| [#911](https://github.com/erwinmehehe/payrollph/pull/911) | A-6 offboarding | Merged |
| [#896](https://github.com/erwinmehehe/payrollph/pull/896) | A-4 Spend reimbursements | **Open, DRAFT** |
| [#902](https://github.com/erwinmehehe/payrollph/pull/902) | A-5 document vault/expiry | **Open, DRAFT** |

The bundled PR is neither an upstream merge source nor a substitute for reviewing A-4 and A-5 at their **own latest heads**. See also [#928](https://github.com/erwinmehehe/payrollph/issues/928) for COE/private-object failure acceptance: helper source appearing on main does **not** attest real provider/commit-failure UAT.

## Source ownership: what is already on main vs. still proposed

Confirmed **byte-identical on the compared two heads**: `src/lib/hr-case-coe-object-reconciliation.ts`, `src/lib/document-object-storage.ts`, `src/lib/payroll-loan-schedule.ts`, `src/lib/offboarding-clearance.ts`, `src/lib/hr-case-policy.ts`, `docs/engineering/migration-proposals/employee-hr-cases.sql`, and `docs/engineering/migration-proposals/recruitment-applicant-privacy.sql`. Do not cherry-pick these duplicates as if they were still pending.

**Existing on both heads but diverged; preserve the current main implementation unless an independent owner verifies specific hunks:**

- `src/db/schema.ts` and `src/lib/critical-release-flags.ts`: mainline contains newer tables/flags; never replace either with the older integration copy.
- `src/lib/payroll-settlement.ts`, `src/lib/payroll-engine.ts`, `src/app/api/separation/route.ts`: financial/legal payroll logic has advanced; any A-4 change needs cents-level golden, tax/MWE, tenant, payout-isolation, concurrency and ledger evidence.
- `src/app/api/recruitment/privacy/route.ts`, `src/app/api/recruitment/route.ts`, `src/app/app/page.tsx`, and `.github/workflows/hris-journey-browser-qa.yml`: integrate only reviewed deltas and preserve recent protected-routing, 2-employer, mobile and CI checks.
- `src/lib/recruitment-applicant-retention.ts`, `src/lib/employee-document-vault.ts`, and the remaining HR document routes may contain later guard/retention fixes. Reconcile against current source owners, not just filename equality.

**Present on #927's head but absent under these paths on the observed main** (path-level inventory only; many are already owned by open #896/#902; absence is not proof that a replacement feature should be merged):

- **A-4:** `src/app/api/expenses/receipts/route.ts`; `src/lib/spend-payroll-reimbursement.ts`; `docs/engineering/migration-proposals/spend-payroll-reimbursements.sql`; `tests/spend-payroll-integration.test.ts`; `tests/spend-payroll-reimbursement.test.ts`; `tests/spend-receipts-behavior.test.ts`.
- **A-5:** `src/lib/employee-document-vault-verification.ts`; `docs/engineering/employee-document-vault-migration-plan.md`; `docs/engineering/migration-proposals/employee-document-vault-a5.sql`; `tests/employee-document-expiry-integration.test.ts`; `tests/employee-document-vault-generated.test.ts`; `tests/employee-document-vault-verification.test.ts`; `tests/employee-document-vault.test.ts`; `.github/workflows/a5-vault-migration-rehearsal.yml`; `scripts/rehearse-employee-document-vault-migration.cjs`.
- **Combined rehearsal only:** `.github/workflows/a1-a6-disposable-migration-qa.yml`; `scripts/rehearse-a1-a6-migrations.cjs`; `docs/engineering/migration-proposals/a1-a6-cross-tenant-fk-qa.sql`.

Do not copy all of these into main. The canonical A-4/A-5 owner PRs, migration train, duplicate-test coverage and security review determine which exact deltas remain necessary.

## Existing combined CI is stale against today's main schema

The `a1-a6-disposable-migration-qa.yml` job checks out the PR **base** `src/db/schema.ts` and runs `npm run db:push` in a disposable PostgreSQL container. The `scripts/rehearse-a1-a6-migrations.cjs` precondition then insists that `public.employee_hr_cases` and `public.applicant_privacy_evidence` **do not exist**. Both features are **already defined in the current main Drizzle schema**. Therefore the rehearsal precondition is incompatible with a current-main baseline. This is a source-level finding, **not** a claimed exact-head CI run.

Do **not** make the workflow green by dropping existing tables, ignoring failed SQL, replaying out-of-order historical migrations or replacing main with this stale schema. The successor must:
1. Start from a pinned **fresh current-main** SHA and verify which canonical migrations are actually already represented in its isolated baseline.
2. Include only **still-unmerged, reviewed** A-4/A-5 schema deltas; align their proposed objects/FKs with #910's approved historical successor sequence, without assigning a migration number without DBA.
3. Run disposable PostgreSQL 16/18 apply/rollback and cross-tenant negative fixtures, then exact-head TypeScript/lint, complete payroll golden phases, security/CodeQL, first-payroll/HRIS browser and flag-OFF parity.
4. Require verified protected-clone migration/restore receipts, real scanner/S3/R2 PUT/GET/DELETE behavior (including ambiguous PUT/failed DELETE), independent DPO/labor/HR/Finance/IT and payroll approvals, #691, and #579 **before** any launch/feature ON status.

## Next executable work package (source-only)

- Keep **#927 DRAFT and unmerged**. Do not auto-merge, force-update or replace current main's settlement/schema/flag files.
- Continue A-4 in **#896** and A-5 in **#902** separately, with each independently reviewed at its latest SHA. Fix real defects there, not by copying a stale integration tree.
- When canonical migration owners approve the remaining deltas, create a **new main-based, narrow integration rehearsal** to combine only those accepted changes and port relevant synthetic tests. Verify the exact integrated HEAD (not an old head or separate component CI).
- After identifying zero remaining unique deltas in #927, explicitly review whether to close it as **superseded by constituent PRs and a successor rehearsal**. Closing this PR is a source-maintenance decision, not production acceptance.
- Preserve #920's source freeze and all default-OFF flags; no live DDL, sensitive-record exports, production migrations, payout/filing, or real-object writes.

## Evidence provenance

The path comparisons, PR states, HEAD SHAs and source precondition checks were inspected via the connected GitHub repository on **2026-10-14**. No exact-head #927 CI execution, fresh full rebase, disposable PostgreSQL apply/rollback, human UAT, real provider write, live encryption audit or production deployment occurred as part of this review. All such boxes remain **NOT RUN / NOT VERIFIED** unless independent immutable evidence is attached.
