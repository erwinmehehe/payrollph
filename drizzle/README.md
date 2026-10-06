# Database schema

Nothing in the app creates its own tables, so a fresh database needs the schema
applied before the first request. There are three files here and they are not a
single ordered sequence, so read this before running anything.

## A fresh database

```
DATABASE_URL="postgresql://..." npm run db:push
```

`db:push` reads `src/db/schema.ts` and creates everything it finds there, which
is the whole current schema. **Check that it actually created tables**: push has
been seen to report success and create nothing against a non-standard Postgres.
Expect 90 tables. If it creates nothing, apply `baseline.sql` instead, which is
the same schema as plain SQL and can be pasted into the Neon or Supabase SQL
editor without any tooling.

## The files

- `baseline.sql` is the complete current schema, 90 tables, generated from
  `src/db/schema.ts`. It is deliberately unnumbered: it is a starting point for
  an empty database, not the next step in the numbered sequence below.
- `0001_payroll_periods_rbac.sql` and `0002_final_pay_reconciliation.sql` are
  historical increments from before the baseline existed. Their changes are
  already folded into `baseline.sql`, so applying them on top of it will fail on
  objects that already exist. They are kept for the history of a database that
  was migrated step by step.

There is no `meta/_journal.json`, so `drizzle-kit migrate` is not the workflow
here. Use `db:push` for schema changes, and `npm run db:generate` if you want to
review the SQL a schema change would produce before applying it.

## First account

Once the schema exists, visit `/setup` to create the owner account. That route
only works while the instance has no users; `POST /api/setup` returns 409 after
the first one, so it closes itself.

- `0021_performance_management.sql` adds the HCM performance foundation: cycles, employee goals, and formal reviews.

- `0022_job_architecture_positions.sql` adds job profiles, workforce plans, positions, and effective-dated position assignments.


- `0043_recruitment_position_handoff.sql` connects approved positions to requisitions and records the employee created by a governed hire conversion. `0024` is reserved by the compensation-governance tranche.

- `0042_compensation_governance.sql` adds salary bands, compensation review cycles and governed pay-change proposals.

- `0045_multi_legal_entities.sql` adds parent-workspace legal employers, entity registrations/payout policy, and legal-entity ownership on employees and payroll runs.

- `0046_wfm_staffing_scenarios.sql` adds immutable WFM staffing scenario snapshots with scoped manager submission/approval evidence.

- `0047_overtime_budget_controls.sql` adds monthly department/manager OT-minute budgets with advisory or blocking authorization controls.
