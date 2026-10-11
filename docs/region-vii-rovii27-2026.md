# ROVII-27 — Region VII private-sector wage screening

Source: https://nwpc.dole.gov.ph/central-visayas-workers-set-to-receive-%E2%82%B142-minimum-wage-increase-wage-review-in-other-regions-ongoing/

- Published: 2026-09-28
- Effective: **2026-10-14**
- Class A / Expanded Metro Cebu: **PHP 540 -> PHP 582 per day**
- Class B / other covered cities and municipalities: **PHP 500 -> PHP 542 per day**; includes Negros Oriental and Siquijor even though administratively part of NIR
- All applicable categories increase by PHP 42 per day
- Separate domestic worker wage order ROVII-DW-06: PHP 7,000 -> PHP 7,500 per month, not included in the private-sector wage screen

## Safety and usage

The general region-only lookup uses the Class A maximum as a **conservative advisory reference**, not an assignment of the employee to that legal tier. Where geography/class is independently established, `wageOrderFor("VII", payDate, "A" | "B")` and `isBelowMinimum(monthlyBasic, "VII", workDays, payDate, wageClass)` resolve the actual class rate. Never silently infer Class A or Class B from a generic region field. The payroll check is a review warning; this patch does not automatically increase salary, determine minimum-wage-earner tax status, or perform a live payout. Legal exemptions, establishment size and actual locality require employer/payroll reviewer verification.

Deploy before the effectivity date, and regression-check both September/early-October payroll and payroll with pay dates on or after 2026-10-14. A source merge alone does not prove production deployment.

The Compliance rule watch has been changed to show ROVII-27 as **verified and scheduled** during the 30-day pre-effectivity window. It must NOT continue reporting the order as missing/overdue once the October 14 date arrives. This is a code-only status change; no financial mutation occurs.
