# Previous-employer review + BIR 2316 — post-final-pay tenant boundary

**Scope:** Fix the actual employer-authorization and employee-existence leaks
identified after #1975 while re-running exact-head fictional PostgreSQL 16 /
localhost browser/API evidence for `/workspace/prior-employer` and
`/workspace/2316`. This PR **now changes three application API routes**:
the separation listing, prior-evidence GET/POST error policy and Form 2316
certificate preview GET/POST error policy. It does not change final-pay
arithmetic, persisted payroll money, third-party providers, feature flags,
schema migrations, or production state. **Zero new page or API-method credits.**

## Why this is needed

The pre-existing targeted tests cover prior-worker SSR, same-parent legal-entity
denial, historical released separation after transfer, grant/member revocation,
and the BIR 2316 hydrated browser, source API and unsigned-PDF path. However,
their workflow `pull_request.paths` filters do not consistently include the
#1975 separation route and final-pay source. A source change can therefore
leave these specific page proofs untriggered even when the final-pay
annualization logic has changed. A prior green run is not proof for newly
changed source.

## Source-current cross-page security contract

`tests/tenant-prior-2316-post-final-pay.test.mjs` checks the exact inspected
source Git blobs of both pages, their current API routes, the transaction-bound
prior evidence helper, the frozen historical Form 2316 helper, the current
#1975 separation route and its approved previous-employer helper. It also
checks authorization *order*: live employer/payroll access and persisted
employee/entity checks before SSR mounting, frozen released employer for
historical 2316, repeat source-entity authorization before an unsigned PDF,
and source approval digest/revision/tax-year revalidation before separation
initiation, finance approval and release. Mutation tests reject changed source
or a forged provisional page COVERED receipt.

This is a **source-only regression**. It does not prove application security
without the real HTTP and database tests below. If any inspected source changes,
renew the contract deliberately and re-run all relevant tests; never just
replace a hash without reviewing the changed authorization behavior.

## Executable proof lanes triggered by this PR

1. `tenant-prior-review-worker-ssr-qa.yml`: synthetic PG16,
   two authenticated attackers and a genuine victim, own selected employee
   form, same-parent foreign legal-employer and cross-org 404, forged/duplicate
   selectors, revoked membership, protected SQL unchanged, and missing source
   fail-closed. The test also checks worker-selected 2316 guidance and
   released-separation access.
2. `tenant-2316-ssr-transfer-qa.yml`: synthetic PG16, separate owners,
   populated own 200, genuine foreign 404, frozen historical employer after
   current worker transfer, ungranted same-parent workers, revoked employer
   grants/membership, and protected SQL snapshots unchanged. The strengthened
   runner **directly calls `GET /api/separation`** before and after transfer
   with two different same-parent legal-employer grants. It asserts old
   released records stay with the frozen employer, mutable unsnapshotted draft
   records follow the current employer, and missing/string-valued frozen
   employer IDs never become accessible. The runner also issues safe
   **PATCH /api/separation** requests with an unrecognized action, proving
   that the frozen employer reaches a 400 without mutations while the
   new employer, a nonexistent ID and invalid historical attribution
   receive identical 404 denials. It compares actual GET
   `/api/year-end/2316-certificate` response status/body/cache for a real
   ungranted source versus an unknown separation.
3. `tenant-2316-browser-pdf-qa.yml`: isolated Chromium + PG16 with
   password/TOTP logins, hydrated source review, actual GET and PDF POST,
   reviewed unsigned PDF bytes, digest-stale refusal, forged/foreign
   employer requests, historical transfer and revoke checks.
   The existing final-pay prior-employer **unit regression** is executed
   alongside the cross-page source contract.
4. `scripts/qa/tenant-prior-evidence-action-browser.mjs` runs **after**
   the separate 2316 browser/PDF proof in the same disposable PG16 job.
   It seeds independent fictional company owners, a genuine higher-ID
   victim, a same-parent ungranted employee and a separately authorized
   checker. It exercises real HTTP prior-evidence GET/save, hydrated
   prior-employer form load/revision, checker approval of the current digest,
   self-approval and stale-digest denials, genuine cross-employer refusal,
   same-parent worker refusal, post-revocation API/page denial, and matching
   GET **and** POST error bodies for a real ungranted employee versus an
   unknown employee. The genuine higher-ID victim also has its own persisted, nonempty prior-tax
   source. The runner compares **all protected employer-B SQL**, same-parent
   ungranted-employer SQL, revoked maker SQL and the higher-ID victim SQL after
   denied requests, rather than checking only an unrelated empty victim.
   The maker browser uses a **real localhost password + TOTP login with fictional
   credentials**; the separate checker is a different persisted user with a
   **synthetic MFA-verified session**, not an independently proven real login.
   This remains QA candidate evidence, not an accepted full-page credit.

All three run with real database assertions against **fictional local PG16
only**; production providers, worker, scheduler and payment flags stay OFF.
Feature-ON flags in these jobs are confined to the disposable CI process.
Every job checks out the exact pull-request head. No completed result may be
claimed until the jobs finish successfully and logs are inspected.

## Coverage and acceptance boundaries

After synchronizing with `main`, preserve its existing source-pinned six-page
provisional `COVERED` SSR/GET receipts for both workspace pages. Those
receipts require exact-final-head PG16 reproof and retain
`reviewedUncertified.pageActionCredits: 0`, `methodCredits: 0`, and
`independentlyAccepted: false`. This PR awards **zero new credits**.
Successful source checks and isolated SSR/browser API evidence are still not
independent review or full production-page-action acceptance. The additional prior-employer browser
runner now tests load, save and **different-user checker approval** on
fictional PG16, but its exact-final-head execution and independent inspection
remain mandatory. It is not a receipt of approved production sign-in, all
prior-evidence policy variants, or an accepted whole-page action surface.
Existing 2316 unsigned PDF evidence does not establish statutory filing,
approved certificate signature, payment or historical document delivery.

The anonymous SSO resolve and disabled SAML metadata API policy holds are
separate and untouched. PR #1977's OIDC proof accounting has since merged
into main, as has #1979's Org Explorer browser proof. This PR's exact-head
successes on the older branch do **not** establish integration with either
later main change.

## Reproof trigger completeness

The previous exact-head workflows did not watch every dependency exercised by
the combined prior-employer / 2316 browser QA. All three workflows now
explicitly watch the same 30 shared source, authorization, identity/MFA,
year-end validation, client-component, migration-fixture, and test inputs.
The cross-page source test rejects missing watcher entries, missing PR
head checkout, or missing disposable PostgreSQL 16. The prior-employer SSR
workflow's two separately cited manifest/inventory SHA references were
renewed to the exact new workflow blob; **no page or API credit changed**.
This closes a CI trigger gap, not the application-access risks below.

## Authorization/privacy repairs (source committed; final-head proof required)

These issues were identified through source review; they were **not**
confirmed as production exploits. They now have concrete runtime fixes and
real synthetic browser/HTTP regression cases:

1. **Prior-employer employee-existence parity:** The external 409 response
   maps both internal `PRIOR_EMPLOYEE_NOT_FOUND` and
   `PRIOR_ENTITY_ACCESS_DENIED` to `PRIOR_RECORD_UNAVAILABLE`, with the
   same response body and private `no-store` policy on GET and POST.
   Internal authorization remains fail-closed and source errors for an
   authorized record remain distinguishable for actionable recovery.
2. **Separation historical employer:** In multi-entity mode the GET list
   applies a database-side source-fingerprint predicate when the snapshot
   contains a verified JSON **number** employer ID. PATCH now uses the same
   frozen employer via `frozenFinalPayLegalEntityId()`, before any mutation.
   A bare draft with `computationSnapshot = {}` can use the current employee
   entity; a released/approved snapshot without valid attribution cannot
   inherit the employee's new employer. Missing and foreign-record PATCH
   requests receive the same 404, concealing private separation existence.
   The GET response adds `Cache-Control: private, no-store`. Unit-scoped
   access still uses the existing current org-unit check; this is not a
   historical org-unit reconstruction.
3. **BIR 2316 certificate existence parity:** After an authorized employer
   is selected, both an unknown frozen source and one in an ungranted legal
   employer now return identical 404 JSON; the transactionally reloaded
   source-entity check also responds with the same 404. No PDF is generated
   and no private source is returned in either case.

The existing historical method proof receipts retain their original Git
blob SHAs and workflow run IDs. The *new* handler blobs are recorded
separately in `sourceRevisionReview`. This is **not a new claim that old
tests executed on changed handlers**: reproof must be completed and inspected
on the actual final PR head. If a PG16 fixture fails, fix the source or test;
do not relabel another endpoint as covered to mask it.

## Open product and release limitations

This PR does **not** certify signed BIR filing, historic org-unit attribution,
every tax computation variant, outside provider behavior, production login,
live data, or real payroll disbursement. These are distinct surfaces.
The two workspace pages retain `main`'s existing provisional SSR/GET receipts; this PR adds zero page or API credits. Full-page-action and production acceptance remain unproved.
No independent tax/security review has been performed, and none is implied
by a green CI badge. A solo maintainer can make and document the repository
merge decision after checking the exact-head results; production tax/legal
compliance deserves separate specialist validation where appropriate.

## Exact-head and base-current limitations

The previously checked PR head `a05b562d4811456c8539f880610f2768385d8004`
had 49 successful GitHub Actions workflows and one skipped workflow. That
is historic QA evidence only: newer QA changes in this PR must pass on their
**own** final head. The branch has now incorporated `main` via sync commit `a60d7e4`.
That merge also brought the six-page provisional SSR/GET receipts.
The Form 2316 proof script changed in this PR, so its exact Git blob pin and
line citations must match the changed proof and be independently re-executed
on the resulting final head; earlier successful runs are not a substitute.
Do not overwrite newer accepted/main OIDC or page-proof records. Independently inspect final-head test failures, skipped
cases, SQL snapshots and reviewer sign-offs before merging.

## Solo-maintainer acceptance checklist

- Review the actual final commit's full CI, PG16 transfer/denial matrices,
  prior-employer browser actions, both GET/POST error-parity cases, refusal
  tests, unchanged protected SQL, and source seals.
- Confirm both workspace pages retain only `main`'s provisional, source-pinned
  SSR/GET receipts; no new API/page-action credits were created. Re-execute
  the changed Form 2316 proof on the final head, keep historical receipts
  intact, and verify the merged tree does not downgrade OIDC/Org Explorer work.
- Decide whether the remaining *product* limits above are acceptable for
  the intended deployment. Document the owner decision. No fictional
  second approver or independent review should be recorded.
- Keep production money, filing, disbursement, providers and scheduler
  disabled unless separately authorized and tested. The PR is never a
  regulatory certification or automatic production rollout.
