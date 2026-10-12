# First-payroll independent acceptance: execution record (NOT YET SIGNED OFF)

Scope: PR #915 (source-only), its current exact head, the canonical 0117 migration dependency and the separate #874 navigation module. **Never execute against production Neon or move money for this acceptance.** This is an evidence checklist, not permission to merge, process live payroll, release files or submit an agency filing.

## A. Synthetic CI already available (does not replace independent human tests)

- Run the exact-head CI, mobile Chromium journey, zero-data employer / owner -> HR -> payroll handoff, atomic 500-row import, PostgreSQL no-write preview and statutory four golden suites.
- Store actual GitHub run links, head SHA, screenshot hashes, test status and branch-specific **disposable PG** identity. CI green on an older head does not attest the latest head.
- The read-only preview blocks ambiguous historical pay, overtime, loan, time, retro, benefits and multi-entity contexts. Any such blocker requires a fully specified separately reviewed payroll path.

## B. Two-role physical mobile UAT — human witness required

Record device make/model, OS/browser, screenshot hash, build URL and exact SHA. Do not upload screenshots containing identity, salary or bank information to a public issue.

1. Use two isolated **synthetic** employers A and B, two different users (owner/admin and Payroll/HR/Checker as appropriate) and separate genuine mobile-device browsers. Confirm keyboard, 375px viewport, form validation, retry, accessibility and zero horizontal overflow.
2. Employer A: create legal employer and pay calendar inline, hire one fictional employee, grant roles, enter human-reviewed attendance/time for a pay period, read-only preview, explicitly create a draft (not approval/release).
3. Switch to employer B and back; verify no employer-A employees, pay figures, reviewer invitations, sessions or private records bleed. Attempt direct employer-A IDs using employer-B or non-member session; record 403/404 and no mutations.
4. Check independent maker/checker roles; stop before payroll release or disbursement; verify ledger, payslip and audit snapshots unchanged on preview.
5. Re-login, browser-back and reload; verify resumed steps and correct employer. Exercise offline/unavailable DB and duplicate submission feedback.
6. Record witness name, date, role, device and explicit PASS/FAIL for each scenario. **Do not self-sign on behalf of independent users.**

## C. Private actual-employer mathematical reconciliation — separate controlled workspace

With the employer's permission, an independent payroll reviewer exports *both* previous validated payroll/reference and the PayrollPH calculation for the **same employer, period, pay date and all employees** to a protected workstation. No bank transfer, no use of a production payout API.

Both local CSV exports require:
`legalEmployerId,periodStart,periodEnd,payDate,employeeNo,gross,sss,philHealth,pagIbig,withholding,net`

Run locally:

```sh
node scripts/reconcile-private-employer-payroll.mjs /private/reference.csv /private/candidate.csv
```

The script fails on a missing/mismatched legal employer, duplicated/missing employees, period mismatch, malformed currency values or **any per-employee field difference over PHP 0.01**. It reports aggregate metrics only, never raw employee IDs or salary rows. A passing mathematical comparison is **not an attested independent reconciliation** until the designated reviewer signs the private evidence record and documents statutory-rule/version, attendance, adjustments, exceptions and source provenance. Keep identifiable CSVs out of GitHub, CI and public logs. Deletion/retention follows the employer's policy.

## D. Migration and filing separation

- DBA reconciles applied 0115–0121 migration journal/receipts, table constraints, rollback and restore evidence on an independently provisioned database, and signs before authorizing any actual migration. Do not use Neon production db:push.
- Separately test official SSS/PhilHealth/Pag-IBIG/BIR import/receipt requirements with the authorized agencies. Do not claim acceptance based on generated spreadsheets or synthetics.
- Reviewer must explicitly acknowledge no money movement, no employer liability transfer, no live filing and no activation of default-off flags.

## E. Evidence register

| Gate | Witness | Timestamp | Device / environment | Exact SHA / evidence hash | Outcome |
| --- | --- | --- | --- | --- | --- |
| Exact-head CI and golden suites | CI | Pending latest head | disposable PG | record run | NOT_YET_RECHECKED |
| Real-device two-role, dual-employer UAT | Independent QA | - | two real phones | - | NOT_RUN |
| Real employer <= PHP 0.01 reconciliation | Independent payroll reviewer | - | private workspace | - | NOT_RUN |
| DBA migration/restore acceptance | Independent DBA | - | isolated restored branch | - | NOT_SIGNED |
| Agency import acceptance | Authorized filer | - | official portal | - | NOT_RUN |
| Final release authorization | Product, payroll, DBA/security | - | - | - | NOT_GRANTED |

**Do not infer any signature or approval from automated workflows.**
