# PR #626: Compensation financial-integrity security engineering review

Review date: 2026-10-08
Source: PR #626, updated against main containing #578 and #627.
Scope: compensation application, recurring activation/expiration, immutable notification intents, Automation Studio execution, operator recovery, financial/tenant audit evidence, and migration 0100.

**Disposition: ENGINEERING CODE REVIEW PERFORMED; EXTERNAL SIGN-OFF PENDING; DO NOT MERGE OR DEPLOY.**
This is a source-level assessment and CI evidence index, not an independent external security assessment, witnessed staging test, authenticated operational approval, or payroll/government/bank certification.

## Security controls inspected

- Salary application, employee pay profile, financial event, linked audit and three immutable automation intents commit together or roll back together. Component activation uses the same transaction principle; expiration uses a per-assignment advisory lock and preserves the last payable Asia/Manila calendar date.
- Compensation outbox identifies an authoritative financial source by **organization, employee and event ID** before enqueue, dispatch and manual retry. New hardening also restricts sources to salary-change/component-activation events and triggers to compensation/employee-field change; unknown or mismatched records fail closed instead of running another lifecycle automation.
- Durable event-key uniqueness, idempotent Automation Studio ledger, bounded pre-ledger retries, quarantined ambiguous/expired leases, and independent per-execution recovery keep unconfirmed external side effects from being blindly replayed.
- Queue inspection pages tenant-scoped IDs and status without the stored salary context; database roles and operator identity still require separate operational review.
- Migration 0100 is separate from main's 0099, with read-only catalog compatibility inspection and rollback-only CI rehearsal. No historical notification events are fabricated.

## Findings and release conditions

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | Durable outbox records could reference another employer/worker with individually valid foreign keys | **Code fixed**: three-way source check at enqueue, delivery, recovery; synthetic cross-tenant regression |
| P1 | A tampered outbox trigger or non-financial compensation event could be delivered to Automation Studio under an authorized tenant | **Code fixed**: only salary-change/activated-component sources and two approved triggers; synthetic trigger/source rejection regression |
| P1 | Same-day recurring approval could bypass durable activation notification intents | **Fixed in existing integrated PR**: two intents, financial event and operational audit are in the approval transaction |
| P1 | Manual recovery could replay ambiguous events after ledger pruning | **Fixed in existing integrated PR**: only five exhausted *verified pre-ledger* attempts with exact terminal reason may be requeued; unknown leases blocked |
| P1 | The privileged recovery CLI accepts a reviewer name as a command-line string, not an authenticated independent approval; direct database access controls are external | **OPEN — security operations acceptance required**: restrict execution to a dedicated, audited, tenant-authorized operator using approved credentials; capture an independently authorized ticket and distinct reviewer/operator; prove command provenance, MFA and DB-role restrictions in staging. Until then **do not use manual recovery on live tenant data** |
| P1 | Active compensation-triggered automation rules can send email/webhooks containing salary context | **OPEN — privacy/security acceptance required**: review who can author/enable rules, destination allowlists and template fields, least-privilege access, delivery receipts, outbound-data controls, retention and DPO approval; test a negative/unauthorized destination |
| P1 | Migration 0100 and backup/rollback have only synthetic CI evidence | **OPEN — DBA staging approval required**: witnessed migration on an authorized isolated staging DB, verified pre-change backup, read-only schema gate, negative DDL/rollback test and documented change order |
| P1 | Real employer and bank/agency release evidence unavailable | **OPEN — business acceptance required**: separate payroll reconciliation, statutory workflow, bank UAT, data-protection and witnessed DR sign-offs |

## Automated evidence versus human evidence

CI must show TypeScript, unit/integration tests, pilot-payroll simulation, statutory/golden-payroll suites, Next.js build, security smoke, browser QA, payout isolation, CodeQL and isolated rollback-only migration rehearsal all green **on the final exact PR head**. Source-level test coverage includes fault injection for audit/outbox failures, simultaneous activations, expiry boundaries, source/tenant mismatch, event-trigger spoofing, stuck lease quarantine and ledger pruning.

Automated evidence does **not** authenticate a human reviewer, prove a bank/agency accepted a file, certify an employer's payroll, or authorize production. Approved staging and independent security/DPO/DBA reviewer names, timestamps, ticket IDs and artifacts belong in access-controlled change control; do not commit bank, salary, employee, payroll export, credentials or private reviewer signatures to GitHub.

## Merge decision

**NO-GO** pending all applicable independent security, DBA and privacy sign-offs plus clean exact-head CI. The engineering review can be marked performed, not independently approved. Retain PR #626 as draft until those release conditions are documented; do not separately merge overlapping original compensation drafts.
