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
