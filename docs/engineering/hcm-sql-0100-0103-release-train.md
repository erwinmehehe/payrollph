# PayrollPH HCM database release train: 0100 -> 0101 -> 0102 -> 0103

**Status: DRAFT / NO-GO. SQL files only; no app runtime changes, payroll run, bank transfer, schema deployment or data manipulation.**

This branch packages four additive migrations in their intended chronological order so the repository's contiguous-history guard can verify the **complete candidate chain**. Individual feature PRs remain independent, draft, and subject to their own reviewed commit tests and release gates. **Passing the advisory guard does not approve execution against any live database.**

| Prefix | Migration | Owning implementation |
| --- | --- | --- |
| 0100 | `0100_compensation_automation_intents.sql` | #626 |
| 0101 | `0101_reviewed_payroll_underpayments.sql` | #642 |
| 0102 | `0102_final_pay_maker_checker.sql` | #647 |
| 0103 | `0103_independent_employee_loan_deductions.sql` | #649 |

Every SQL file is an unchanged blob copied from the cited source PR. The earlier unmerged loan filename `0100_independent_employee_loan_deductions.sql` was replaced with `0103_independent_employee_loan_deductions.sql`; there is no attempt to rename an already applied historical migration. The current mainline baseline ends at `0099_talent_role_requisition_skills.sql` and contains **legacy duplicate prefix groups**; this train does not repair or rewrite historical files.

## Merge/deployment sequencing — explicit DBA gate

1. Record the target environment, database identifier, current schema, historical applied-migration receipts and exact SHA-256 checksums. If existing production or staging receipts include any `0100`–`0103` file under a different checksum/name, STOP; reconcile instead of renaming/replaying.
2. Audit each source PR's SQL and corresponding Drizzle schema. Ensure foreign-key targets, constraints, indexes, object names, existing data and legacy status defaults are compatible. Check #649's existing active loan cases and no fabricated checker IDs.
3. Rehearse **all four SQL files in 0100/0101/0102/0103 order** in an isolated backup-restored staging database; validate DDL, checksums, data preservation, partial-failure response, forward/backward app compatibility and rollback/restore.
4. Obtain independently recorded DBA, Philippine employer payroll/finance, security/privacy, and applicable labor/compliance approvals. Cross-check approval identity; CI robots cannot self-approve.
5. Select an explicit code/schema roll-forward plan. Do not deploy application code requiring absent schema columns. Do not enable `PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED` or `FINAL_PAY_MANUAL_RELEASE_ENABLED` on the strength of this train alone.
6. Merge and apply only in the authorized sequence. If staging or production diverges during review, stop and re-derive migration ordering from its **actual** receipts; never override the guard or use uncontrolled `drizzle-kit push` in production.
7. Re-run full GitHub CI and isolated tenant/MFA/maker-checker/loan/payroll/final-pay goldens on the exact integrated application head; attest rollback rehearsal and employer parallel payroll reconciliation.
8. Retire duplicate source PRs only when the preserved integration and its independent approvals are verified. Feature flags remain default-OFF until explicit written release approval.

## Intentional limitations

This is a **schema ordering candidate**, not a production-ready release, automatic release plan or replacement for PR #626/#642/#647/#649. No claim is made that these SQL migrations have been independently audited or applied outside CI. The GitHub migration guard checks filenames/order only, not DDL semantic correctness, real historical checksums or live schema drift.

**Source blob hashes** (for provenance; refresh if an owning PR changes its SQL):
- `0100`: `159ed09ffc1834c15f2d68e9e62bb0348951c165`
- `0101`: `e1f35c553ffc523e7b1001245c76d7b4f1707899`
- `0102`: `364e1ce9f9ac3740c6a51d7ac8b72d55f9233fa5`
- `0103`: `0c880a5afce38ad50e401f4db9fa6562fd2a080c`
