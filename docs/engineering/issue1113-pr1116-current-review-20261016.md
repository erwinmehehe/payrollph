# PR #1116 — Current schema-recovery review and release decision (2026-10-16)

## Follow-up checkpoint — 2026-10-16 (after original review snapshot)

- Independently fetched current GitHub `main` at `6f3b7b985a3fb16712aedad68fdde052a357e78a`; PR was **one commit behind** before the review-only guard update. That main commit changes HRIS synthetic browser QA/fixture files and its workflow, **not** the numbered `drizzle/` migrations. Do not treat this checkpoint as a source merge or updated application acceptance.
- Live read-only Neon identity/catalog confirmation on project `calm-wave-70219564`, rehearsal `br-mute-mode-b740q5zx`, database `neondb`: branch identity matched and **148 public tables** were observed. This is a catalog-only observation, not a new comprehensive column, permission or application acceptance run.
- Corrected a **NULL-sensitive preflight bypass** in the review-only expense-claim actor candidate: project and branch equality checks now use PostgreSQL `IS DISTINCT FROM` rather than `<>`. The original expression could evaluate to NULL when an identity setting was missing, and PL/pgSQL `IF` would not raise. The literal `__NEW_ISOLATED_NEON_BRANCH_ID__` marker and explicit exclusions for default and active QA remain intact. **No SQL was executed against any database to test this correction.**
- After this source-only change, recheck CI on the **new PR head** before citing successful checks. Existing green checks on earlier heads are historical only.
- **Decision remains DRAFT / NO-GO.** No release migration promotion, production/QA database writes, payroll disbursement, filing or permission changes are authorized.


> **STATUS: DOCUMENTATION / SQL CANDIDATES ONLY — DRAFT, NO PRODUCTION MERGE OR MIGRATION.**
>
> This is the *latest* evidence checkpoint for this PR. Earlier dated audit files are preserved as historical snapshots; do not use their old branch-capacity or "migration not rehearsed" statements as current facts.

## Current source and CI

- Latest independently observed GitHub `main` SHA prior to syncing this review branch: `f2ea37deb389148f3d8a7270b84db1a51a01e7ff`.
- The PR branch before syncing: `a1bf060d609d56d18d96e5c25c83bc3462c605f2` (six commits behind `main` at inspection). The newer main commits contain payroll centavo/final-pay evidence and related CI.
- PR #1116 is **open, draft, unmerged**, with **0 submitted reviews / 0 review threads** at inspection.
- Prior PR SHA `a1bf060...` had **18/18 completed successful GitHub checks** across 10 workflow runs, including CI regression shards, CodeQL, security HTTP smoke and SQL migration history advisory. Those checks are **not** authorization for production migrations or a guarantee that a newer commit has been tested. Check CI again after any source update.
- PR changes are under `docs/`: read-only contracts, explicit review-only SQL candidates, immutable schema comparison and rehearsal records. They do **not** modify production application routes, deployment secrets or numbered migration files.
- The fail-closed SQL delta must retain literal placeholder `__NEW_ISOLATED_NEON_BRANCH_ID__`; it rejects main (`br-lucky-sound-b79i56jw`) and active QA (`br-green-hat-b77qj8fs`). Neither source candidate is an approved DBA migration.

## Independent Neon schema observations against current main

Neon project: `calm-wave-70219564`, database `neondb`.

| Finding (main `f2ea37d...`) | Original/default Neon `br-lucky-sound-b79i56jw` | Isolated rehearsal `br-mute-mode-b740q5zx` |
|---|---:|---:|
| Tables declared by `src/db/schema.ts` | 271 | 271 |
| Public tables actually present | 136 | 148 |
| Declared tables missing in database | **138** | **126** |
| Existing declared tables missing at least one column | **11** | **3** |

The three rehearsal partial tables are `documents` (5 missing columns), `government_filing_validations` (3), and `job_applicants` (3).

**Important scope distinction:** This audit checks `src/db/schema.ts` declarations against public catalog column presence, not every secondary schema file, type/check/FK/index, RLS policy, permission, migration receipt or data contract. Object counts may not equal a complete schema-compatibility assessment.

### Completed isolated, additive rehearsal (not an approved release)

- A separate 23-statement transactional rehearsal covered archived `0033`, `0087`, `0102`, `0117` and the worksite/final-pay review-only delta.
- Six-table/86-column focused contract: **92/92 catalog objects present** on the isolated branch.
- Existing `0126` compensation migration: **28 guarded statements** succeeded; six compensation tables added there only.
- Additional existing source migrations `0014`, `0086`, `0091`, `0103`, plus the expense submitter FK review candidate: **25 guarded statements** succeeded there only.
- Direct first-payroll reader source-to-catalog checks: **35/35 complete**; read-only no-row SQL probes **8/8 passed**.
- Original business-data content preservation: **9/9 compared table row sets identical** to original default (orgs, units, employees, pay profiles, users, memberships, payroll runs/entries and punches). These are snapshots, not a continuous backup guarantee.
- Neither the original/default branch nor existing active QA was migrated in this PR or its rehearsals.

The historical migration files were **not recorded as adopted** in a production or QA migration ledger. This component-level testing is deliberately not represented as a full historical replay.

## Why production remains NO-GO

1. **Historical migration lineage has not been independently reconciled.** Current `drizzle/` contains **142 .sql files with 13 duplicate numeric prefix groups** and no `drizzle/meta/_journal.json`. Neither original nor rehearsal DB has `public.payrollph_migration_cutover`, `public.payrollph_schema_migrations` or `drizzle.__drizzle_migrations`. The forward-only reviewed runner explicitly requires DBA-approved full-path hash receipts and cutover; a green advisory SQL-history CI check does not adopt that ledger.
2. **Platform parity not reached.** Rehearsal still lacks 126 main-declared tables and has 3 partial declared tables. Current `main` includes `drizzle/0127_year_end_prior_evidence.sql` and other payroll certification changes; do not reuse migration prefix `0127` or extrapolate the earlier snapshot to current source.
3. **No application acceptance on the new rehearsal branch.** The existing protected QA deployment points to *another* Neon branch. Vercel has two **encrypted, branch-scoped fail-closed placeholders**, `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, for the PR's Preview ref; they intentionally do **not** represent a working rehearsal connection. Deployment to unverified inherited DB credentials is prohibited. A one-time secure project-level Neon–Vercel integration association is pending; never paste or transfer passwords to chat or GitHub.
4. **No signed payroll or statutory acceptance.** The original three fictional payroll header/detail mismatches remain open in issue #1102. Full employee-by-employee centavo reconciliation, signed-in browser login, 14-scenario workforce UAT, government import format acceptance and real filing/payment paths are NOT verified.
5. **Runtime compatibility DDL remains unresolved.** `drizzle/README.md` flags `src/lib/core-schema-compat.ts` as a separate unresolved production risk. The adopted migration runner cannot be treated as permission to disable runtime DDL until the full read-only parity and deployment plan is approved.

## What must be done to change this draft decision

- [ ] Have the DBA/release owner verify **all historical migration receipts** and branch-specific cutover journal in a separately authorized staging plan. Do not infer receipts from existing objects.
- [ ] Document and review outstanding main-rehearsal differences by subsystem. Prioritize 126 missing tables and three partial tables, plus the latest main changes.
- [ ] Securely associate the correct Neon project/branch with an **isolated Preview** without changing existing QA/Production credentials; runtime health must assert exact Neon branch before any application data action.
- [ ] Execute authenticated **GET-only** read acceptance on that Preview, then separate sanctioned fictional write-path acceptance.
- [ ] Repair demo payroll fixture seed sources; independently reconcile every employee and subtotal to within ₱0.01.
- [ ] Run remaining onboarding, workforce, browser auth, filing evidence and official-format UAT.
- [ ] Require independent code/DBA/security review and written production release approval before removing DRAFT status, merging any migration into the normal pipeline or touching the original Neon branch.

**Current decision: DRAFT / NO-GO for release. No real payments, filings, migration receipts or production database writes were performed.**
