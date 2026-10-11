# Connected employer journey: synthetic engineering acceptance

**Status: proposed CI extension; not a passed result until the exact-head GitHub Actions run succeeds.**
This document and source PR do not certify a real employer, real device, Philippine statutory filing, bank transfer or production launch.

## Scope and execution

The existing disposable PostgreSQL 16 `Production Pilot Payroll QA` workflow is extended in `scripts/pilot-payroll-qa.ts`. Its source-owned local API requests now cover:

| Stage | Synthetic proof | Boundary |
| --- | --- | --- |
| Hire | Authorized People operator creates two fictional employees and reads their canonical records | Direct core HRIS employee creation, **not** governed recruitment candidate-to-worker Hire BP |
| Onboard | Source-owned worker checklist loads; typed task completion persists; wrong-worker mutation returns 404 | Manual fictional checklist, not verified IDs, employment eligibility, bank or IT provisioning |
| Schedule | Effective shift definition, rotation and assignment are saved by existing WFM APIs | No actual employer schedule |
| Clock In | Employee Web Bundy GET/POST IN/OUT, self-ID enforcement, duplicate IN rejection | Current-day synthetic clock is **separate** from historical September payroll punches; no real device, GPS or face identity acceptance |
| Approve Time | Employee correction, manager decision, independent timesheet sign-off, stale-version negative proof | Fictional actors do not substitute for external reviewer |
| Run Payroll | Exact September period processed with WFM trace and approved timecards | Existing synthetic prior-cutoff ledger is test fixture, not independently reconciled payroll |
| Review | Payroll officer submits; separate checker account decides | Synthetic account separation only |
| Release Payroll Records | Owner releases source ledger; historical attendance becomes immutable | No bank instruction, no payment settlement |
| Prepare Filing Evidence | SSS R-3, BIR 1601-C, PhilHealth RF-1, Pag-IBIG MCRF worksheets created under same run, downloaded SHA-256 byte match, unchanged regeneration deduplicated, missing agency reference rejected | Reconciliation-only CSVs; **never certified agency upload formats or accepted filings** |

The script refuses remote app URLs or non-local PostgreSQL, requires CI, keeps payout and GPS pilot flags OFF, and explicitly avoids any external AI provider. It records redacted stage outcomes in `qa-artifacts/pilot-payroll-report.json`. Do not publish real employer PII or raw payroll data to the artifact.

## How to verify

1. Check out the exact candidate PR SHA in the repository.
2. Run `Production Pilot Payroll QA` with its existing disposable PostgreSQL service and localhost production build. GitHub Actions builds and runs the script; no production credentials or service flags are necessary.
3. Confirm the artifact `payrollph-production-pilot-report` contains `employerJourney.result = passed-synthetic-only`, nine ordered stages, `filingEvidence.generatedCount = 4`, and `webBundy.inOutMatched = true`.
4. Run the normal exact-head CI including TypeScript, full tests, four golden payroll suites, security, SQL history checks and build. A source commit or a test plan alone is not a pass.
5. Confirm that no real provider submission, bank payout, certified filing or real-employer signoff is claimed by the report.

## What this test does NOT complete

- Governed Recruitment candidate / offer / independent HCM Hire BP, position allocation and conversion: separate dedicated acceptance required.
- Clocking of the *same historical dates* that produce the payroll run: today's Web Bundy is verified via API; September payroll punches are explicitly seeded. Backdating a Web Bundy punch would misrepresent the product.
- Employer-switch / phone-width/manual operator acceptance: existing HRIS and WFM browser suites cover separate synthetic scenarios but human two-role mobile UAT is still pending.
- External bank UAT, actual employer shadow payroll and centavo reconciliation, DPIA/DPO/HR/operator approvals, real GPS/face device validation, production infrastructure and live email delivery.
- Official BIR DAT, SSS e-CL/PRN, PhilHealth EPRS or Pag-IBIG eSRS file compatibility, actual filing and original agency-issued acknowledgements.

## Release decision

**NO-GO for real employer operations** until #112, #579, #691, #744 and the external filing acceptance checklist are independently closed with genuine evidence. No automatic payment, wage release, filing acceptance, environment activation, production migration or bank/agency transaction is permitted by synthetic CI. Keep separate operational authorizations and maker/checker responsibilities.
