# Automation Studio POST tenant isolation: rule drafts and workflow templates

**Review candidate / ZERO method credits / not security or production accepted.**
The existing `POST /api/automation-studio` GAP remains open. This PR extends,
but does not replace or promote, the independent merged operational-case
acknowledge proof in #1878.

## Bounded scope

This is a new, independently runnable **fictional PostgreSQL 16 real-HTTP**
suite for three manual draft-only paths of the existing POST method:

- `save-rule` **create** (HTTP 201), by two different authenticated owners;
- `create-from-template` (HTTP 201), by both owners using the built-in
  `people-new-hire-core-onboarding` definition;
- `save-rule` **update** (HTTP 200), by both owners using their real saved
  rule IDs and the same stored draft versions.

A separate higher-ID third employer first creates its real draft through
the same HTTP endpoint. Seven additional real fictional filler employers
persist inert template drafts so the victim's actual owned rule, version,
worker and identity IDs all exceed six.

The test checks real stored organization, rule, draft and owner IDs; draft
status; version 1; exactly one new own audit event per success; and
`automation_rules.active=false` with `publishedVersion=0`. Even when the
template requests an active preference, **no rule is published or enabled**.

## Tenant and safety refusals

- Both independent owners receive **403** when creating or editing with
  the genuine victim employer selector.
- Each receives **404** for the victim's or the other owner's real rule ID
  under an otherwise authorized own-organization selector.
- Unknown template, invalid draft, unsupported action, missing
  Impact Preview publication receipt, and activating an unpublished draft
  are refused.
- Anonymous, cross-site, HR-role, missing MFA and revoked-grant requests
  are refused without writes.
- A separate SQL snapshot of the two owners and populated victim is checked
  after each denial, and after every valid own change. It covers employers,
  membership, employees, pay profiles, automation rules and versions,
  execution/event/case tables, payroll runs, audit and outbox.
- No automations are executed/replayed, published, enqueued or sent to
  providers. No email, model, payment, payroll release or live customer
  services are contacted. Workers and schedulers stay OFF.

The tests use `scripts/qa/tenant-studio-draft-contract.mjs` for fail-closed
local-only environment checks, exact Git blob pins for the unchanged POST
route and versioning/template/automation libraries, and negative-control
assertions. The GitHub Actions workflow checks out the exact PR head, creates
an empty disposable PostgreSQL 16 database, compiles a production-mode
localhost Next server and invokes real HTTP requests.

## Evidence and remaining actions

1. `scripts/qa/tenant-studio-draft-http.mjs` — exact own, foreign, forged,
   role, MFA, draft-state and immutable-SQL HTTP receipt.
2. `scripts/qa/tenant-studio-draft-contract.mjs` — source and unsafe-env pins,
   own/denied response validators.
3. `tests/tenant-studio-draft-contract.test.mjs` — negative controls,
   including prevention of false owned successes.
4. `.github/workflows/tenant-studio-draft-qa.yml` — PG16 isolated execution
   plus exact-head source check.

**This is NOT whole-method certification.** The remaining POST action
branches (quarantine, triage resolve/reopen, retry, replay, language proposals,
publication, rollback and activation) require their own safe positive and
foreign/forged proofs or explicitly approved alternative operational
classification. A successful denial-only test cannot earn a new
`COVERED` status.

No API handler, schema, manifest, ledger, privilege classification, run
flags or external connector changes are made. The rollback is deleting
this standalone evidence suite; it performs no production data changes.
A green exact-final-head CI, review of its full source-pinned receipts,
and independent security approval are required before any later
reconciliation of API credits.
