# Durable compensation notification delivery and recovery

This workflow covers secondary Automation Studio notifications produced by **scheduled salary application** and **recurring compensation activation**, including approvals that become active immediately on the Philippine effective date. It does not grant authority to change pay, recalculate released payroll, initiate payout, or replay financial approvals.

## Correctness contract

- Applied salary and activated recurring compensation (whether via future-dated scheduler or same-day approval) persist immutable `compensation.changed` and `employee.field_changed` intent snapshots in `compensation_automation_intents` **inside the same database transaction** as their compensation event and source state.
- A transaction failure cannot leave a financially applied change without its notification intent. No backfill or fabricated historical activation is performed.
- After commit, immediate delivery may attempt the queued notification; the worker scheduler also drains due intents. The original compensation status is **never** modified by delivery or retry.
- Stable `organization_id + trigger + event_key` deduplication is enforced by PostgreSQL. The Automation Studio event ledger and per-rule execution uniqueness are separate guards.
- The dispatcher accepts only `completed`, `waiting` and `waiting_approval` rule outcomes as handed off. Failed, partial, skipped, or ambiguous outcomes are sent to **needs_review** for the existing governed Automation Studio execution process.
- A transient failure **before** the Automation Studio event ledger may retry automatically with bounded exponential backoff (60s, 120s, 240s, 480s, 960s; maximum five attempts). After a ledger footprint or uncertain worker crash, the intent is **never automatically replayed**, because downstream external actions may already have occurred.
- An expired dispatch lease is quarantined. The operator recovery command refuses to reopen it; it is not proof that the worker did nothing.
- Delivery state `dispatched` means accepted by the Automation Studio engine, **not** that an email, webhook, Slack action, approval, or third-party operation was delivered. Investigate execution-level results separately.

## Deployment sequence

1. Review the single integrated PR #626 against the latest `main`; **do not merge overlapping source PRs #612/#614/#615/#617/#620/#623/#625 individually**. Recheck the same-day approval path, schema, migrations, security and tests on the exact integrated head.
2. Apply the retained migration `drizzle/0100_compensation_automation_intents.sql` (or the approved equivalent generated from Drizzle schema) to **staging first**, then production only after review. Ensure the database migration is committed and verified *before* workers or app routes that reference the table are deployed.
3. Exercise the database-backed regression suite and a synthetic employer's salary and component transitions. Observe exact event keys, queue statuses, automation execution IDs, and full audit trace.
4. Inject an automation ledger failure before dispatch, verify a pending intent retries safely, then verify a ledger-existing or expired-lease case is held for human review instead of replayed.
5. Confirm scheduled worker draining is enabled. A deployment without the worker can queue events but cannot guarantee timely delivery after a crash.
6. Independently sign off on privacy, operational access controls, retry thresholds and the safe rollback plan. **No production payroll or external acceptance certification follows from these tests.**

## Read-only queue review

Use an explicitly scoped `DATABASE_URL` supplied by your organization's secrets manager. Prefer a reporting credential with SELECT-only rights. Never put DB passwords, pay context snapshots, or worker identities in GitHub comments.

```bash
npm run compensation:automation:audit -- 42 0 100
```

Arguments: `organizationId`, `afterId` (default 0), `limit` (default 100, maximum 250). The output lists only queue/event IDs, trigger, delivery status, attempt count and next retry time. Scan every page until `nextCursor` is `null`.

Audit exit codes: 0 = last page with no `needs_review` rows; 1 = this page has review findings; 2 = invalid input or DB error; 3 = no review findings on this page but another page remains. A clean page does not certify all tenant events.

## Human-reviewed recovery of demonstrably unstarted events

First determine whether Automation Studio has an authoritative event-ledger or execution record for this exact `organizationId + trigger + eventKey`. Any such record prohibits re-queueing this intent through this CLI; use Automation Studio's per-execution failed-step recovery and dead-letter review.

For a `needs_review` intent caused by exhausting **pre-ledger** retries, once an independent reviewer confirms the absence of any external activity, an authorized operator may run:

```bash
npm run compensation:automation:recover -- 42 73 "Reviewed by Payroll Ops" --confirm-reviewed
```

The operation must use privileged credentials approved for this specific employer, and it writes a separate audit record. It requeues **only** the original stored automation intent, resetting retry attempts; it never edits the compensation event or creates a new financial authorization. Authorization is an **operational access-control responsibility** of the CLI environment—this command does not implement interactive SSO/MFA or role verification itself. Do not grant it to general payroll viewers.

Do **not** use this command for `leased`, stale-lease, `dispatched`, or ledger-present events. It is intentionally restricted to intents tagged with exactly **five exhausted pre-ledger retry attempts**; even if the automation ledger is later purged, ambiguous/expired-lease dispositions remain permanently ineligible for this recovery path. An expired lease has uncertain side effects; engage a reviewer to reconcile external provider receipts and Automation Studio's execution evidence first. Do not issue a new event key to bypass deduplication.

## Monitoring

Monitor the scheduler response `compensationAutomationDelivery` for `retry`, `needsReview`, and `quarantined` counts and correlate intent IDs with Automation Studio. An intent can be `dispatched` while an underlying rule needs later execution-level attention; these are independent queues. A worker interruption after a financial commit must be reflected as a pending intent, not an instruction to rerun the payroll operation.

Migration intentionally does **not** backfill pre-existing changes. Legacy compensation events may predate this guarantee; reconcile them using signed original records instead of forging retroactive notifications.
