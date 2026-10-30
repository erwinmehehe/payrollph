# PII-01 successful identifier approval isolation: disposable PostgreSQL HTTP proof

**Status: DRAFT / NOT ACCEPTED / zero new coverage credits.** This extends evidence for the already merged #1606 final-write tenant constraints. It does not alter the API route, any payroll amount, government filing, provider, migration, production flag, or existing isolation coverage classification.

## Protected scope

- Route: `POST /api/employee-identifier-requests` (both own approved writes and denied approval attempts).
- Production code: unchanged from merged #1606. Original PII-01 GET and POST rejection proof lines and shared `tenant-second-pass-http.mjs` remain unchanged.
- New proof: `scripts/qa/tenant-pii01-approval-http.mjs` and strict environment contract `scripts/qa/tenant-pii01-approval-contract.mjs`.
- Execution: separate step in `Security HTTP Smoke`, after the existing historical tenant sweep, on isolated GitHub Actions PostgreSQL 16 and an actual production-mode Next.js server bound only to `http://127.0.0.1:3000`. Use generated temporary `PII_ENCRYPTION_KEY`, MFA-confirmed owner cookies and fictional worker records.
- Preflight fails closed before loading any DB module unless this is GitHub Actions, `CI=true`, a loopback `app_db` database with literal disposable credentials and no URL overrides, explicit provider/worker flags OFF, and no external secrets.

## Executed cases required to count as passing

Each of **two independent employer owners** must complete these cases with real PostgreSQL readback, not a synthetic stub.

1. **Seven own approvals per employer**, covering all five core government-ID columns plus a new optional passport ID and an existing optional driver's-license ID. Verify ciphertext matches the reviewed request, decrypts to the fictional source, request is `approved`, reviewer ID is correct, and an own-employer audit receipt appears. Confirm existing optional row is updated, not duplicated.
2. **Victim proof**: eight real higher-ID victim employees and pending requests are inserted last and independently readable only to the victim's owner; victim request ID exceeds the own request IDs and 6. Seed a victim-only encrypted optional ID, a victim audit marker, and a nonempty draft-payroll row.
3. **Denial cases per employer**: foreign `organizationId` 403, actual victim `requestId` under own employer 404, forged request joining to a real victim employee 404, wrong-but-well-formed verified value 422, absent verification confirmation 422, and replay of approved request 409.
4. **Conflict fail-closed**: in the disposable fixture only, seed an intentionally inconsistent optional-ID row whose globally unique employee/kind points to the legitimate employee but whose `organizationId` belongs to the victim. A valid own approval must not overwrite it: existing `ON CONFLICT ... WHERE organization_id` returns no row, the handler aborts with HTTP **500**, and the whole transaction (including request status and audit) remains unchanged. The 500 is a deliberately tested failure response, **not** an acceptable end-user recovery status. A future explicitly reviewed 409 contract could improve this.
5. **Revoked membership**: same MFA-verified owner session receives 403 after the fictional employer membership is made inactive, then membership is restored in `finally`.

After **each** legitimate own approval and denied attempt, compare the victim's complete employee, pending request, optional identifier, audit and draft-payroll SQL snapshots. Denied attempts must also leave the attacker's own and the peer employer's business/audit/payroll state unchanged. No success or error response may disclose the victim marker, encrypted victim IDs, or the newly approved raw ID. A forged `employeeId` passed alongside an own optional passport approval must be ignored, updating only the authorized employee.

## Evidence and review gates

- [ ] `node --check scripts/qa/tenant-pii01-approval-contract.mjs`
- [ ] `node --check scripts/qa/tenant-pii01-approval-http.mjs`
- [ ] `node --test tests/tenant-pii01-approval-http.test.mjs`
- [ ] Exact-head `Security HTTP Smoke` actually executes the new real-HTTP PostgreSQL 16 step and prints the `PII01_IDENTIFIER_APPROVAL_PG16_HTTP` PASS receipt with 14 own approvals, 2 foreign denies, 4 forged victim denies, 4 verification denials, 2 stale decisions, 2 conflict rollbacks and 2 revoked member denies.
- [ ] Exact-head repository CI/security/inventory, unchanged historic PII proof and independent tenant-security/coverage-owner review.
- [ ] Production, external pilot, real employer, and official-agency acceptance: **NOT authorized**.

**No changes** to `scripts/qa/tenant-isolation-coverage-manifest.json`, historic receipt lines, historical runner, or source route. The existing provisional GET/POST classifications are preserved, not re-credited, and global tenant isolation remains **NOT ACCEPTED**.
