# Compliance POST tenant isolation, three-method family

**Status: DRAFT / NOT ACCEPTED / ZERO METHOD CREDITS.** All source and
manifest entries remain `GAP`; no claims about production isolation or
statutory filing are made. Baseline `main@11b6d544cf6bd30c84fc524a088f90627dec09e6`.

## Scope and proof contract

| Method | Positive real HTTP | Real victim denial | Victim SQL before/after | Forged selector | Credit |
| --- | --- | --- | --- | --- | --- |
| POST compliance/contribution-issues | Candidate: review, update, referral, resolution | Candidate: 403 for higher-ID employer | Candidate: cases, events, tasks, remittances, closures, payroll, year-end and audit | Candidate: actual higher-ID victim case 404 | **0** |
| POST compliance/payroll-month-close | **Missing** legitimate certification with populated, independently ready released-payroll + remittance + BIR evidence | Not yet tested | Not yet tested | Not yet tested (foreign legalEntityId) | **0** |
| POST compliance/statutory-remittances | **New candidate:** genuine 201 create_batch from released, assurance-checked SSS liabilities for both September and August; genuine 200 record_payment, confirm_member_posting, and mark_member_exception with persisted SQL/audit | Both attacker logins must deny real victim employer 403 for all actions | Complete victim batches, members, evidence, posted artifacts, payroll, tax, closure and audit snapshots before/after every refusal | Genuine higher-ID victim batchId/memberId 404; genuine foreign legalEntityId 409 | **0**, exact final-head job pending |

Both compliance rows run in the same isolated PG16/localhost workflow with
the dedicated `compliance-posts` profile; any failure fails the entire job.
The contribution case is a table-driven row against real production-mode localhost
HTTP and a **fresh disposable PG16**. The shared fixture generates two independent
authenticated fictional attacker employers and one real higher-ID victim. The row
seeds a distinct persisted case and action task for *every* employer. The POST
passes only with a persisted own-case transition, case event and business audit.
For each represented branch, the signed-in attacker's request naming the real
victim employer must return 403, and the real victim case ID supplied under the
attacker's owned employer must return 404. Both denials compare the actual
victim's complete case/remittance/payroll/audit SQL snapshot to the original.
The shared runner also compares its independent organization, employee, legal
entity and other victim snapshots and rejects swapped-employer positive proofs.

**No synthetic read-only 200, blocked-action 409, or feature-off 404 counts as a
legitimate write.** Review branch completeness, fail-closed status behavior, and
the exact final PR head's GitHub Actions job before expanding credit.
The method remains GAP even if the candidate subset passes.

## Required next actions before any coverage promotion

Payroll month-close requires an actually ready historical month, a verified
BIR 1601-C acknowledgement, a valid independent statutory remittance
certification, a released/closed payroll audit state and independent certifier.
The present `buildPayrollMonthCloseState` loads remittance state but
`liveRemittanceCertification` does not supply `paymentEvidence` to
`evaluateRemittanceMonthClose`, which requires active hashed payment evidence
for each batch. Review this potential readiness integration blocker before
attempting an own-positive fixture. **Do not bypass the proof requirement.**

The new [statutory remittance row](../../scripts/qa/tenant-table-rows/write/compliance-statutory-remittances-post.mjs)
exercises all four distinct handlers, not a blocked-action shortcut. It
creates two actual fictional `Released` payroll months and computes the
full SSS employee/employer liability using the repository's **real SSS rule**,
then encrypts a fictional 10-digit member number before reconciliation.
One month is confirmed and reconciled, the other records a posting exception.
Each of the six owned action positives requires a matching real persisted
batch/member/evidence/audit transition. Real victim org denial and real
higher-ID forged batch, member and legal-entity ID rejection are all asserted
for **both independently authenticated attackers**. The receipt bytes are
explicitly marked fictional, not agency-issued evidence; none are uploaded
outside disposable PG16 and **no money is moved**. An unaudited fictional
receipt does not validate real statutory remittance readiness. Exact-final-head
CI must pass before the method receives any credit.

## Safety

Only fictional `example.invalid` employers and source evidence in
`postgresql://postgres:postgres@127.0.0.1:5432/app_db`. The workflow
starts a localhost production-mode Next server, not a deployment. No production
SQL, Neon, real payroll, real payment, provider operation or live government
filing. Workers, scheduler, billing, payout, Loyverse, Square Sandbox and CSP
release flags stay OFF. One-time synthetic signing/encryption material is local
to the ephemeral Actions job. No secret files or cookies are committed.

A separate source-fix commit is required for any reproduced isolation defect;
never relax the tenant authorization guard to make a test pass.
