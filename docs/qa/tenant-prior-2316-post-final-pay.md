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
   Persisted protected victim SQL is compared before and after actions.
   The browser uses a fictional persisted session: this runner **does not**
   claim genuine password/TOTP browser login. It is additional candidate
   evidence, not an accepted full-page credit.

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
separate and untouched, as is PR #1977's unmerged OIDC proof accounting.

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
