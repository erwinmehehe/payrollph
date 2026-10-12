# RFC: Multi-legal-entity isolation, filings and service-continuous employee transfers

**Status:** DESIGN FOR REVIEW — not approved for implementation, deployment or migration  
**Repository baseline:** `erwinmehehe/payrollph`, `main` at `76b6f8f589f0bd6daff89fe98479db933ade6a98` (checked 2026-10-12 Asia/Manila)  
**Scope:** multiple legal employers inside one tenant; entity-specific statutory registrations, payroll and BIR, explicitly authorized group-HR read, governed transfers with uninterrupted service history  
**Non-goals:** changes to `src/lib/payroll-engine.ts` formulas; cross-tenant consolidation; bank movement; automatic government submission; backdating published payroll or filings.

This is the mandatory pre-code design gate. **No SQL migration, flag, route, test or payroll math change is part of this RFC PR.** Review decisions at the end before implementation.

## Existing main — reuse, do not duplicate

* `drizzle/0045_multi_legal_entities.sql` already creates `legal_entities` with BIR TIN/branch, SSS, PhilHealth and Pag-IBIG employer numbers, disbursement details, plus `employees.legal_entity_id` and `payroll_runs.legal_entity_id`. It creates/backfills a PRIMARY employer. Those two ownership columns are still nullable in the Drizzle model.
* `drizzle/0065_legal_entity_compliance_scope.sql` already backfills and makes nine filing/remittance/compliance entity columns NOT NULL, and entity-scopes key uniqueness. Do not replay or rewrite these historical migrations.
* `src/lib/legal-entity.ts` has `ensurePrimaryLegalEntity` and `resolveComplianceLegalEntity`. `src/app/api/legal-entities/route.ts` manages registrations and refuses direct reassignment after released payroll with `LEGAL_ENTITY_TRANSFER_REQUIRES_WORKFLOW`.
* `src/app/api/payroll-runs/route.ts` and the existing payroll engine already bind new payroll to one legal employer. `src/app/api/bir/annual-employer/route.ts` and `src/lib/bir-employer-reconciliation.ts` already expose employer-specific BIR reconciliation and **fail closed** for unattributed imports or cross-employer earnings. Preserve that barrier until explicit historical attribution is implemented.
* `worker_effective_changes` and `worker_employment_events` already hold approved target employer and from/to employer events; the effective-change worker updates the employee's current employer. Neither alone is a canonical, nonoverlapping employer-assignment interval ledger for payroll history.
* `user_organizations` allows one organization membership with a role and optional org unit; `src/lib/access.ts` currently treats a null org unit as `companyWide`. There is no entity grant in that membership. For example, tenant-wide employee and payroll list paths currently enumerate across entities for company-wide members. Do **not** treat `companyWide` as cross-entity authorization.
* Existing tests `tests/multi-legal-entity.test.ts` and much of `tests/legal-entity-compliance-scope.test.ts` inspect source strings. They are useful historical guardrails, **not** acceptable new isolation acceptance evidence; new tests must execute requests, SQL queries, permissions and transfer behavior.

## Architectural decisions proposed

1. `organization_id` remains the **tenant boundary**. The repository's existing column name `legal_entity_id` is the correct implementation of the requested `entity_id`; do not add a competing `entity_id` alias.
2. A legal employer is `(organization_id, legal_entity_id)`, validated as one pair for every entity-owned row, query, mutation, background job, export, file download, approval, webhook and audit reference. Client-supplied IDs never establish access on their own.
3. `employees.id` remains the stable **person/worker identity inside one tenant** across legal-employer transfers. `employees.legal_entity_id` is only a current-state projection; employer of record for past earnings is the immutable effective-dated assignment and the payroll run's employer snapshot, **never the current employee row**.
4. Each payroll run, statutory batch, bank disbursement and government filing has exactly one legal employer. Group HR may view authorized cross-entity workforce history but does **not** consolidate legally separate BIR/agency submissions or acquire maker/checker/release rights.
5. Sensitive identifiers and bank numbers remain encrypted/masked under existing controls. Employer SSS/PhilHealth/Pag-IBIG/TIN registrations are per legal entity. A worker's personal TIN/SSS/PhilHealth/Pag-IBIG identifiers follow the person; they must not be falsely rewritten as different employer numbers.
6. Do not infer retroactive legal or 13th-month liability from group membership alone. Service continuity and allocation of statutory liabilities are separate, recorded decisions requiring Philippine HR/payroll/legal review.

## Table inventory: direct `legal_entity_id`

Inventory is based on all `pgTable` definitions in `src/db/schema.ts` on the pinned commit and both existing multi-entity migrations. “Direct” means a persisted scope column and a tenant-consistent reference, not merely a UI filter. For append-only money/legal evidence it records ownership at creation and never changes when the employee transfers. Existing fields should be tightened, not duplicated.

### Already present — retain and validate (16 tables)

| Table | Existing entity ownership | Required follow-up |
| --- | --- | --- |
| `employees` | nullable `legal_entity_id` | Canonical current-employer cache; backfill/validate and eventually NOT NULL for active workers |
| `payroll_runs` | nullable `legal_entity_id` | Historical employer snapshot; validate run/entry consistency; eventually NOT NULL |
| `org_units` | nullable `legal_entity_id` | Validate org-unit/employer relation; an unscoped group unit may stay nullable only if non-payroll |
| `positions` | `legal_entity_id` | Validate target-employer membership on moves/assignments |
| `compensation_bands` | `legal_entity_id` | Keep explicit employer or documented tenant-wide policy template; disallow unsafe fallback |
| `labor_gl_mappings` | `legal_entity_id` | Prevent expense export crossing legal ledgers |
| `payout_profiles` | NOT NULL `legal_entity_id` | Keep one profile per employer; bank template itself is not employer-owned |
| `government_filing_validations` | NOT NULL `legal_entity_id` | Preserve run-linked employer and accepted evidence |
| `bir_withholding_remittance_batches` | NOT NULL `legal_entity_id` | BIR 1601-C per employer |
| `statutory_remittance_batches` | NOT NULL `legal_entity_id` | SSS/PhilHealth/Pag-IBIG per employer |
| `statutory_remittance_members` | NOT NULL `legal_entity_id` | Must equal parent batch employer |
| `statutory_remittance_month_closures` | NOT NULL `legal_entity_id` | Per-employer remittance close |
| `statutory_contribution_issue_cases` | NOT NULL `legal_entity_id` | Preserve liability employer after a transfer |
| `government_loan_remittance_batches` | NOT NULL `legal_entity_id` | Per-employer remittance file |
| `government_loan_remittance_members` | NOT NULL `legal_entity_id` | Must equal parent loan batch employer |
| `payroll_month_closures` | NOT NULL `legal_entity_id` | Per-employer payroll month-close snapshot |

`legal_entities` is the parent table with primary key `id` and `organization_id`; it does **not** need a self-referencing `legal_entity_id`. Add/validate a unique key on `(organization_id, id)` to support composite FKs.

### Add a direct immutable employer for this capability (reviewed migration work)

| Tables | Proposed addition / reason |
| --- | --- |
| `payroll_entries`, `payroll_jobs`, `payslips` | Persist the run's legal employer; composite FK/check to run, protect ID-based reads, queue execution, payslip and export downloads |
| `historical_payroll_entries`, `year_end_adjustments` | Mandatory source employer for each imported earning and per-employer annual tax adjustment; never infer from employee's employer *today* |
| `import_batches` | Source employer for a single-employer file; mixed-entity imports require explicit per-row attribution and may use a nullable batch-level summary only |
| `payroll_underpayment_requests`, `employee_pay_retro_adjustments` | Employer that owns a historical correction; prevent a later transfer changing settlement target |
| `supplementary_earnings`, `de_minimis_grants`, `employee_mwe_classifications` | Employer-specific payroll/tax inputs; effective/pay period and employer must agree |
| `managed_payroll_engagements`, `managed_payroll_gates`, `managed_payroll_run_approvals` | Separate operational approval and vendor handoff by employer; child checks must equal linked run/engagement |
| `payout_batches`, `payout_transfers`, `payout_batch_transfers` | Immutable paying employer; composite run/batch/entry checks before attempting bank movement |
| `bank_file_validations` | Preserve employer even if optional `payroll_run_id` is cleared; files must never be fetched using tenant alone |
| `employee_payout_change_requests` | Scope payer-specific bank/mobile change approval; never approve using a different employer's reviewers |
| `dole_reporting_profiles`, `dole_compliance_submissions` | DOLE establishment/13th-month reporting per legal employer. Replace profile's current single-tenant primary key with reviewed `(organization_id, legal_entity_id)` uniqueness; do not destructively rewrite before dual-read cutover |
| `statutory_remittance_payment_evidence`, `statutory_posting_evidence_artifacts` | Ownership of downloaded/uploaded files; must match linked batch |
| `statutory_remittance_correction_requests`, `statutory_contribution_issue_events` | Scope mutation/appeal/evidence to the immutable parent batch/case employer |
| `employee_loans`, `loan_payments` | Record employer that authorized a deduction and employer/run that collected it; cross-employer continuation requires new approved authorization |
| `separation_records`, `leave_conversions` | Employer legally responsible for final-pay release; keep earlier employer evidence in service-continuity ledger |
| `worker_effective_changes`, `hcm_employment_terms` | Capture **source** employer for effective change/term; existing `target_legal_entity_id` is a destination, not a substitute for source ownership |
| `employee_pay_profiles`, `employee_pay_revisions` | Bind pay terms/revisions to the employer and their valid interval; do not let a new employer alter prior pay basis |
| `approval_tasks`, `approval_chain_instances` | Persist legal employer whenever source is payroll/filing/transfer; unique source validation and entity-matched maker/checker lookup |
| `time_punches`, `workforce_timesheets`, `workforce_timesheet_expectations`, `employee_schedule_assignments` | Snapshot work-employer for dated payroll time; prohibit an attendance period spanning two employers without attribution/splitting |
| `attendance_correction_requests`, `workforce_attendance_period_locks` | Scope correction and cutoff human review to the affected employer, not today's employee employer |
| `expense_claims`, `earned_wage_requests`, `benefit_enrollments` | Employer accountable for financially affecting employee benefits/claims or payroll advance, where source date is employer-specific |

**Rule:** materialize the new column on records that independently authorize, settle, export, approve or disclose an employer-specific liability; verify `organization_id` and parent entity with composite FKs and application authorization. New nullable fields are permitted only during the explicit backfill stage, not as permanent ambiguous scope.

### New tables (all with `organization_id` and `legal_entity_id`)

| New table | Purpose |
| --- | --- |
| `legal_entity_statutory_registrations` | Effective-dated employer registration versions (`bir_tin` + branch, `sss`, `philhealth`, `pagibig`), uniqueness for current agency/branch record, history of approval/changes. Existing `legal_entities` registration fields remain a read projection during rollout, not an independent writable source of truth |
| `user_legal_entity_grants` | Tenant membership + entity + permitted role/scope; explicit grants, revocation and actor evidence |
| `employee_legal_entity_assignments` | Nonoverlapping `effective_from` / `effective_until` employer-of-record intervals for stable `employee_id`; link to approved `worker_effective_changes`/`worker_employment_events` |
| `employee_entity_bank_accounts` | Encrypted, effective-dated employee payout destination **as approved for a payer entity**; historical payout snapshots remain immutable |
| `legal_entity_transfer_liability_evidence` | Signed transfer classification, service-continuity decision, old/new employer allocation for 13th-month, final-pay and agency/BIR handoff, reviewed by separate actors |

Add explicit source/target employer references to transfer records where needed; **do not** flatten `worker_employment_events.from_legal_entity_id` and `to_legal_entity_id` into one misleading `legal_entity_id`. The event is a two-employer transition.

### Inherit via a bound parent; no redundant direct column unless a direct-access audit finds a need

These records still require **entity-scoped query checks and composite parent membership**, but ownership can safely be inherited from an immutable parent when access always joins the parent: `position_assignments` (as-of position/assignment plus immutable transfer record), `schedule_pattern_days` and `schedule_pattern_segments` (scoped pattern), `statutory_remittance_members`' child receipts already have the direct column above, `approval_chain_instance_steps` (scoped approval instance), `managed_payroll_run_approvals`' linked run must still be checked even after direct column added, `leave_request_intervals` and `leave_request_interval_sets` (scoped request), `pay_policy_rules` (scoped policy), `bank_templates` (global non-employer file format specification).

The individual employee ID fields `employees.tin`, `sss_no`, `phil_health_no` and `pag_ibig_no` are **person-level government IDs**, not employer registrations. Keep their existing encrypted envelope and personally authorized access. A future identifier-version table, if added, should attach to employee identity plus evidence without pretending a person's government number changes on each transfer. `employees.bank_account` is the legacy person record; migrate payroll-destination authority to `employee_entity_bank_accounts`, keep legacy compatibility read-only until parity and review, and never store clear bank numbers.

**Inventory rule for implementation:** audit every SQL/Drizzle table in `src/db/schema.ts`, every migration-created object, and every employee/run/filing/approval/bank file API, including V1 APIs, exports, queues, background jobs, download tokens, self-service and administrative screens. For any additional employer-specific table identified, update this inventory and obtain review before adding SQL. Tenant-only/global configuration tables such as `users`, `organizations` and `bank_templates` do not get a fake employer ID.

## Authorization and isolation

**Access model:** keep `user_organizations` for tenant membership. Add `user_legal_entity_grants` for entity role assignments; resolve `organization_id` from authenticated membership, then resolve legal employer against the same tenant; require explicit entity grant for entity-scoped readers and writers, even when `getAccess().companyWide === true`.

| Principal | Data read | Mutation / approval |
| --- | --- | --- |
| Entity HR / payroll / checker / manager | Only granted employer **and** existing org-unit scope | Existing role + entity grant + maker/checker + MFA where required |
| `group_hr` role (new) | Read-only workforce and sanctioned payroll/service history across legal entities **within its tenant** | No create/edit/payroll prepare/check/release, statutory filing submit, plaintext identifier or bank account read |
| Owner/admin/bookkeeper without `group_hr` read permission | Explicitly granted employer records only; may manage employer configuration via separately authorized admin path | No implicit group-wide personnel/payroll read from company-wide/org-unit-null membership |
| Employee self-service | Own employee identity plus historically earned/pay statements, regardless of former employer, after strong identity check | Existing narrow self-service actions only |
| Foreign tenant membership or ungranted employer | No rows, counts, existence hints, file bytes or search facets | Denied |

The “cross-entity read for group HR roles only” requirement means **no** unconditional owner/admin/company-wide cross-entity shortcut. A group HR grant is tenant-local and never becomes cross-tenant authorization. Read-only group HR views must mask sensitive personal and bank identifiers and avoid raw per-employer registration secrets. Record group reads in audit events without logging PII.

Enforce filtering at SQL/query construction (`organization_id` AND `legal_entity_id IN authorized IDs` or single ID); avoid fetching all tenant rows then filtering in JavaScript. Resource-by-ID endpoints must fetch/authorize the resource's immutable employer before returning 200, file contents, 404/403 distinctions, counts or job status. Re-check grants inside workers and long-running workflows, with scoped service identity. Use composite FKs and validated constraints as a second boundary; assess Postgres RLS only as defense in depth and do not treat it as a substitute for application checks. Add equivalent entity conditions to V1 APIs, internal integrations, paginated searches, aggregates, CSV/DAT exports and signed downloads.

### Maker-checker / treasury preservation

* Transfer request/approval/application must use different stable user IDs for maker and checker, capture reviewed snapshots, be MFA-checked where applicable, and be transactionally audited.
* Payroll prepare, check, release and any later disbursement remain separate permissions; cross-entity group HR read never authorizes any one of them.
* Registration changes and payout destination changes retain existing sensitive-data controls and independent approvals. No draft, move or preview creates a payment or edits a released ledger.
* Agency/Bank artifacts remain linked to the **source legal employer** that owns the underlying period, even after employee reassignment.

## Employee transfer design

**Single stable employee ID, multiple immutable legal-employer assignments.** Proposed API routes use the existing governed `worker_effective_changes` approval/workflow rather than providing a second direct field-edit shortcut.

1. **Propose:** entity HR with source-employer authorization chooses target employer in the same tenant, an Asia/Manila effective date, reason, continuity classification and attachment; destination approver access is verified. Inspect payroll cutoffs, time and leave accrual, pending loans, year-end and final-pay obligations, bank approvals, active position assignment and overlapping requests. No transfer mutation yet.
2. **Review:** distinct checker with allowed scope sees from/to snapshot and liability handoff plan. Reject self-approval, stale snapshots, future/past conflicts, foreign-tenant target, inactive employer or ambiguous historical employer. Preserve existing HCM maker-checker status model.
3. **Apply on effective date:** under a DB transaction and employee lock, close old `employee_legal_entity_assignments` interval the prior calendar day, open the target interval, append an immutable `worker_employment_events` from/to record, update only `employees.legal_entity_id` as current projection, and seal actor/evidence. Retry must be idempotent; failed audit/approval rollback means no half-transfer. No silent retroactive move.
4. **Payroll boundary:** reject unsplit/unreleased payroll, draft approval, attendance or cutoff window straddling the effective date. Old earnings, loans, 13th/month-close, statutory postings, filed tax and bank artifacts remain pinned to their original entity. New work belongs to target entity from the effective date. Historical reads use payroll-run and assignment-time ownership, not today's `employees.legal_entity_id`.
5. **Service continuity:** preserve initial `employees.start_date` and employment event timeline; compute a service-period view spanning intra-tenant moves for potential 13th-month and final-pay tenure **without** automatically treating old/new employer obligations as the same. Produce employer-separated basic salary, 13th already paid, unpaid balances, leave, final-pay allocation and withholding evidence. A payroll/legal reviewer chooses and attests the liability transfer/settlement rule before an entity-specific final-pay, year-end or government artifact can be approved.
6. **Reporting:** BIR annualization (`1604-C`, `2316` and monthly `1601-C`), SSS, PhilHealth and Pag-IBIG filings remain strictly per paying employer using historical run/import attribution. For a worker paid by two employers in a tax year, do not reuse one organization-wide `year_end_adjustments` row for both. Existing `CROSS_EMPLOYER_PAY` / `IMPORTED_HISTORY_SCOPE` blockers remain until per-employer attribution and reconciled annual evidence are actually implemented and reviewed.

**Rule of interpretation:** 13th-month/final-pay service **continuity** is not an automatic assertion that the successor employer must assume all former employer liabilities. Require explicit company/legal decisions and immutable evidence for each case. Do not change statutory computation formulas or retroactively rewrite released payroll.

## Migration and release plan (implementation AFTER review only)

**Stage 0 — reconcile DB history and inventory.** Fetch latest `main` again immediately before coding; compare source definitions with DBA-supplied production schema, previously applied `0045`/`0065` receipts and all subsequent numbered migration hashes. The repo currently includes duplicate historical numeric prefixes and compatibility DDL (`src/lib/core-schema-compat.ts`). Follow `docs/engineering/sql-migration-release-protocol.md` and `docs/engineering/production-migration-receipt-runbook.md`. Do not replay history, rename old files, or use `drizzle-kit push` on production. Number the new migration **contiguously after latest main on implementation day**, not from an assumed prefix in this RFC.

**Stage 1 — additive schema behind default-OFF flag.** Add new interval/grants/registration/destination/evidence tables and nullable direct columns to existing rows, composite unique keys and indexes (`organization_id` first). Keep old API behavior available only if its authorization is safe; new group read and transfer actions are inaccessible while the flag is false. **Security boundary checks are fail-closed regardless of the flag**, including preexisting multi-employer tenants.

**Stage 2 — evidence-led backfill.** Each existing tenant receives exactly one verified PRIMARY entity if none exists. Reuse previous `0045`/`0065` ownership. For new child columns, derive from immutable parent run/batch/filing/approved event; for money/history with no trustworthy parent, create an exception queue. The fallback to PRIMARY is allowed **only** when pre-multi records are independently proven to belong there. Never backfill a past run by the employee's current entity after a transfer. Import history must carry an explicit source employer or remain blocked. Copy current employer registrations into versioned records and employee payout destinations into encrypted, scoped records, comparing masked/hashes rather than exposing secrets.

**Stage 3 — verify, constrain, dual-read.** Reconcile row counts, per-employer sums, taxpayer/registration continuity and immutable references at centavo precision. Use not-valid FK/check constraints then validate on a rehearsed isolated clone where appropriate; add `NOT NULL` only after **zero** unattributed mandatory rows and transaction guards are verified. Replace single-tenant uniqueness in DOLE/annual/other applicable tables with tenant+employer keys without deleting or altering accepted evidence. Keep registered projections reconciled from one authoritative path.

**Stage 4 — enforce in application paths.** Implement a central entity-scope resolver and DB predicates for list/detail/write/export jobs; retrofit group HR read, V1 APIs, stat filings, bank artifacts, employee IDs and payout views. Integrate interval-aware transfer with existing HCM approval and workforce time cutoff. Keep maker/checker checks independent from entity grants. No `payroll-engine.ts` formula changes. New feature flag in `src/lib/critical-release-flags.ts`: **`MULTI_LEGAL_ENTITY_V2_ENABLED`**, default false and enabled only for exact env string `true`, plus optional allowlisted pilot tenants. Flag OFF must not make otherwise prohibited cross-entity reads permissible.

**Stage 5 — staged test/activation/rollback.** Run isolated migration/backfill with synthetic two-tenant, two-entity and transfer fixtures, independently review financial evidence, then shadow/read parity and explicit tenant pilot. Activation requires DBA, security/privacy, Philippine payroll and HR approvals. Application rollback toggles the flag OFF and **leaves additive schema + immutable historical evidence intact**; destructive down-migrations or rewriting filings are not a safe rollback. Retain backfill reports and approvals.

## Behavior-first acceptance matrix (must be executed)

| Test | Required assertion |
| --- | --- |
| Foreign tenant IDs across entity APIs | Tenant A roles cannot list, fetch by ID, mutate, export or download Tenant B employee/payroll/filing/bank/evidence data, even by guessed IDs or changed query params |
| Same tenant, two employers | Entity-A HR/payroll/checker cannot list/search/fetch/count/download/export Entity-B employees, runs, TINs, evidence, bank profiles or approval tasks; including pagination and async jobs |
| Group HR | Explicit `group_hr` can read authorized workforce/pay history from both A and B within its tenant, but cannot mutate, approve, release, expose clear bank/IDs or read another tenant |
| Employer registration | Two entities can have different SSS/TIN/PhilHealth/Pag-IBIG employer numbers; exports and filings use correct historical employer for selected run/month |
| Transfer lifecycle | Unapproved/self-approved/cross-tenant/inactive-target/stale/replayed/backdated transfer fails without mutation; approved future-dated move applies exactly once on correct Manila date |
| Historical isolation after transfer | Entity A retains rights to **its** old released run/filing; Entity B cannot access A's old payroll just because worker is now assigned to B; Entity B creates only B-period payroll |
| Straddling period | A transfer in the middle of payroll or attendance period cannot silently mix employers, duplicate an entry or bypass human time review |
| Thirteenth/final pay | Service timeline spans A→B, but 13th/basic pay/leave/withholding and final pay liability are each attributed and reconciled to source employer; unresolved classification blocks release |
| Filings and imported history | Cross-employer BIR annualization is separated; unattributed import blocks; neither old `1601-C` nor `1604-C`/`2316` is relabeled from current employee employer |
| Sensitive payout and maker-checker | Bank account remains encrypted/masked; source/destination approvals cannot be self-approved; payer-specific file/transfer cannot use another entity's account |
| Flag disabled | New group-HR/transfer capabilities unavailable, existing payroll unchanged, tenant and entity security still deny ungranted access |
| Financial/regression | Golden outputs remain byte/cents-equivalent absent approved new attribution; no unexplained centavo differences; no new ledger/payment on preview or transfer |

Tests must **execute behavior**: real HTTP handlers and DB rows under isolated PostgreSQL fixtures, plus transfer/filing functions and adversarial role combinations. Do **not** add source-grep tests. Include concurrency/replay, exact resource ID, export and background-worker cases; avoid solely mocking the authorization helper being tested.

Before claiming implementation complete, run the actual repository checks:

```sh
npm run typecheck
npm run lint
npm run payroll:golden
npm run payroll:golden:phase2a
npm run payroll:golden:phase2b
npm run payroll:golden:pay-rules
TZ=Asia/Manila npm test
```

Ensure **no new lint warnings**, no broken golden payroll cases, new behavior tests green, and full suite green. The design-only PR does not claim these implementation exit criteria.

## Decisions required at review

1. Confirm tenant-stable `employee_id` and explicit source/destination legal-employer intervals instead of making duplicate employee records for each company.
2. Approve strict interpretation of “group HR only”: a dedicated **read-only**, tenant-scoped group role, with no implicit owner/admin cross-entity personnel or payroll visibility.
3. Approve versioned employer registrations and encrypted per-employer payout destinations as the authoritative sources, with legacy fields retained temporarily as projections.
4. Decide Philippine legal/payroll treatment for continuity, inter-employer 13th-month liability, final-pay settlement, tax/`2316` and government-loan handoff; document choices and agency-format signoff **before** coding financial release paths.
5. Approve the direct-column vs parent-derived inventory above, and the policy that ambiguous historic imports/filings must remain blocked rather than silently backfilled to PRIMARY.
6. Approve DBA-led additive migration/receipt/rollback controls, exact implementation release flag, and behavioral two-tenant/two-entity acceptance gate.

**Stop point:** after review approval, re-fetch force-updated `main`, reconcile concurrent PRs and production schema, then implement in separate, narrow, flagged PRs. No implementation before that sign-off.
