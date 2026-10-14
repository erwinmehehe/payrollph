# M-6 / M-10 statutory remediation: source evidence (October 14, 2026)

Status: **M-6 fixed-MBS interpretation documented; M-10 conservative approval gate only.** No production activation, migration, filing, or payroll release is authorized.

## M-6 PhilHealth monthly basic salary
PhilHealth Circular 2020-0005 and the 2025 PA2025-0002 advisory define fixed Monthly Basic Salary (MBS); it excludes overtime, commissions, allowances, 13th-month, bonuses and similar one-off earnings. Undertimes/absence do not reduce the MBS used for premium calculation. The current engine passes the configured pay-profile monthly equivalent, not month-to-date gross, to computePhilHealth. Verify daily-paid equivalent monthly rate with a Philippine payroll reviewer before first real employer.

- https://www.philhealth.gov.ph/circulars/2020/circ2020-0005.pdf
- https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf

## M-10 SSS and Pag-IBIG contribution attribution on retro salary
SSS describes the employed-member monthly salary credit as based on total actual remuneration, but the checked official guidance does not resolve correction accounting for every employer back-pay scenario. Do not infer that the historical salary attribution month is always the remittance month.
- https://www.sss.gov.ph/pay-contribution/

Existing retro records have a typed source_payroll_run_id pointing at payroll_runs period_start/end. This change joins that actual run in the same tenant; it never infers contribution months from source_period_label. Cross-month, earlier-month, invalid and missing source periods result in an Exception for independent SSS/HDMF reconciliation. The pay remains calculable for inspection, but no agency adjustment or remittance is generated. Same-month cases retain existing calculation.

**Before M-10 closure:** obtain written legal/payroll/agency treatment for previous-month wage corrections for SSS and HDMF, implement and verify source-month contribution adjustments where appropriate, reconcile per-employee centavos and prior remittance status, then test actual agency posting. No live data/money change in this source PR.

**Acceptance:** all four golden suites, tests, typed source lookup, tenant-denial, same-month/prior-month/missing/bad-period, exact SHA CI, and downstream proof that any Exception prevents payroll release. This is a development guard, not payroll certification.