# P0-A launch packet — First employer independently witnessed UAT

**Status:** READY TO RUN WITH HUMAN OPERATORS — **NOT_RUN** until observations actually occur.  
**Scope:** Fictional employers/fictional workers in an authorized isolated development instance; no payment, provider submissions, real bank accounts, biometric photos, production migration or customer data.  
**Controlling issues:** [#853](https://github.com/erwinmehehe/payrollph/issues/853) journey, [#852](https://github.com/erwinmehehe/payrollph/issues/852) novice HR, [#691](https://github.com/erwinmehehe/payrollph/issues/691) WFM, [#579](https://github.com/erwinmehehe/payrollph/issues/579) real no-money payroll **later**.

## Exactly which test to run first

Start with **one** source-connected nine-stage journey for a single fictional worker; keep five-worker premium tests separate. Use the *existing* disposable PostgreSQL / localhost workflow rather than deploying a new production app or resetting Neon.

### Preflight: a different observer verifies these before the session

- [ ] Record the exact deployed application Git SHA **from the running application/build**, not merely GitHub's main SHA; confirm it matches the clean tester checkout.
- [ ] Confirm developer-authorized environment and an empty/disposable PostgreSQL tenant or isolated existing fictional tenant; do not call an existing Neon/default branch disposable.
- [ ] Confirm two fictional employers (Alpha/Beta) and **distinct worker IDs**, including overlapping employee numbers to detect tenant bleed.
- [ ] Confirm seven separate login roles: HR, Operations Manager, Employee, Payroll Officer, Checker, Owner, and independent QA observer. No impersonation; verify role scope and separate human actors for pilot sign-off.
- [ ] Confirm all payout, real provider/agency submission, real notification and document/biometric capture routes are disabled; require actual effective flags from runtime, not assumptions.
- [ ] Confirm approved test cutoff and Manila local time. Web Bundy creates **current-day** clock events; never insert backdated time punches and call them a real clock in.
- [ ] Confirm rollback, test environment access, session recording consent and approved **private** evidence vault; do not upload signatures, salaries, national IDs, bank data, raw screenshots or credentials to GitHub.
- [ ] On a clean checkout of that exact SHA, run `node --test tests/independent-journey-853.test.mjs` and `node scripts/qa/independent-journey-853.mjs init`. This creates 19 *NOT_RUN* rows, not a success claim.

### Test A — one worker, one source-linked cutoff

| ID | Actor | UI task to witness | Required observable proof |
| --- | --- | --- | --- |
| JOURNEY-01 | HR | Create a fictional worker using the authorized HRIS route | Employer A and the new employee ID persisted; test governed candidate → Hire BP conversion **separately** |
| JOURNEY-02 | HR | Complete and read back same worker's onboarding checklist | Source-owned task records completed; no duplicated employee |
| JOURNEY-03 | Manager / authorized scheduler | Assign and publish correct worker's effective shift | Schedule source and worksite visible to authorized actors |
| JOURNEY-04 | Employee | Clock IN and OUT through authenticated Web Bundy on real test day | New punch ID/date and worker identity, no duplicated punches |
| JOURNEY-05 | Manager | Review correction, reject stale timecard, independently approve updated timecard and lock cutoff | Fresh timesheet snapshot linked to same punch and period; old approval invalid |
| JOURNEY-06 | Payroll Officer | Run no-money payroll through source-owned run API/UI | Exact employee ID, cutoff, premiums, statutory source trace and arithmetic |
| JOURNEY-07 | Checker | Independently inspect register and approve submitted review | Checker differs from maker; unauthorized maker self-approval refused |
| JOURNEY-08 | Owner | Release **payroll records only** | No bank transfer, bank-file submission or payout; duplicate release rejected |
| JOURNEY-09 | Payroll Officer | Download four **DRAFT** filing worksheets and compare bytes/hash | BIR/SSS/PhilHealth/Pag-IBIG draft hashes; **no** government portal acceptance claimed |

### Test B — ten independent cross-cutting observations

- [ ] Owner on actual physical phone; record OS/browser, errors and completion.
- [ ] Payroll Officer on actual physical phone; repeat authorized tasks.
- [ ] Owner switches Alpha → Beta → Alpha; no stale employee/compensation record.
- [ ] Payroll Officer switches Alpha → Beta → Alpha; no foreign payroll data.
- [ ] Same authoritative worker ID across onboarding, WFM, payroll and draft exports.
- [ ] Same real test cutoff for actual authenticated punch, approved time and payroll.
- [ ] No developer assistance; record every intervention as a usability defect.
- [ ] Stale correction invalidates previously approved timesheet; locked cutoff refuses mutation.
- [ ] Records-only release: no payment initiation or bank/provider side effects.
- [ ] Four draft download byte hashes match persisted records; official filing stays NOT_RUN.

These correspond exactly to `CHECKS` in `scripts/qa/independent-journey-853.mjs`. Do not rename keys or pre-fill PASS.

### Test C — novice HR plus separate five-worker WFM rehearsal

- [ ] Two **different untrained HR users** independently find an employee, create/hire using an allowed route, complete onboarding, handle leave, and complete an actually assigned approval: one desktop, one physical phone. Capture observed path, timings, mistakes, network retry, resumption and any confusion. Assign a separate reviewer.
- [ ] Rehearse **five fictional** WFM cases against existing canonical WFM development matrix: ordinary shift; overnight/night differential; approved overtime; incomplete punch → correction; rest-day work. Compare exact worked minutes and independently approved pay premiums. Seeded historical punches prove *calculation*, not same-day authentic capture.
- [ ] Verify no wrong-tenant or out-of-scope fields on browser **and HTTP APIs**; employee cannot self-approve timesheet or see unrelated salary; maker cannot approve own payroll.

### Private observation / defect record (not for GitHub)

Record: source/deployed SHA, consenting operator identity and separate witness identity, role/tenant, device/browser, date/time, expected result, actual result, measured task duration, number of unexpected screens/errors, support required, reproduction steps, redacted evidence reference and disposition. Witness reviews before marking results PASS. Refer to private records only through opaque `PERSON-...`, `UAT-...` and `BUG-...` tokens. The offline checker **does not verify that references are genuine**.

Then on the same clean checkout run:

```sh
node scripts/qa/independent-journey-853.mjs check
node scripts/qa/independent-journey-853.mjs report
```

A complete local reference manifest is **COMPLETE (UNVERIFIED)**, not pilot certification. Report NOT_RUN honestly for any human or hardware step not executed. Never copy a successful manifest to a new SHA.

## Safe engineering preflight available right now

- [P0 merged CI at source `64f609d3`](https://github.com/erwinmehehe/payrollph/actions/runs/38534609769) — source regression green; not human UAT.
- [Synthetic WFM matrix](https://github.com/erwinmehehe/payrollph/actions/runs/38534609656) — mapped synthetic only; not WFM-14 hardware certification.
- [Synthetic production payroll QA](https://github.com/erwinmehehe/payrollph/actions/runs/38534609709) — does not reconcile any real employer.
- [Source-connected nine-stage development acceptance](https://github.com/erwinmehehe/payrollph/actions/runs/38529893874) — earlier source SHA `ee61ef32`, not this exact checklist commit.
- Full linked implementation runbook: [first-employer-journey-execution.md](first-employer-journey-execution.md). Source-supported offline proof tool: [independent-journey-853.md](independent-journey-853.md).

## Stop/go decision

**Development GO:** Continue fictional developer/browser testing and fixing reproducible defects.  
**Pilot NO-GO** until independent true-human observations, applicable production privacy/security/DB controls, independent WFM scope, and an authorized real employer's centavo-reconciled no-money comparison are proven. Do not require completed external agency or bank acceptance merely to run fictional development UAT, but never claim those workflows certified.

After the nine-stage session, publish only sanitized status counts and issue numbers under [#853](https://github.com/erwinmehehe/payrollph/issues/853) and [#852](https://github.com/erwinmehehe/payrollph/issues/852); preserve raw evidence privately.
