# Studio operational-case resolve/reopen: bounded tenant-isolation evidence

**Draft evidence candidate. ZERO method/page credits. Not independently accepted or production certified.**

This independent suite starts from `main@2d2f23672180044b563d489f96a75b2f253520c1`.
It complements the merged acknowledgement proof and the separate draft/publication
suites. It changes no runtime route, schema, coverage manifest, existing workflow,
feature flag, or financial code. All five files are new.

## Exact scope

`POST /api/automation-studio`, action `triage-operational-case`, transitions
`resolve` and `reopen`, with real `attendance_resolution` source rows only.
Two separately authenticated owners each perform a successful resolution and
reopening. Seven fully populated filler employers precede a real third-employer
victim; its employer, identity, legal entity, unit, worker, membership, pay profile,
attendance source, case and inert payroll IDs must exceed both owners and six.

The runner requires four owned HTTP 200 transitions, twelve foreign-employer/real
foreign-case refusals, fifty-six total negative requests, and four reached audit
veto rollbacks. Those are required assertion counts, NOT claims of completed CI.

Successful HTTP bodies must equal actual persisted SQL rows. Only the selected
case's transition fields and one correctly attributed audit may change. Every
other case, authoritative source, worker, payroll, automation and outbox row is
compared unchanged. Existing audits are nonempty and must remain identical.
Denied requests snapshot all seventeen protected tables across all employers.
Rate-limit counters and session last-seen bookkeeping are intentionally excluded.

## Critical negative controls

- Owned employer plus a real victim/peer case ID; forged employer selector;
  foreign and nonexistent case IDs must produce indistinguishable 404 JSON.
- Source still open; missing source; and an owned case deliberately linked to a
  resolved foreign-employer source must all refuse resolution.
- Invalid case IDs and evidence notes, invalid/duplicate transitions, and the
  requirement to acknowledge a reopened case before resolving it again.
- Company HR, unit-scoped bookkeeper, missing MFA, anonymous/cross-site requests,
  and revoked membership with the original session still authenticated.
- Each owner/action gets a temporary audit-insert veto. A nontransactional sequence
  proves the veto was reached exactly once; HTTP 500 alone never counts. The case,
  source and audit rows must roll back completely, then the same operation must
  succeed after the test-only trigger is removed.

Source resolution and prerequisite states are explicitly seeded by disposable
fixture SQL. This does NOT exercise attendance-resolution authorization, case
creation/acknowledgement governance, or all other operational source families.
Reopening does not reopen or mutate the underlying attendance event.

## Execution and acceptance

Local, database-free oracle checks:
`node --test tests/tenant-studio-resolution-contract.test.mjs`.

Dedicated workflow: `.github/workflows/tenant-studio-resolution-qa.yml`.
It checks out the exact PR head, verifies reviewed source blobs and an exact
localhost-only environment before schema setup, builds Next in production mode,
and runs real HTTP against a fresh PostgreSQL 16 service. Successful execution
retains `qa-artifacts/tenant-studio-resolution-receipt.json` with the actual Git
revision, source hashes and executed counts; no sessions or raw SQL dumps.

The application/database integration could not run in the authoring sandbox
(no reachable repository checkout or PostgreSQL service). Local oracle tests and
syntax checks are not substitutes for the dedicated CI result. Exact-final-head
CI, source/receipt review and independent security/domain approval remain required.

Workers, external-provider credentials and payout flags remain OFF. No retries,
replays, publication, activation, provider requests, payroll calculation/release,
real employer data or live database are used. Synthetic fixture triggers/sequences
exist only in the disposable database and are removed by the runner.

`POST /api/automation-studio` remains GAP. No whole-method or page credit, merge,
deployment, production activation or tenant-wide security acceptance is implied.
