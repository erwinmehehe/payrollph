# Linaw / PayrollPH Data Retention and Disposal Policy

This file describes application behavior, not a substitute for a customer's legal-retention schedule.

## Principles

- Personal data is retained only for an identified operational, contractual, statutory, audit, claims, or legal-hold purpose.
- A data-subject deletion request does not automatically destroy payroll, tax, government-filing, final-pay, or audit evidence that the employer must lawfully retain.
- Short-lived security and delivery data is purged automatically.
- Payroll and employment records are not auto-purged until the organization has an approved legal-retention rule for the relevant record class.
- Each organization must configure all required record classes through `/api/compliance/retention`. Launch readiness remains blocked while any required class is missing.
- A configured legal hold prevents disposal of the affected record class.
- Disposal must remove the primary record and any application-controlled derivative that no longer has a lawful retention basis.

## Automated operational purge

| Record class | Application policy | Purge |
| --- | --- | --- |
| Sessions | 30 days after expiry/revocation | Daily |
| Password-reset tokens | 30 days after expiry | Daily |
| Email-change tokens | 30 days after expiry | Daily |
| Rate-limit counters | 1 hour | Daily safety sweep, plus normal window expiry |
| Completed/failed outbound email records | 180 days | Daily |
| Completed/failed webhook deliveries | 365 days | Daily |
| Health checks | Latest 500 snapshots | Existing rolling purge |

The runtime source of truth for these values is `src/lib/data-retention.ts`.

## Records requiring a legal-retention basis before destruction

The application does **not** automatically purge:

- payroll runs, payroll entries, payslips, contribution traces and payout receipts;
- BIR annualization, 2316/Alphalist source data and filing-validation evidence;
- SSS, PhilHealth and Pag-IBIG reporting/remittance evidence;
- employee master records needed to interpret historic payroll;
- final-pay/separation records;
- payroll approvals and audit events;
- loan ledgers and payroll-linked payment history.

These records can carry statutory, accounting, employment, claims-defense or legal-hold obligations. Destruction must therefore be driven by an organization-approved retention schedule, not by a blanket data-subject deletion action.

The application requires approved rules for payroll registers, payslips, BIR tax records, statutory remittance evidence, employee master/employment records, final-pay/separation records, loan ledgers, audit trails, payout/bank evidence, and DSR evidence. PayrollPH deliberately does not pre-fill a statutory number of years; the employer/privacy administrator must document the applicable legal basis and approved retention period for its circumstances.

## Data-subject requests

The privacy request register uses a 30-day **internal response target**. The application does not describe that target as a universal NPC statutory deadline.

Access and portability requests have a real structured export path and an audit event proving that the export was generated. Correction, deletion and objection requests use the audited fulfillment endpoint rather than status-only closure. Correction can apply supported employee-profile corrections directly. Objection can restrict future payroll processing. Deletion/minimization requires the approved retention schedule, restricts future payroll processing, redacts non-retained contact/payout data, and preserves payroll/tax/loan/separation evidence where legal retention applies.

## Key ownership

Organizations must assign a privacy administrator/DPO responsibility for:

1. defining the lawful retention period for payroll/tax/employment records;
2. approving legal holds;
3. verifying destruction or anonymization when the retention basis expires;
4. reviewing data-subject requests where legal retention limits deletion; and
5. periodically reviewing this policy against current Philippine law and NPC/BIR/DOLE/SSS/PhilHealth/Pag-IBIG requirements.
