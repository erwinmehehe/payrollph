# PayrollPH Launch Readiness Audit — 2026-10-01

## Verdict

**NOT LAUNCH READY**

This audit deliberately separates "code exists and CI is green" from "the production payroll service is proven safe to launch."

Current source `main` passes CI and CodeQL, but the live production rollout gate and the live five-role RBAC smoke both failed on 2026-10-01.

The most important live failure is:

```
503 BANK_DATA_ENCRYPTION_REQUIRED
The production demo is unavailable until encrypted payout storage is configured.
```

The sanitized production readiness endpoint also reported **10 launch blockers**, with these four pilot-critical blockers:

- `production-security-config`
- `email-delivery`
- `bank-data-encryption`
- `malware-scanning`

The current readiness model indicates the remaining launch gates are:

- production security configuration
- transactional email delivery proof
- billing proof
- bank / payout validation
- bank-data encryption
- BIR Alphalist / 2316 validation
- SSS R-3 validation
- PhilHealth RF-1 validation
- Pag-IBIG MCRF validation
- malware scanning

## Seven launch gates

### 1. Real user journey — BLOCKED

**Required proof**

A complete production-like cycle must work as:

HR -> Payroll Officer -> Checker -> Owner -> Employee

The proof must include employee setup, pay configuration, payroll calculation, exception handling, checker approval, owner release, payout, payslip access, notification delivery and audit evidence.

**Evidence already present**

- automated payroll lifecycle tests
- release and payout audit receipts
- payout reconciliation and failed-only retry
- five production demo personas
- Chromium browser QA

**Blocking evidence**

The live production RBAC sandbox cannot currently open even the Owner persona because production payout encryption is not configured.

The full production journey therefore has not been proven.

### 2. Failure and recovery — PASS IN CODE, PRODUCTION PROVIDERS NOT FULLY PROVEN

The application has explicit recovery paths for:

- calculation failure and retry
- payroll exceptions
- declined checker review and resubmission
- blocked release
- failed exports
- queued / sent / failed email delivery
- failed-only payslip notification retry
- pending / succeeded / failed payout reconciliation
- failed-only PayMongo transfer retry

Automated tests cover these recovery paths.

Remaining production proof:

- a real email failure and retry
- a real provider payout failure / pending state
- a real provider recovery cycle

These should be exercised during the production pilot rather than simulated only in unit tests.

### 3. Role and permission isolation — BLOCKED IN PRODUCTION

**Automated status: PASS**

The codebase has explicit role-scoped navigation and server authorization for Owner, HR, Payroll Officer, Checker and Employee.

CI tests verify that UI capabilities track the same server role families.

**Live status: BLOCKED**

The production five-role smoke failed before role verification because the Owner demo session is blocked by missing bank-data encryption.

Do not mark RBAC production-proven until all five personas pass the live smoke.

### 4. Production infrastructure — BLOCKED

The live readiness gate reports ten launch blockers.

#### P0 blockers without an acceptable manual bypass

1. **Production security configuration**
   - canonical HTTPS origin must be proven
   - `TOTP_ENCRYPTION_KEY` must be present and valid

2. **Transactional email**
   - a provider must be active in production
   - at least one successful delivery must be recorded

3. **Bank-data encryption**
   - `BANK_DATA_ENCRYPTION_KEY` or a valid `TOTP_ENCRYPTION_KEY` must be present
   - all legacy employee bank accounts must be encrypted
   - all payroll payment snapshots must be encrypted

4. **Malware scanning**
   - production document uploads fail closed today
   - a valid HTTPS scanner and token are still required before document uploads are available

#### Other launch gates with documented pilot workarounds

- billing can be activated manually only after confirmed payment
- bank payout can use the released bank file and manual bank upload
- BIR / SSS / PhilHealth / Pag-IBIG files can be manually entered while official validation remains pending

These workarounds may support a controlled pilot, but they do not make the system full-launch ready.

### 5. Operational UX — PASS FOR AUTOMATED PRODUCT QA

The product now has:

- role-specific dashboards
- visible payroll handoffs
- explicit approval ownership
- release receipts
- payout status and reconciliation
- delivery / outbox visibility for administrators
- failed-email recovery
- recovery states for failed payroll operations
- public and authenticated navigation QA

This gate is considered automated-product-ready, but the real-data pilot must still confirm that a payroll operator can complete a cycle without developer intervention.

### 6. Real-data payroll pilot — NOT TESTED

This is the biggest non-code proof still missing.

Before launch, run at least one fresh payroll using production-like or authorized real employee data and independently compare:

- gross pay
- overtime / premium pay
- absences and leave
- deductions
- withholding tax
- SSS employee / employer / EC
- PhilHealth employee / employer
- Pag-IBIG employee / employer
- 13th-month treatment
- retro adjustments if applicable
- final pay if applicable
- net pay
- bank payout total
- payslip values
- accounting export totals

The independent expected result must be prepared outside Linaw. Matching Linaw to a value derived by Linaw itself is not acceptable evidence.

### 7. Launch-day operations — BLOCKED

Source-level operational controls exist:

- readiness endpoint
- production rollout workflow
- CI and CodeQL
- Security HTTP Smoke
- live RBAC smoke
- email delivery dashboard
- payout reconciliation
- audit trail
- worker / scheduler implementation

But live operations are not green because the production readiness workflow currently fails.

Launch-day operations become PASS only when:

- production rollout readiness is green against the exact deployed commit
- five-role live sandbox smoke is green
- transactional email has proven delivery
- bank encryption is green
- production security configuration is green
- a real-data pilot is signed off

## Readiness checker correction

The rollout checker previously confirmed that the origin was healthy but did not prove that the Vercel alias was serving the exact GitHub commit under review. This can produce stale-deployment results.

The audit branch changes the gate to:

1. expose the deployed `VERCEL_GIT_COMMIT_SHA` through the sanitized readiness status
2. pass the current GitHub `github.sha` to the rollout job
3. wait until production reports the exact expected commit
4. only then evaluate launch gates
5. include all sanitized launch blocker keys in the artifact

A healthy old deployment can no longer be mistaken for proof of the new release.

## Launch sign-off rule

PayrollPH may be described as **launch ready** only when all of the following are true:

- current `main` CI passes
- CodeQL passes
- Security HTTP Smoke passes
- production rollout readiness passes against the exact deployed SHA
- live five-role RBAC smoke passes
- no pilot-critical readiness blocker remains
- the real-data payroll pilot passes independent reconciliation
- the operator completes the cycle without developer intervention

Until then, use **pre-launch / production pilot** rather than **launch ready**.


## Remediation order

Close the blockers in this sequence so later QA is not invalidated by basic production configuration failures.

### P0. Production secrets and bank-data encryption

1. Set a canonical HTTPS `APP_BASE_URL`.
2. Set a production `TOTP_ENCRYPTION_KEY`.
3. Set a separate 32-byte `BANK_DATA_ENCRYPTION_KEY`.
4. Apply `drizzle/0004_bank_account_envelope.sql`.
5. Run:
   - `npx tsx scripts/encrypt-bank-accounts.ts` as a dry run.
   - review the plaintext employee and payroll-snapshot counts.
   - `npx tsx scripts/encrypt-bank-accounts.ts --apply`.
6. Do not continue until the `bank-data-encryption` readiness gate is green.

This is the blocker currently preventing the Owner production sandbox from opening.

### P0. Transactional email proof

1. Configure one production provider, preferably the existing Resend integration.
2. Configure `MAIL_FROM` and `RESEND_WEBHOOK_SECRET`.
3. Send a real low-risk transactional message to an authorized test recipient.
4. Confirm a persisted successful delivery event in the outbox.
5. Exercise one failed delivery and failed-only retry during the controlled pilot.

The gate should remain red until production records a successful delivery. Credentials alone are not enough.

### P0. Malware scanner

1. Deploy `services/malware-scanner` on a host with at least 4 GiB RAM.
2. Configure a strong `SCANNER_TOKEN`.
3. Verify:
   - `/health` is healthy only after scanner self-test.
   - unauthenticated `/scan` returns 401.
   - an authenticated clean file succeeds.
   - EICAR is rejected.
4. Only then set `MALWARE_SCAN_URL` and `MALWARE_SCAN_TOKEN` in PayrollPH.

Keep document uploads fail-closed until all four checks pass.

### P1. Re-run live production gates

After the P0 items:

1. Production Rollout Readiness must pass against the exact deployed Git SHA.
2. Live RBAC Sandbox Smoke must pass for Owner, HR, Payroll Officer, Checker and Employee.
3. Run the fresh non-demo payroll pilot.
4. Record the first real email delivery proof and low-value payout proof.

### P1. Independent payroll reconciliation

Run a representative payroll set independently outside Linaw. At minimum include:

- ordinary monthly employee
- daily or hourly employee
- overtime and premium pay
- absence / unpaid leave
- mid-period hire or signed-off exception
- statutory contribution boundary cases
- withholding-tax boundary cases
- 13th-month treatment
- retro adjustment
- final-pay case

Store the independent expected figures with the pilot evidence. A Linaw-generated expected result does not count.

## Dependency cleanup status

PRs #52–#59 are no longer open. The selected safe updates were consolidated into the current dependency set while the risky standalone major bumps were closed rather than blindly merged.

Current CI still reports four **moderate** npm advisories and peer-resolution warnings because ESLint 10 is newer than the peer ranges declared by several packages bundled under `eslint-config-next`. CI explicitly blocks high and critical advisories and currently passes that gate.

This is a maintenance issue, not one of the four live pilot-critical blockers above, but it should be cleaned before broad GA if the upstream Next.js ESLint stack has not resolved the peer ranges by then.


## Hardening added after the initial audit

The remediation branch now closes two process gaps that the first audit exposed.

### Production document uploads are opt-in

Production no longer treats "scanner unavailable" as a reason to expose a half-working upload feature. Document uploads are disabled unless `DOCUMENT_UPLOADS_ENABLED=true`.

- With uploads disabled, the POST document route returns `DOCUMENT_UPLOADS_DISABLED` before parsing file content.
- The malware-safety gate is green while uploads are explicitly disabled.
- If uploads are enabled, a valid production malware scanner immediately becomes launch-blocking again.
- This lets the payroll pilot proceed without paying for a 4 GiB scanner host while keeping arbitrary file ingestion unavailable.

This does **not** claim malware scanning is complete. It removes the upload feature from the rollout until the scanner can be hosted safely.

### Independent production payroll sign-off is now a real gate

Full launch now requires an audit event named `Production payroll pilot signed off`.

The sign-off endpoint and Owner UI require all of the following:

- the exact payroll run is already Released
- a release receipt exists
- payout completion evidence exists
- every released entry has a payslip
- an accounting journal export exists
- the Owner has recent MFA
- the account is not a public demo identity
- independent expected figures were prepared outside Linaw
- gross pay, deductions, net pay, withholding tax, statutory contributions, payout total, payslip values, and accounting export totals were each confirmed to match
- the payroll operator confirms the cycle was completed without developer intervention
- an external evidence reference and independent preparer are recorded

This prevents a future green CI run from being treated as proof that a real payroll cycle has been independently reconciled.

### What code cannot honestly fix

These remain environment or real-world proof tasks:

- configure production `TOTP_ENCRYPTION_KEY`
- configure a dedicated `BANK_DATA_ENCRYPTION_KEY` and seal any legacy plaintext payout data
- prove at least one real transactional email delivery
- complete the controlled production payroll pilot and record the independent sign-off
- validate government filing outputs in the relevant official workflows before claiming filing-ready status

The connected Vercel account available in this ChatGPT session does not have authorization to the `payrollph` Vercel team, so production secrets cannot be changed or verified from this session. GitHub reports successful Vercel deployments, but that is not a substitute for inspecting the production environment itself.
