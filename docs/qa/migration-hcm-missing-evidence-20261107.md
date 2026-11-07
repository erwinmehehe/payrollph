# Migration and HCM proof completion candidates

Based on main after #1805; independent of the email credit promotion PR.
No API credits, runtime changes, production SQL, providers or flag changes.

## Migration POST

The existing JSON four-kind/two-attacker HTTP positives are retained. New cases:

- Reject an audit insert during each of eight imports; require HTTP 500 and
  identical batch, source, worker, pay-profile, payroll and audit snapshots.
- Import all four kinds through multipart XLSX for both employers, checking
  persisted owned data, eight foreign-employer denials and discrimination.
- The XLSX fixture is parsed through the real XLSX and migration parsers locally.

## HCM escalation POST

This is a global cron-token worker, not a user-selected employer mutation.
Authenticated tenant sessions remain denied. Valid worker authorization is
expected to process all due employers, so an unchanged victim after an authorized
global run would be the wrong contract.

New cases reject a second employer's outbox insertion and require rollback of
every employer's cases/events/outbox. Successful persisted case/event/recipient
proofs must reject a different employer's data. Existing future-case, idempotency,
audit and payroll preservation checks remain intact.

## Evidence state

Local parser, fixture and source-contract tests executed. New HTTP/fault-injection
cases are **NOT_RUN locally** and require the two dedicated disposable PG16 jobs
on this PR's exact head. Neither method is promoted. Source metadata remains
GAP/testedBy:null and exactHeadPg16Http:PENDING. The insert-veto helper refuses
non-CI, non-loopback or unapproved tables and refuses to replace an existing
function; it removes only its own trigger/function in finally.
