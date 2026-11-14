# Previous-employer review + BIR 2316 — post-final-pay tenant boundary

**Scope:** Re-run the existing source-sealed real PostgreSQL 16 / localhost HTTP
proofs for `/workspace/prior-employer` and `/workspace/2316` on the same
proposed head that incorporates merged #1975's final-pay prior-employer change.
This is **source and test orchestration only**. No application source, tax
calculation, previous-employer evidence, API responses, released payroll,
provider credentials, live feature flags, database migrations or production
state is changed. **0 additional page or API method credits.**

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
or an invented page COVERED status.

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
   grants/membership, and protected SQL snapshots unchanged.
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
   same-parent worker refusal, and post-revocation API/page denial.
   The genuine higher-ID victim also has its own persisted, nonempty prior-tax
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

Keep both pages `GAP`, `pageActionCredits: 0`, and
`independentlyAccepted: false`. Successful source checks and isolated
SSR/browser API evidence are still not independent review or full
production-page-action acceptance. The additional prior-employer browser
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

## Independent review blockers identified from source

**These are source-identified authorization/privacy risks, not independently
confirmed production exploits.** Green synthetic QA is not sufficient to
declare them resolved. None is fixed by this QA-only change:

1. **Employee-existence oracle** — `src/app/api/year-end/prior-evidence/route.ts`
   forwards the distinct internal `PRIOR_EMPLOYEE_NOT_FOUND` and
   `PRIOR_ENTITY_ACCESS_DENIED` values in a 409 JSON `code`. A payroll
   operator with employer membership but without another legal-entity grant
   may distinguish a real ungranted employee from an unknown ID. The current
   test establishes **denial**, not indistinguishable responses. Require
   a reviewed non-disclosing response policy and real same-parent negative
   cases, including the unknown ID.
2. **Released final-pay employer drift** — `GET /api/separation` filters its
   joined records with `employees.legalEntityId` (the *current* employer).
   A released separation / BIR source binds its historical legal employer to
   `separationRecords.computationSnapshot.sourceFingerprint.employeeLegalEntityId`.
   Following a transfer, the list can therefore select by a different entity
   from the authorized historical source. Require a separate exact-head
   two-employer transferred-worker PostgreSQL HTTP test, and a reviewed,
   fail-closed policy for incomplete legacy snapshots. This QA-only PR does
   **not** claim to fix the runtime route.
3. **Certificate source error parity** — the early frozen separation guard
   in `/api/year-end/2316-certificate` returns a 404 for an absent source,
   but `assertEntityResource` may return a different denial for an
   ungranted historical employer. The current proof verifies confidentiality
   and reauthorization, **not** identical status/body/cache behavior.
   Require identity/privacy review of the relevant authorization policies.

**No page credits, acceptance flags or release approvals can be earned merely
by adding source checks for these known-open risks.** If product source is
changed, renew the reviewed SHA pins and run full exact-head PG16/browser
tests; do not replace a pin without inspecting the change.

## Exact-head and base-current limitations

The previously checked PR head `a05b562d4811456c8539f880610f2768385d8004`
had 49 successful GitHub Actions workflows and one skipped workflow. That
is historic QA evidence only: newer QA changes in this PR must pass on their
**own** final head. At review time, this branch was also behind `main`,
which has merged #1977 and #1979; source review and CI after an eventual
integration/rebase must re-establish the full evidence ledger. Never
overwrite newer accepted/main OIDC or page-proof records with this branch's
older manifest. Independently inspect final-head test failures, skipped
cases, SQL snapshots and reviewer sign-offs before merging.

## Required human sign-offs before any credit or release

- Verify the exact-head GitHub Actions runs; review synthetic own/victim
  responses, source pins, protected SQL snapshots, browser logs and skipped
  tests, not only a green summary badge.
- Independently approve cross-employer access logic, post-transfer frozen
  legal-employer selection, prior-evidence privacy, checker separation of
  duties, final-pay tax source stability, and the authorized withholding
  certificate lifecycle.
- Keep every production money/provider/SSO/filer control disabled until
  separate owner approvals. Do not merge into `main` based solely on a
  source-only CI repair or provisional coverage numbers.
