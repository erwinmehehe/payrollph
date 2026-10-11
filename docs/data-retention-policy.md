# Linaw / PayrollPH Data Retention and Disposal Policy

This file describes application behavior, not a substitute for a customer's legal-retention schedule.

## Principles

- Personal data is retained only for an identified operational, contractual, statutory, audit, claims, or legal-hold purpose.
- A data-subject deletion request does not automatically destroy payroll, tax, government-filing, final-pay, or audit evidence that the employer must lawfully retain.
- Short-lived security and delivery data is purged automatically.
- Payroll and employment records are not auto-purged until the organization has an approved legal-retention rule for the relevant record class.
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

## Data-subject requests

The privacy request register uses a 30-day **internal response target**. The application does not describe that target as a universal NPC statutory deadline.

Access and portability requests have a real structured export path and an audit event proving that the export was generated. Correction, deletion and objection requests cannot be marked completed without recording the fulfillment action and supporting evidence. A deletion request can record that legal retention was applied where destruction would conflict with an applicable obligation.

## Key ownership

Organizations must assign a privacy administrator/DPO responsibility for:

1. defining the lawful retention period for payroll/tax/employment records;
2. approving legal holds;
3. verifying destruction or anonymization when the retention basis expires;
4. reviewing data-subject requests where legal retention limits deletion; and
5. periodically reviewing this policy against current Philippine law and NPC/BIR/DOLE/SSS/PhilHealth/Pag-IBIG requirements.

## Public enquiry consent and safeguards

The public /privacy notice is linked from the site footer and from all public enquiry forms. Each form now requires affirmative consent for follow-up on that enquiry only. The server timestamps the consent and records its notice version and purpose inside the lead attribution JSON, instead of accepting a browser-supplied timestamp. A hidden honeypot and hashed-email/domain rate limits reduce automated intake before email delivery. Inactive leads are automatically removed 365 days after their last update by the separately enabled central scheduler. This change does not activate that scheduler.

The DPO or privacy counsel must verify the deployed controller, transfer safeguards, recipient processors and contracts before production publication. Existing API consumers must be updated to submit an explicit boolean privacyConsent field.
