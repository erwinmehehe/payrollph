# First employer shadow-payroll pilot

Prepared 2026-11-16. **Employer unassigned; actual employer execution NOT_RUN.**
This pack turns the existing reconciliation and acceptance tools into a bounded
onboarding plan. It does not close #579 or authorize real payroll, filings,
provider activation or production database operations.

## Pilot offer and admission

Start with one consenting private-sector employer, one legal entity, one site
and one region, 1–25 monthly-paid fixed-schedule workers, and monthly or
semi-monthly pay. The headcount cap is our initial support scope, not a legal
or product limit. Compare at least **two completed payroll months**, including
all cutoffs in each monthly normalized export. Never compare one cutoff with
a full-month reference.

The employer continues its established payroll and filing process. PayrollPH
produces shadow results only. Do not release bank files, pay employees twice
or submit an agency return from this pilot.

Before accepting an employer, identify sector, municipality, establishment
size and applicable wage category with effective dates. A regional high-tier
screen is not an automatic wage-category decision. Leave the region unassigned
until known. Do not use NCR as an assumed default.

Stop or write a separate reviewed plan for daily/piece-rate pay, multi-site/
regional workers, joiners/leavers, final pay, imported YTD/retro, variable
incentives, loans, holiday/rest-day/night/OT work or multi-entity transfers.
These are conservative exclusions for this first pilot, not claims that the
product cannot support them. A worker's actual records override a convenient
test scope: never omit real pay items to make the pilot fit.

## Prepare now, without an employer

Run from a current source checkout with dependencies installed:

```sh
node --import tsx scripts/qa/first-employer-pilot-pack.ts prepare <existing-private-directory>
node --import tsx scripts/qa/first-employer-pilot-pack.ts check <generated-pilot-directory>
```

Preparation creates a new randomly named private directory containing:

- `scope.json`: unassigned employer, region, industry, headcount and frequency.
- `parallel-manifest.json`: no invented employer, periods, file hashes or cycles.
- `templates/payroll.csv` and `templates/journal.csv`: exact canonical headers,
  intentionally no worker rows. Empty templates cannot pass.
- `evidence/` and a local instruction sheet.

The initial check returns **BLOCKED / NOT_RUN**, exit 1. This is correct.
Preparation returns exit 0 only for successful file creation, never acceptance.
Malformed/unreadable inputs return a sanitized error, exit 2.
Keep this directory outside Git, synchronized shared folders and public CI.
POSIX permissions are 0700 directories / 0600 files. On Windows the operator
must confirm a private NTFS ACL and approved encrypted storage; POSIX mode bits
are not proof of Windows privacy. The tool does not attest ACLs/encryption.

## Employer onboarding and ownership

| Stage | Operator and retained private evidence | Stop condition |
| --- | --- | --- |
| Consent and scope | Employer authorizes data processing, purpose, access, retention and deletion; assign an opaque employer code | No permission, uncertain legal entity or unsupported pay case |
| Policy review | Payroll reviewer records current regional category, effective dates, statutory tables, paid-time and rounding policies | Unresolved applicable #1280 decisions, unverified rule or wage category |
| Access | Distinct Owner, Payroll Officer, HR/time reviewer and Checker; genuine logins/MFA, least privilege | Shared/recycled accounts or self-approval needed |
| HRIS | Reconcile complete worker roster, start dates, pay profiles, statutory IDs and approved changes to original records | Missing/duplicate worker, unexplained effective date or source |
| WFM | Review roster, breaks, punches, corrections, time approval and cutoff lock; desktop and real-phone walkthrough | Missing time, disputed entitlement or unresolved exception |
| HCM | Verify each relevant pay/position/change approval and effective date, including who initiated and approved | Unapproved or backdated change without an agreed treatment |
| Shadow payroll | Calculate against the agreed complete cutoff inputs; compare worker components, payslips and journals | Any unexplained difference; no live release/payment |
| Reconciliation | Normalize authentic incumbent and PayrollPH exports separately; run the canonical offline verifier | Wrong employer/month, missing worker, source reuse, hash drift, net/GL mismatch |
| Filing/bank review | Inspect preview-only totals and exact-byte formats with authorized operator | Generated CSV alone is not accepted bank/agency evidence |
| Decision | Employer reviews results and exceptions privately; separate operational release decision | Tool output alone cannot grant go-live |

No paid external role is required simply to create this unassigned pack.
Real operator decisions, original employer evidence and external acceptance
cannot be fabricated by automation. Do not impersonate an independent reviewer.

## Fill the private pack when an employer is available

1. Complete `scope.json` with an opaque code, real scope and two or more
   planned completed months. Do not put names, TINs, bank details or keys in it.
2. Follow [the canonical normalization contract](../payroll-certification/private-parallel-reconciliation.md).
   It includes taxable pay, employee/employer statutory components, loans,
   deductions and canonical journal controls; the smaller six-field comparator
   is not a substitute.
3. For each month retain FOUR distinct original-derived normalized files:
   incumbent payroll, PayrollPH payroll, incumbent journal, PayrollPH journal.
   Use employer-specific HMAC worker keys; keep the secret and crosswalk private.
4. Add each completed `YYYY-MM` to `parallel-manifest.json` with its four
   `{filePath, sha256}` references relative to `evidence/`. Use actual hashes
   of the retained bytes. The manifest schema is the existing
   `ParallelReconciliationManifest` in
   `src/lib/private-parallel-payroll-reconciliation.ts`.
5. Run the pack checker. It binds manifest employer to scope, requires the
   planned month count and roster count, and delegates all payroll/GL/file
   checks to that canonical verifier. It cannot verify originals were genuine.
6. Retain the report privately. **ARITHMETIC_RECONCILED_REVIEW_PENDING** means
   supplied-file agreement only. The existing one-cent comparison tolerance is
   unchanged; inspect and explain every nonzero variance. This PR does not
   decide #1280 F-09's rounding policy.

Even after arithmetic passes, the report permanently states payment,
operational approval, independent review and production readiness are false.
It never claims deployed flags were inspected. Do not edit the JSON output to
manufacture a signed decision.

## Engineering and external gap register

| Gap | Work we can complete ourselves | Remaining evidence |
| --- | --- | --- |
| Unassigned onboarding inputs | Private scaffold, bounded scope validator and exact canonical templates in this PR | Actual employer scope and permission |
| Repeated manual reconciliation setup | One command reuses existing payroll/GL verifier with employer, roster and month binding | Authentic exports, reviewed normalization |
| False acceptance from empty/single-month/self-comparison | Real CLI regressions reject empty templates, missing month, source reuse, hash drift and mismatched rows | No automated original-source authentication |
| Wage currentness/category | Track #1989; do not duplicate its registry work | Applicable category and effective-period review |
| Payroll policy questions | Track #1988; do not duplicate or silently approve decisions | Applicable #1280 decisions before admitting affected cases |
| Full journey | Reuse [nine-stage acceptance](../qa/nine-stage-connected-acceptance.md), [first payroll](../qa/first-payroll-full-journey.md), [HRIS](../hris-integrated-acceptance.md), [WFM](../wfm-five-worker-development-acceptance.md) | Fresh exact-head runs; actual operator/physical-device UAT |
| Government formats | Use [official filing acceptance](../ph-official-filing-acceptance-pilot.md) | Exact-file validator/portal acknowledgement; manual entry and upload are different |
| Real money and operation | Preserve existing flags/MFA, backup and restore gates | Separate owner authorization, bank/provider acceptance and operational evidence |

No prior CI result is represented here as a fresh executed pass. This PR's
tests exercise offline preparation/reconciliation with fictional files only.
No application route, payroll rule, tenant credit, SQL schema, flag or provider
is modified. Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**.

## Current official process references

Verify rules/channels again for the chosen employer and actual period:
[DOLE monetary-benefit handbook](https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/),
[BIR 1601-C](https://efps.bir.gov.ph/efps-war/EFPSWeb_war/forms/1601C/1601c_v3.xhtml),
[SSS employer duties](https://www.sss.gov.ph/employer-er),
[PhilHealth EPRS procedures](https://www.philhealth.gov.ph/partners/employers/pay_procedures.php),
[Pag-IBIG circulars](https://www.pagibigfund.gov.ph/about_publication_circulars_memberservices.html),
[Data Privacy Act](https://privacy.gov.ph/data-privacy-act/).
These are references for operator verification, not a new legal certification.
