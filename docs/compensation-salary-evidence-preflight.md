# Applied salary evidence: read-only preflight and independent exception review

This report is for financial-control reviewers verifying **already applied** salary proposals against the linked financial record, operational audit and durable automation intents. It is **not** a payroll computation, legal certification, government filing acceptance, or approval to make transfers.

## Deployment dependency

This tool depends on the compensation automation outbox created by PR #617 and the integrated atomic salary/audit/outbox workflow in PR #620. Retain the correct merge order and install the `compensation_automation_intents` database migration **before deploying any read or write code that references it**. This PR is stacked on #620 and is not independently deployable on the current `main`.

The report intentionally does **not** create or reconstruct any missing historical records. Salaries applied before adoption of the transactional audit/outbox will often appear as missing evidence. They must be reviewed against independently signed records, not marked falsely certified, and never silently backfilled.

## Run for one authorized employer

Use your organization's approved secrets manager to provide `DATABASE_URL`; use a dedicated PostgreSQL SELECT-only reporting account where possible. Do not paste credentials into a GitHub issue or share the raw database contents.

```bash
npm run compensation:salary:evidence -- 42 0 100
```

Arguments: organization ID (mandatory), after-proposal cursor (default 0) and page size (default 100, maximum 250).

The inspection runs inside a **repeatable-read, read-only PostgreSQL transaction** and explicitly scopes proposals, events, audit records, revisions, cycles and notification intents to the supplied organization. It returns IDs and discrepancies only, never worker names, pay amounts, bank details, audit metadata or automation payloads.

Interpret exit codes: `0` = no discrepancies on the **final** page; `1` = page contains unresolved findings; `2` = invalid arguments or query error; `3` = clean page but **additional pages exist**. A clean individual page is not evidence that a whole employer is reconciled. Pass the `nextCursor` as the next page's after-proposal cursor until it is `null`.

## What the preflight checks

| Evidence relationship | Finding examples |
|---|---|
| Applied proposal to governing cycle/revision | Missing cycle, missing pay revision, employee or effective-date mismatch |
| Applied proposal to financial event | Missing/duplicate `salary_change` event, incorrect employee, pay revision or effective date |
| Financial event to operational audit | Missing/duplicate `Scheduled compensation change applied` audit, broken event or revision linkage |
| Event to notification intents | Missing/duplicate/unexpected intent, wrong trigger, wrong employee |
| Notification processing | `needs_review` state requires operator attention |

A successful structurally linked salary has **one financial event, one linked operational audit and three uniquely keyed notification intents**: `compensation.changed`, `employee.field_changed` for annual salary, and `employee.field_changed` for monthly equivalent salary.

The `pendingDeliveryCount` field tracks pending/retry/leased intents separately. A structurally complete row may still have notifications awaiting downstream processing; **this does not certify email/webhook delivery or payroll readiness**.

## Exception handling and staging acceptance

1. Test on an isolated synthetic employer. Verify a clean applied salary and injected missing/duplicate/broken evidence cases.
2. Reconcile actual historical findings using independent employer approvals, original financial events and relevant Automation Studio execution records. Preserve original audit timestamps and evidence. Never invent a salary revision or backdate approvals.
3. Investigate `notification_needs_review` using the existing compensation automation recovery runbook. Never replay an event with ambiguous external side effects.
4. Verify complete pagination and organization scoping, and have an independent payroll reviewer sign off on every outstanding exception.
5. After upstream PRs merge, retarget this PR to `main`, rerun CI, and separately perform authorized staging evidence inspection using read-only credentials.

**No live employer database has been scanned by this PR.** Passing code tests is not equivalent to staged employer acceptance, government filing acceptance or permission to release wages.
