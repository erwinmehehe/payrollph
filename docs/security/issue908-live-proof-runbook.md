# #908 clean-database live proof: operator packet

**Prepared, not executed. Production isolation remains BLOCKED / unproven.**
This is a runnable metadata checkpoint for an authorized human, supplementing the existing
[full verification sequence](audit-isolation-verification.md). It does not repair or initialize
a database. An empty database without reviewed audit foundations must return BLOCKED.

## Before connecting

The DBA/security owner must independently approve the exact database branch/endpoint, current
serving deployment SHA, actual app/worker/scheduler bindings, clean-baseline/migration receipts,
backup/recovery and credential cutover. Obtain real evidence; do not substitute synthetic tests
or issue closure. Use separately reviewed restricted runtime credentials, never an owner login
masquerading with `SET ROLE`. Keep secrets and detailed identities in the restricted evidence vault.

Use a clean, reviewed checkout at the **same full SHA as the serving deployment**, with reviewed
dependencies installed. Do not deploy this packet merely to obtain a matching SHA without the
normal release process. `--execute` rejects tracked changes and a source/deploy SHA mismatch.
An operator assertion of a deployed SHA is not independent deployment verification.

## Nonconnecting inspection

```powershell
node --import tsx scripts/qa/audit-live-metadata-proof.ts --describe
node --import tsx --test tests/audit-live-metadata-proof.test.ts tests/audit-role-proof.test.ts
```

These commands use no database. Unit tests use fake clients only.

## Human-run checkpoint (once per actual ordinary runtime identity)

Load these variables through your approved secret mechanism, without echoing credentials or
putting them in shell history. The script does not load `.env`, use `DATABASE_URL`, or capture
deployment secrets. No secret acquisition is included in this packet.

| Environment variable | Required value |
| --- | --- |
| `ISSUE908_PROOF_MODE` | `operator-approved-metadata-only` |
| `ISSUE908_ROLE_LABEL` | `app`, `worker`, or `scheduler`; repeat for every distinct deployed binding |
| `ISSUE908_PROOF_DATABASE_URL` | Actual approved runtime credential, explicit `sslmode=verify-full`; no other URL options |
| `ISSUE908_EXPECTED_HOST` / `ISSUE908_EXPECTED_PORT` | Independently verified endpoint and port (port defaults 5432); resolve pooled/direct aliases explicitly |
| `ISSUE908_EXPECTED_DATABASE` / `ISSUE908_EXPECTED_USER` | Independently verified database and actual login |
| `ISSUE908_SOURCE_SHA` / `ISSUE908_DEPLOY_SHA` | Identical reviewed full 40-character lowercase commit SHA |
| `ISSUE908_APPROVAL_REFERENCE` | Private independently approved change/evidence reference |

```powershell
node --import tsx scripts/qa/audit-live-metadata-proof.ts --execute
if ($LASTEXITCODE -ne 0) { throw 'Audit metadata checkpoint BLOCKED; stop and review privately.' }
```

Capture stdout JSON, exit status, script/source checksums, time, deployment verification,
target/binding evidence and approval reference in the restricted vault. The JSON omits URLs,
credentials, database/login names, raw SQL errors and customer rows. Sanitize before sharing;
timestamps, SHAs and role labels can still be operationally sensitive. Never publish secret env dumps.

The client enforces default read-only at startup, begins `READ ONLY`, checks actual database,
session/login equality, PG16–18 and transaction mode, then evaluates the **existing 17-predicate
strict catalog query** directly. It always attempts ROLLBACK and closes the session, including
on errors. Timeouts bound connection/query/lock waits. No app DB import, schema setup, business
row reads, DDL, DML, sealer invocation, role switching, COMMIT or readiness HTTP request occurs.

Exit 0 + `METADATA_PASS` means only that exact connection's metadata checkpoint passed.
Missing/false/nonboolean fields, zero/multiple result rows, bad identity, changed source,
TLS/configuration failure or SQL error mean nonzero + BLOCKED. Do not retry with broader grants,
disable TLS, change flags or edit the pinned query to obtain green. Diagnostic error details
must be investigated privately by the DBA; the script intentionally suppresses them.

## Still required after metadata passes

- Independently reconcile deployed configuration and actual role bindings; the local script cannot
  discover which credentials a web/worker deployment really uses or prove the operator supplied the right target.
- Dedicated sealer login and restricted group proof are **not** ordinary-role checks. Use the
  existing reviewed sealer acceptance plan; this script deliberately rejects a `sealer` label and
  never seals live data. Verify maintenance/auditor isolation and genuine migration receipts separately.
- Run existing PG16/18 four-cell real-login negative/append/sealing/rollback and persisted-head
  tests on protected disposable staging. No tampering, synthetic writes or role provisioning on live.
- The authorized witness must confirm strict mode and request-schema read-only cutover before
  the separate protected readiness GET described in the full runbook. This script neither enables
  flags nor calls that handler, whose schema-setup side effects require independent preflight.
- The independent witness signs the complete packet's PASS/BLOCKED/FAIL disposition. Even all
  seventeen booleans true do not authorize payroll, payouts, filing, tenant acceptance or release.

No live query has been performed by preparing or testing this packet. Do not close the outstanding
operational acceptance based on this PR or a synthetic pass.
