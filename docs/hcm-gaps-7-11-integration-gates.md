# HCM gap build status — B-8 through B-15

Updated: 2026-10-12. This candidate is default-off, reviewed through PR #889, and is NOT a complete multi-entity/approval-chain rollout.

## Existing foundations verified against force-updated main

* Legal employers and entity-scoped filing/remittance migrations 0045/0065 are already present. The comprehensive RFC is `docs/multi-legal-entity-scope-transfer-design.md`. It requests specific HR, legal, payroll, DBA and security decisions and is still **design for review**. No new entity-grant/transfer/filing implementation is included.
* Configurable approval-chain policies, immutable instances, amount thresholds, named/role routing and expiring delegations exist in migrations 0070/0071 and shared services. Five-source integration and days-based escalation are still **not implemented**. The separate `docs/approval-chain-extension-design.md` is also marked **design for review**. This candidate adds a behavioral regression proving payroll release rejects a maker acting as delegated checker, but does not represent full acceptance of source-specific approval chains.
* The existing released-run `generateJournalCsv` already provides a generic accounting journal export. No SAP or Workday connector is needed.
* The existing public v1 API, scoped revocable hashed keys, employee POST idempotency, rate limits and signed webhooks are reused. Migration 0110 is the existing provider-events ledger.

## B-10 — custom report builder

Files: `src/lib/hcm-report-builder.ts`, `src/lib/hcm-report-source.ts`, `src/app/api/hcm-report-builder/route.ts`, `src/components/workspace/hcm-report-builder-panel.tsx`.

A default-off page within Analytics now chooses approved People, Time or Payroll fields, group, exact department filter and date range, previews aggregates and exports audited CSV. The server checks authenticated tenant membership, company-wide HR/payroll role, custom permission set, release flag, bounds, MFA for CSV and sensitive-action rate limits. Salary columns require admin/HR/payroll (owner alone has no salary-export entitlement). It uses only explicit whitelisted fields, never user SQL. Existing CSV escaping defeats spreadsheet formula injection.

Data semantics are deliberately conservative:
- People headcount uses current worker status. Released separation events count as exits only in the selected window and are grouped as historically unattributed rather than retroactively assigned to a new department.
- Time absences count approved, fully-contained leave requests; approved OT request hours are not settled payroll OT. Employee department is current and labeled as such in the code boundary.
- Department payroll cost and OT cost use ONLY released payroll runs with an immutable stored run org-unit scope. Company-wide runs without historic department attribution fail closed instead of guessing based on the employee's current unit.
- Until entity-grant design approval, tenants with more or fewer than one verified legal employer are blocked. These constraints mean the builder does not claim generalized historical department cost across company-wide payroll.

## B-11 — public v1 API

Opt-in endpoints:
- `GET /api/v1/org-units` — new scope `org-units:read`.
- `GET /api/v1/payslips` and `GET /api/v1/payslips/:id` — `payslips:read`, released only; download audited.
- `GET /api/v1/events` — `events:read`, sanitized metadata-only cursor over provider_events where provider = linaw.
- Existing `/api/v1/employees` and `/api/v1/payroll-runs` remain unchanged. The static OpenAPI 3.1 file is `public/openapi/v1.json`; `/api/v1` advertises enabled additions.

All new routes authenticate revocable scoped API keys, rate limit and reject multi-entity tenants lacking entity-specific grants. The event producer captures event metadata when the flag is enabled. It deliberately does not persist or expose personnel webhook payloads in the feed and logs sanitized ingestion failures; this is not an exactly-once delivery guarantee. There is no customer-requested SAP/Workday connector.

## B-14/B-15 — engagement and goal/review pages

Flagged `/app/engagement` offers one 1–5 question with employee participation and company HR open/close administration. The additive `docs/engineering/migration-proposals/hcm-engagement-survey-aggregate.sql` and matching Drizzle schema store **only sum and count** for answers. A separate participation table has employee ID + survey ID but no rating or timestamp, preventing duplicate responses without a recoverable per-person score. During an open survey, even administrators cannot retrieve counts; after close, data is suppressed unless count >= 5. No arbitrary filter or team slice permits inferential small-group discovery. The feature remains off until privacy, retention and migration acceptance. Individual participation is identifiable; individual answers are not.

Flagged `/app/goals-reviews` lists existing performance cycles and links to the governed Performance workspace. It reuses existing goals/review cycle implementation and does not clone a second approval path.

## Default-off flags

- `PUBLIC_API_V1_EXTENDED_ENABLED=true`
- `TENANT_REPORT_BUILDER_ENABLED=true`
- `ENGAGEMENT_SURVEY_ENABLED=true`
- `GOALS_REVIEW_CYCLE_ENABLED=true`

Enable each env value as the **exact string** `true` only after the independent checks. New routes otherwise return 404. Never enable flags in production solely because source merged.

## Executed-behavior tests added

- `tests/hcm-report-builder.test.ts`: field whitelist, salary exclusion, aggregation, grouping and formula-safe CSV.
- `tests/hcm-report-source-db.test.ts`: actual PostgreSQL two-tenant/payroll/time dataset and historical attribution guard.
- `tests/public-api-v1-extended-db.test.ts`: real bearer scopes, tenant scoping, released payslips, revoked tokens, employer gate and event feed.
- `tests/engagement-survey-privacy.test.ts`: privacy threshold and group eligibility.
- `tests/engagement-survey-db.test.ts`: real PostgreSQL duplicate/replay races, independent tenant reads, no score on participant record and close state.
- `tests/approval-delegated-sod-behavior.test.ts`: maker acting as delegate is blocked by payroll release separation.

These test files execute service/route logic and DB behavior, not source text search. They still require CI execution to claim passing status.

## Launch/review holds

No schema migration has been executed against a customer database. Do not change `payroll-engine.ts`, existing maker/checker/release paths, payout destination authorization or government filing math. The full work request is NOT done until the two design RFCs receive signoff, their separately scoped implementations pass cross-entity and approval tests, the survey migration is rehearsed, field-access policies are reviewed and all CI/golden suites pass.

Required checks: `npx tsc --noEmit`, `npm run lint`, `TZ=Asia/Manila npm test`, and `npm run payroll:golden`, `payroll:golden:phase2a`, `payroll:golden:phase2b`, `payroll:golden:pay-rules`. GitHub Actions outcomes, not source presence, establish release readiness.


## SQL release order and Neon rehearsal (2026-10-12)

The queue reserves migration prefixes in creation order. Earlier PR #865 has reserved numbered SQL **0115-0119**, and PR #874 has reserved **0120**. Current `main` ends at 0114, and the SQL-history guard requires every newly landed number to be contiguous. Claiming 0115 here conflicts with #865; claiming 0121 now skips 0115-0120. The correct safe action is to keep the unchanged survey SQL as an **unapplied migration proposal** in `docs/engineering/migration-proposals/hcm-engagement-survey-aggregate.sql`, not an executable numbered migration in `drizzle/`.

The proposed survey SQL and existing 0110 were successfully rehearsed on the isolated Neon branch `pr-889-hcm-validation-20261012` (id `br-wispy-shape-b70h5pyj`, expires 2026-10-19). This rehearsal does not apply SQL to Neon main, grant migration authorization, or mark production activation as ready.

**Release hold:** the flag `ENGAGEMENT_SURVEY_ENABLED` must remain OFF until preceding canonical SQL is merged and journaled, the DBA assigns the next contiguous migration number to this exact reviewed proposal, branch-based rehearsal and receipt-backed application succeed in the intended environment, and an independent review approves rollout. `npm run db:push` in isolated CI creates test schema only and does not substitute for a production SQL migration journal.
