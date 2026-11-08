# BIO-01 — Biometric device ingestion and employer boundary

**Distinct work family:** workforce time capture via device HMAC and authenticated People-admin sessions. The scope is specifically POST /api/biometrics/sync. It is not payroll calculation, company billing, enterprise administration, email change, private document access, workforce planning scenarios, HCM SLA escalation or marketing analytics. The production route stays untouched.

**Evidence status: DRAFT / UNVERIFIED / NOT ACCEPTED.** This proof is new QA infrastructure plus disposable real HTTP. No existing method credit is borrowed. Canonical GET biometrics/sync remains provisionally COVERED by the prior independent shared read proof; canonical POST biometrics/sync remains GAP with testedBy:null until independently reviewed. Zero new method credits.

## Proof matrix

The dedicated BIO-01 workflow builds the actual app on localhost with a fresh, empty PostgreSQL 16 database, generated synthetic HMAC root and no payout, email or worker credentials. All three employers, owners, workers and devices are fictional. The victim's persisted employer, employee and device IDs must be higher than both attackers' IDs.

- Anonymous sync POST with valid target -> 401 and no mutations.
- Owner with a hostile cross-origin request -> 403 and no mutations.
- Owner using a real third-employer selector -> 403 and no mutations.
- A device bearer credential reused for another employer or serial -> 401 and no mutations.
- Unauthorized attempt to reference a foreign device serial under the caller's employer -> 404, indistinguishable in status and JSON from a nonexistent device. No foreign data leakage.
- Valid employer-A device HMAC -> 200; exactly one employer-A persisted punch, scoped device update and auditable sync, with employer B and higher-ID victim unchanged.
- The same employer-A token with a real victim badge -> 200 but one unmatched, no new punch, no victim employee, payroll, device or audit mutation.
- Exact replay of employer-A punch -> 200, one duplicate and no second punch.
- Legitimate employer-B People admin session -> 200, exactly one employer-B punch, B-scoped audit, A and victim unchanged.
- Revoked employer-B session cookie -> 401 without modifying attendance, payroll, audit or device rows.

The fixture checks snapshots of employee records, employee-pay profiles, biometric devices, time punches, audit events, payroll runs and memberships, and tests denial status/absence of victim markers. All work happens on 127.0.0.1 with no external device/gateway or real customer data.

## Scope independence and review

BIO-01 adds only a new workflow, contract, runner, test and this document. There are **no edits** to shared tenant-isolation ledgers, production code, migration history, database schema, authentication helpers, existing tests or other PR branches. Source hashes for the biometric route and credential verifier are pinned and must match current main. Re-run overlap checks against every open PR before merge.

This is not a production security certificate, audit acceptance, payroll run, permission to use real biometric devices, or approval to deploy. Exact-final-head CI and independent privacy/security review remain required.
