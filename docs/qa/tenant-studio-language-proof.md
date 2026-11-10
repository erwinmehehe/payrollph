# Studio keyless language proposal and signed-save isolation

Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**. This is a separate main-based
batch for the previously unproved `draft-from-language` and
`save-language-draft` actions of `POST /api/automation-studio`.
It does not duplicate the merged manual-draft, publication, operational-case
or execution-recovery proofs. Runtime routes, existing proofs, manifests,
coverage counts and production flags are unchanged.

## Bounded execution

The proof enables the **existing language UI gate only inside its disposable
localhost test process**. The external-model gate, all model consent and
allowlists, all providers, worker/scheduler and money flags remain off.
An exact code-reviewed onboarding expression uses the existing keyless template
fallback. Saving creates an inactive, unpublished definition; it does not run
the checklist, send its email, publish a workflow or create an outbox event.

The runner refuses external targets, nonempty employer/identity databases,
unexpected source blobs and provider credentials before seeding. Fourteen
runtime input files are byte-sealed. Only PG16 is accepted. It uses two real
authenticated fictional owners, seven populated filler employers with inert
definitions, and a populated third victim whose employer, owner, worker,
rule and version IDs exceed both attackers and six.

## Required behavior

- Three real proposals must return the exact typed approved template and
  employer/actor/session-bound receipt. SQL may gain only one correctly
  attributed metadata-only audit; no draft, execution or outbox is created.
- Three signed saves must return HTTP 201 with rule/version objects equal to
  persisted SQL. Old definitions and audit history remain unchanged. The new
  definition must be inactive, unpublished and created by the correct actor.
- Forty-four actual refusal requests cover foreign/peer employers, borrowed
  receipts, a second session of the **same** owner, changed names/actions,
  forged or missing signatures, injected tenant fields, unsafe/unsupported
  prompts, replayed saves, anonymous, cross-site, missing MFA, non-admin and
  revoked-membership callers. Receipt failures must be the proposal-proof
  refusal, not an incidental duplicate-name error.
- Every refusal compares all twelve protected tables across all ten employers.
  The original revoked user's session must remain authenticated.
- Twelve live oracle discrimination checks and no-op SQL negative controls
  prevent another employer's real success or an unchanged database from passing.
- A sanitized JSON receipt records source head/blobs and counts, never cookies,
  raw signatures, user credentials or model/provider secrets.

## Running and verification

The dedicated `tenant-studio-language-qa.yml` checks out the exact PR head,
preflights before DB setup, creates only disposable PG16 state, builds the real
Next app, and executes real HTTP before retaining the receipt. Required locks
are exported in `tenant-studio-language-contract.mjs`; the only allowed targets
are dedicated loopback test ports. A local run must own its fresh cluster and
server, never reuse an existing developer database or fake GitHub Actions.

Pure checks: `node --test tests/tenant-studio-language-contract.test.mjs`.
Actual runner: `node --import tsx scripts/qa/tenant-studio-language-http.mjs`.
Do not run the existing CI-only baseline helper outside real CI.

At initial authoring: seven contract/negative-control tests passed; local real
PG16/HTTP run is in progress. Exact final-head GitHub CI is **NOT_RUN** until
its actual HTTP step completes. A local test or a build is not a CI receipt.

## Credits and limits

**Zero new method credits.** This closes two action-proof holes, not all
configurations of Studio POST. The model-backed lane and external processor
acceptance are not exercised. Whole-method credit still requires reconciliation
of the distinct merged draft/lifecycle/triage/resolution/execution proofs with
this language proof, current-source execution and the required owner decision.
No independent security/privacy signoff, staging/customer acceptance, deployment,
production flag enablement, provider request or payroll authorization is implied.
