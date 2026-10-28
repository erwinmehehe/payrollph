# Manager-attestation POST tenant proof

Exact method: `POST hcm/employment-term-decisions/[id]/manager-attestation`.
This is separate from #1519's GET promotion. No other family's rows, existing
proof lines, application handlers, schema or production flags are changed.

The family reuses the existing read fixture factory without modifying it. Each
employer has a real worker, primary position assignment, current manager, active
employment term and pending decision. The authenticated owner is also genuinely
linked to that manager employee; company-wide People permission alone is not
treated as permission to attest. Synthetic sessions have verified MFA.

The shared write runner exercises two independent authenticated employers and a
real higher-ID victim, binding path IDs to actual saved decisions:

- Own POST 201 is matched against exact PostgreSQL attestation, reporting-line
  snapshot, manager/user identity, recommendation, statement and response.
- Exactly one corresponding decision-evidence event and actor-bound business
  audit must be appended, with prior evidence unchanged. Decisions, terms,
  position assignments, employee/pay profiles, payroll and payouts cannot change.
- All three supported recommendations (`support`, `do_not_support`, and
  `needs_more_review`) receive independent positive persisted-state checks for
  both attackers. A POST appends evidence; it does not approve the decision.
- A real victim organization/path returns 403. The victim decision path under
  an own-employer body returns 404. Victim source state and core rows remain
  unchanged and no private victim marker may leak.
- Cancelled decisions refuse further evidence with 409. A People owner without
  the current-manager employee link, a changed reporting line, and a missing
  verified MFA timestamp each refuse with 403 and no new evidence/audit.
- The shared runner requires the expectation to reject the other attacker's
  genuine before/after/response, preventing a no-op or wrong-employer proof.

## Execution boundary

Local evidence uses a fresh disposable PostgreSQL **18.6** and the production-mode
Next server on `127.0.0.1:3000`, with the existing isolated baseline and unchanged
0104 SQL-only HCM fixture. No live database, provider, real employer, deployment,
approval, employment change, payroll release or money movement is involved.
The exact original local database is restored separately using its saved name.

The existing tenant-table workflow picks up the new family automatically and
runs actual disposable PostgreSQL **16** HTTP acceptance. Local results are not
an exact-head CI success or global isolation certification. Credit generation
uses only the exact new POST key through `tenant-table-credit.mjs`, preserving
existing GET provenance and all unrelated pending GAP methods.

The [sanitized local receipt](./tenant-manager-attestation-post-receipt.json)
records both real attacker pairs, both forged-ID refusals, all recommendation
and denial variants, and unchanged victim state. A separate fresh-database run
with `expect: () => {}` failed at the shared runner's cross-attacker check:
`expect accepts another employer's data`. The original expectation was restored.
The credit script generated exactly **one** provisional GAP-to-COVERED credit.
This is not a second credit for the GET proposed by #1519. No competing probation
promotion is included; that exploratory evidence was retained locally after
#1519 appeared and claimed those two method keys.
