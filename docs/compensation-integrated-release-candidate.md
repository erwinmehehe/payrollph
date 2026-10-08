# Compensation release candidate — integrated review on main

**Release state:** engineering integration candidate only; draft and **not
approved for production**. This document does not authorize a real-payroll
change, migration, employer acceptance, payout, or employee-data backfill.

## Why a single integration branch

The earlier safety improvements were developed as reviewable draft PRs on
multiple, increasingly old branches. GitHub Actions passing on the individual
heads did not establish that they compose correctly on the latest `main`.
Merging separately could overwrite `src/lib/hcm-compensation.ts`, the database
schema, or governance regression tests, particularly as HCM/recruitment work
on `main` advanced during the compensation review.

This branch is built **from the current main commit**, retaining all unrelated
changes. It deliberately consolidates the following features:

| Original PR | Implemented protection |
|---|---|
| #612 | Locked atomic recurring-compensation expiration after the Philippine last payable day |
| #614 | Concurrent activation/expiration tests and read-only legacy ended-component evidence review |
| #615 | Activated-component financial event and operational audit in the same transaction |
| #617 | Durable, transactionally written compensation automation intents; bounded retry and governed recovery |
| #620 | Salary application, financial event, audit and three notification intents in one transaction; retryable evidence outages |
| #623 | Read-only applied-salary evidence reconciliation with tenant isolation and pagination |
| #625 | Distinct `0100` outbox migration, schema compatibility check and rollback-only rehearsal |
| #619 | Standalone salary/audit draft is **superseded** by the integrated implementation from #620; do not merge both |

**No upstream PR is auto-merged or closed by creating this integration branch.**
Reviewers should compare, approve and close superseded drafts deliberately.

## Core combined invariants

- Salary approval/application uses consistent proposal → cycle → employee
  advisory locks and atomically persists pay profile, worker basic rate,
  financial compensation event, operational audit and three stable automation
  delivery intents. Audit/intent infrastructure failures roll everything back
  and leave the governing proposal scheduled for retry.
- Recurring-component activation uses assignment lock `4222` and atomically
  persists activation, financial event, linked audit and two delivery intents.
- Recurring-component expiration shares assignment lock `4222`. It cannot
  end a component until **after** the last payable Philippine day, and
  atomically writes both the expiration event and audit. Neither an overlapping
  scheduler nor a retry can create a second expiration.
- An activation can race expiration without losing the two durable activation
  notification intents or duplicating payroll financial events.
- Notification failures after financial commit do not pretend to reverse pay.
  Auto-retry is limited to pre-automation-ledger transient failures; ambiguous
  deliveries/expired leases require a human execution review.
- Legacy ended components and applied salaries are reviewed with explicit,
  tenant-scoped, read-only queries. No missing audit record, salary approval,
  government proof or history is fabricated.
- Existing latest-`main` talent/requisition role-skill snapshot and other
  unrelated schema changes are retained alongside the outbox table. The
  original `0099_talent_role_requisition_skills.sql` and the compensation
  `0100_compensation_automation_intents.sql` remain distinctly named.

## Exact SHA engineering checks

Before marking the PR reviewable, verify the latest integration SHA (not only
the original PR heads) with:

- Full PostgreSQL unit/integration suite including joint
  activation-versus-expiration/outbox idempotence regressions;
- TypeScript, statutory/employee/lifecycle/pay-rules golden payroll, build,
  CodeQL, security smoke and payout isolation;
- Schema compatibility preflight after `db:push` on isolated CI Postgres;
- Additive outbox SQL executed twice in a rollback-only isolated schema,
  followed by constraint inspection.

Passing CI is **engineering evidence only**. Use the pinned exact commit SHA
and review diff to main; rerun checks after any conflict resolution or rebase.

## Staging release remains independently blocked

1. Owner/DBA review the `0100` DDL, deployment order, approved staging scope,
   backup and rollback plan. Install schema before deploying the new writers or
   workers and use a read-only credential to run the schema compatibility gate.
2. In an authorized **synthetic** staging employer, inject audit and outbox
   insertion faults and run parallel scheduled salary and recurring-component
   activation/expiration to confirm rollback, deduplication and recovery.
3. Verify the queue's post-commit retries and ambiguous-lease quarantine,
   including external-automation execution evidence, without replaying
   previously delivered actions.
4. Inspect all pages of each tenant-scoped legacy salary/component evidence
   review, recording reviewer disposition without generating false history.
5. Obtain independent employer-specific payroll, statutory, bank, privacy,
   backup/restore and release signatures through the existing
   [production GA gates](payroll-certification/production-ga-gates.md).
   **No real-money payroll/payout can be authorized from CI or this PR.**

If any check fails, preserve the original employer payroll state and stop
deployment. No tool in this branch initiates an actual staging deployment or
changes a production employee's compensation.
