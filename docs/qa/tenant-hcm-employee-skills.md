# HCM employee-skill declaration: independent provisional tenant-isolation proof

**Status: draft test evidence; no route-level credit or deployment approval.**
The authoritative manifest lists GET hcm/capabilities as COVERED and
POST hcm/capabilities as GAP. This addition targets only one POST action,
set_employee_skill with status declared. The other three POST actions
(create_skill, set_job_skill, link_credential) and verification transitions
remain untested by this family.

## Synthetic execution and real identifiers

The dedicated action runner reuses the established shared-table session/seed helpers to create three **genuine fictional employers**
in a disposable PostgreSQL 16 database: attacker A, attacker B, then a
higher-ID victim. Each employer gets a genuine authenticated company owner,
employee, legal entity, org unit and HCM skill catalog record, plus a saved
*historical, unverified* employee-skill assignment.

The isolated action contract posts a new dated **unverified** skill declaration for the owner's
actual employee and seeded skill, and proves via PostgreSQL readback that:

- The real own request succeeds with HTTP 200 and adds exactly one
  employee-skill row for the correct employer, employee and skill.
- The record has the requested fixed date, proficiency, private marker and
  status declared. No verification timestamp or verifier identity is created.
- The HTTP body refers to the exact persisted row, not merely an accepted
  request with no underlying write.
- The previous employee-skill assertion and the full skill catalog,
  job requirements, employee details, pay profiles and payroll runs are unchanged.
- One correctly scoped business audit event names the authenticated owner,
  actual employee and exact new skill.
- A request using the actual higher-ID victim organization, employee and skill
  returns 403 to the attacker. A request using the attacker's own organization
  but the victim's actual employee ID returns 404.
- Each rejected attempt preserves both the attacker and victim state; the dedicated
  runner also checks an unchanged victim organization, workers, org units, legal
  entities and audit ledger.
- Attacker B's expectations reject attacker A's otherwise valid own result;
  tests also reject no-ops, wrong tenant, wrong employee, wrong skill,
  fabricated verified status, deleted history, extra changes and altered audits.

## Acceptance and limits

This uses the existing **default** disposable tenant-table profile, the
dedicated real-HTTP action runner and a dedicated focused PG16/localhost
workflow. Test sessions and markers are fictional, no production access,
external providers, actual payroll records or money actions are involved.

No production source route, authorizations, schema, migration, release flag,
tenant coverage manifest or planning reservation ledger is modified. This
proof is intentionally **partial**: it does not certify all capabilities POST
actions, skill verification authority, other HCM methods or production safety.

Require exact-head unit/negative-control results, a **passing real PG16/HTTP
write proof**, relevant shared table suites and broad CI/security checks,
then independent maintainer review. A separate accepted method-level
reconciliation would be necessary before promoting the POST GAP. Until then
retain **GAP / zero credits / draft / unmerged**.
