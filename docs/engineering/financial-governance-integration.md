# Financial governance: integrated code and migration release candidate

**Scope:** This is a **draft / staging-only source-integration candidate**, combining
unmerged code from #626 (compensation automation), #642 (reviewed underpayments),
#647 (three-person final pay and transaction integrity), and #649 (independent
employee-loan deduction approval, incorporating #657's safe checks). The source
branches remain open for independent review and provenance. The integration
does **not** authorize any production migration, payroll deduction, account
change, bank file submission, statutory remittance, or feature activation.

## Contiguous additive migration ordering

| Order | Migration | Purpose |
| --- | --- | --- |
| 0100 | `0100_compensation_automation_intents.sql` | Durable, reviewable financial automation intents |
| 0101 | `0101_reviewed_payroll_underpayments.sql` | Maker/checker one-time historical positive underpayment |
| 0102 | `0102_final_pay_maker_checker.sql` | Stable third-party approval identity and final-pay separation |
| 0103 | `0103_independent_employee_loan_deductions.sql` | Pending-by-default independent loan deduction approval |

The source #649 used `0100_independent_employee_loan_deductions.sql`.
It was **renamed to 0103 only in this integration branch** to avoid colliding
with the 0100 compensation migration. Its operational SQL body and safeguard
constraints were retained. Source PR #649 must **never** be merged separately
while its migration still claims 0100.

Current `main` ends at `0099`. **Do not run `drizzle-kit migrate`**
automatically: this repository has no ordered Drizzle migration journal.
The historical `drizzle/baseline.sql` is untouched. The existing
append-only migration check can validate source numbering but is not a
DBA-signed inventory of the actual installed production schema.

## Evidence required before any code merge

- [ ] Check exact-head CI: typecheck, isolated PostgreSQL tests, golden payroll
      runs, payout isolation, security smoke, CodeQL and build. Static tests
      do not replace transactional staged fault-injection.
- [ ] Independently inspect all source PR diffs and resolve any cross-feature
      assumptions, financial event replay, benefit/tax treatment, controls on
      legacy rows and compensation/loan payroll source consistency.
- [ ] An independent DBA compares the real target's applied SQL and schema
      against `0099` and the four files, checks column/constraint/index
      compatibility, tests transactional or backup/restore rollback in a
      disposable, isolated staging clone, and signs the **exact ordered**
      migration list. Never infer an installation from file names alone.
- [ ] Independently verify maker/checker/releaser identity separation, recent
      MFA, organization/tenant isolation, loan activation default OFF,
      payout change restrictions and no unexpected gross-to-net changes.
- [ ] Controlled synthetic concurrency: multiple loan repayments with the
      same reference, simultaneous final-pay release/source mutation,
      historical underpayment double post, outbox failure/replay and payroll
      calculation races. Record redacted fault-injection evidence.
- [ ] Separate privacy/DPO, payroll-domain, labor/legal, security and employer
      approval before any employee data or live financial operation.

## Activation and production prohibition

Keep `PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED=false` and all other
money-impacting feature gates OFF until independently approved. This branch
only establishes a **testable source snapshot** and a non-conflicting SQL
ordering. It does not execute SQL or change production environment settings.

Track independent review in #630 and migration/loan coordination in #665;
real payroll and launch acceptance remain open in #579 and #112.
