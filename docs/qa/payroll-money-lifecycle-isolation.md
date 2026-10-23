# Payroll money lifecycle isolation — partial MNY-01

PR: https://github.com/erwinmehehe/payrollph/pull/1339

This work is not closure of the frozen 33-method MNY-01 batch, full tenant
isolation, final-pay acceptance, provider payout acceptance or launch approval.
Eight changed-handler methods are provisionally source-linked only after the
two real HTTP/PG16 jobs passed. Global acceptance remains NOT ACCEPTED, with
344 API-method and 19 page/action gaps. Fresh final-head CI remains required.

## Defect and default-off correction

The previous approval invalidation predicate used
`task.detail.includes("Payroll run #" + run.id)`. Executed regression cases
reproduce a collision: run 12 also matches the text for run 123. An exact linked
task with renamed display text was missed. Recalculation and earnings, holiday
and compensation changes shared this predicate.

`EXACT_PAYROLL_APPROVAL_LINKS_ENABLED` is registered and defaults OFF. With it
ON, the employer must match, a non-null `payrollRunId` is authoritative, and a
legacy null-FK task must start with the complete canonical numeric run token.
Wrong-run FK values cannot be overridden by display text. OFF preserves the
previous predicate exactly, including its known collision; deploying this PR
does not activate the correction. Payroll engine calculations are unchanged.

## Executed local evidence

- `npx tsc --noEmit` passed with a 6 GiB Node heap.
- `npm run lint`: zero errors, ten existing warnings, zero baseline violations.
- All four `TZ=Asia/Manila` golden commands passed (83 cases, phase 2A, phase
  2B and pay-rules).
- Three executed matching tests and two disposable-target guard tests passed;
  the five existing critical-flag registry tests also passed.
- Both flag states passed the local direct-handler diagnostic against real
  disposable PostgreSQL: 415 assertions and 42 denied requests per state.
  This adapter substitutes session lookup and opens no listening socket. It
  is explicitly forbidden in GitHub Actions and is NOT HTTP/authentication
  acceptance. Receipts identify the transport so it cannot be confused with CI.
- A complete local `TZ=Asia/Manila npm test` was attempted against the separate
  money database. Some preexisting tests require the literal `/app_db` name;
  this run is NOT a full-suite PASS. Exact-head Linux regression remains
  required. The three database-name failures passed in a six-test rerun against
  disposable `app_db`. The complete TypeScript phase there finished with 4,888
  passes, 47 skips and one historical coverage-counter assertion, which was
  fixed and passed its six-test focused rerun. The initial
  inventory drift was resolved by exact source/method proof links after HTTP
  execution; 71 inventory/closure guards passed. Those are bookkeeping checks,
  not substitutes for HTTP behavior; no remaining gap was waived. The full
  Windows `.mjs` inventory additionally exposed the existing Bash-path,
  executable lookup and `O_NOFOLLOW` portability failures. A shifted registry
  citation was corrected by appending the new flag without moving old entries;
  its four checklist tests pass. No Windows portability guard was relaxed and
  no clean complete Windows-suite PASS is claimed.

## Required real HTTP proof

The dedicated workflow builds the production app and runs two isolated PG16
jobs, one per flag state. Each creates its own empty disposable database from
the guarded `app_db` schema. It uses only localhost, fictional users, dedicated
test keys and synthetic bank values. The target guard runs before DB imports;
hosted URLs, query-string DB overrides, provider/mail credentials and enabled
payment/underpayment-posting flags are refused.

| Surface | Methods and controls |
| --- | --- |
| Supplementary earnings | GET/POST/PATCH; nonempty own evidence, worker/organization/ID forgery, own create/void SQL checks |
| Underpayment corrections | GET/POST/PATCH rejection; independent reviewer, self-review rejection, foreign worker/source/claim rejection; approval posting stays OFF |
| Payroll calculation | POST; real own calculation, foreign run rejection, retained-session membership revocation, employee-role rejection |
| Checker submission | POST; real own task, self-checker and foreign-checker rejection |
| Payroll approval | PATCH; distinct own checker, maker rejection, real foreign task denied |
| Payroll release | POST; distinct releaser, checker rejection, recent MFA, own SQL release/payslip receipt; no provider transfer |
| Local holidays | GET/POST/PATCH/DELETE; actual own records, foreign organization/ID rejection, forged selectors, SQL update/delete checks |

Both independent attacker employers exercise the same methods against a real
victim employer. Worker, run, source, earning, correction and holiday victim IDs
are greater than both original attacker comparators and six. Every denied
request snapshots and compares the victim's organization-scoped money, audit,
approval, employee and holiday tables plus run-linked payroll entries. The final
victim snapshot must also equal its initial snapshot across both whole journeys.

Separate same-employer prefix-collision fixtures exercise recalculation and
earnings create/void, checking target entries and approvals as well as unchanged
unrelated registers. Flag OFF intentionally proves legacy behavior; ON must
preserve unrelated approvals and invalidate exact renamed and legacy tasks.

At `428b4c371c55686eea748920600f3cdfa9efcf64`, both production-mode real HTTP/PG16
jobs passed with **301 assertions and 42 unchanged-victim denial receipts each**:

- [Flag OFF](https://github.com/erwinmehehe/payrollph/actions/runs/39885142988/job/120191468825)
- [Flag ON](https://github.com/erwinmehehe/payrollph/actions/runs/39885142988/job/120191469158)

CI uploads `qa-artifacts/tenant-money-lifecycle.json`, with the exact head,
transport, flag state, own-success identities and individual denied-request
receipts. The subsequent proof-link/counter changes require fresh final-head CI.
No production flags, live databases, migrations, agency submissions or payment
provider credentials were changed. No UI was modified.
