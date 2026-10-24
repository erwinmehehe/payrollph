# Payout destination requests — pending legal-employer reconciliation (HOLD)

**Status: deployment/flag-activation blocker, not an approved migration.**
Covers the narrow `payout-destination-changes` GET and PATCH hardening in draft PR #1367.
No live database, bank provider, migration, payroll run, payments or production flag
is changed by this document.

## Why pending requests need source-specific treatment

Payout change requests created before frozen legal-employer attribution have
`original_snapshot` without a valid numeric `legalEntityId`. Other pending
requests may have a frozen employer that no longer matches the employee's current
employer after a transfer. Neither category can be safely assigned to the current
employer automatically: an employee's **current** employer is not proof of which
employer originally accepted a payroll bank instruction.

With `MULTI_ENTITY_ENABLED=true`, the GET list hides such unattributed/mismatched
pending requests, and PATCH refuses **both approval and rejection** through the
regular legal-employer-scoped decision path. These denials are intentional; they
must not be bypassed by supplying a forged `legalEntityId`, switching to a group
role, temporarily turning OFF isolation in production, or editing JSON by hand.

## Review and remediation BEFORE entity-flag activation

1. **Inventory, read-only:** an independently authorized operator determines the
   count of still-pending requests that lack frozen legal-employer attribution,
   point to a different current employer, have a missing parent employee, or have
   employee/organization inconsistencies. Inspect only authorized employer IDs
   and masked request metadata; do not export bank ciphertext, PII or accounts.
2. **Verify the employer of record:** reconcile the creation-time legal employer
   with the original immutable HR assignment, employment interval and authorized
   treasury evidence. A current worker/employer foreign key alone is insufficient.
3. **Hold affected requests:** do not approve, release, transfer, silently
   reassociate, overwrite or auto-cancel them. Notify the responsible treasury
   owner through existing private channels without exposing account details.
4. **Independent resolution:** a separately reviewed, least-privileged
   administrative cancellation/re-creation capability is still required. It must
   atomically scope by organization AND verified original legal employer, preserve
   maker/checker separation, record who cancelled and why, and never apply a bank
   change. The employee submits a new instruction under an explicitly granted
   legal employer, with fresh approval evidence. **This PR does not implement or
   authorize that maintenance tool**.
5. **Release gate:** do not activate multi-entity for that tenant until there is
   an owner-approved, immutable resolution record for every affected pending
   request, the remaining count is zero, legal-employer grants are reconciled,
   and real authenticated own/foreign HTTP checks and independent review pass.

For pending requests after an employee transfer, use the same hold/review
procedure; do not infer historical legal employer from today's employee row.
Coordinate the HR transfer process so unresolved payout changes are handled
before new transfers, without authorizing any bank change in the transfer flow.

## Synthetic regression evidence

`scripts/qa/payout-destination-entity-http.mjs` runs under the guarded
Multi-Entity Browser and HTTP Acceptance workflow with generated test keys,
real production-mode HTTPS sessions, **three fictional organizations**, two
legal employers within a victim organization and disposable localhost PG16.
It tests legitimate B/C own GET and PATCH responses, high-ID victim denial,
forged selectors, immutable victim payout/employee/audit rows, same-tenant
cross-employer requests, grant revocation, pending transfers and legacy
unattributed requests. Flag-OFF read compatibility is checked separately.

New method manifest credits are **provisional until exact PR-head CI** completes.
Even green automated CI does not authorize rollout or certify external banking.
No Neon/prod row inspection, migration execution or provider movement occurred.
