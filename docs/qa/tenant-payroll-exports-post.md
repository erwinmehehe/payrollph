# Payroll exports POST tenant boundary proof

`POST payroll-runs/[id]/exports` has three modes, and until now none had an own-employer success linked to it:

| Mode | What it does |
| --- | --- |
| `preflight` | Checks PayMongo credentials, bank mappings and wallet funding for a released run. No transfer |
| `disburse` | Submits the released run's net pay as one PayMongo batch transfer |
| `complete-manual` | Records that a bank-file payout was completed outside the app |

The existing PayMongo isolation harness refuses foreign callers on this route but never runs an own POST. This proof (`scripts/qa/tenant-payroll-exports-post-http.mjs`, workflow `.github/workflows/tenant-payroll-exports-post-http.yml`) runs all three.

## No real provider, no real money

PayMongo is a synthetic server the proof hosts on `127.0.0.1:3012`. The app reaches it only through the existing `paymongo-http-proof-preload.mjs`, which rewrites the three registered PayMongo paths to loopback and refuses every other outbound request and every credential except `sk_test_synthetic_no_network`. The existing target guard refuses to start outside isolated CI with exactly those synthetic values and the dedicated disposable database. This proves the tenant boundary of the route. It says nothing about real PayMongo behavior.

## What it runs

Production-mode Next on localhost against a fresh disposable PostgreSQL 16. Two attacker employers, seven filler employers, then a victim created last, so the victim's organization, runs and worker IDs exceed both attackers' and six. Each employer has two released runs (one for the provider path, one for the manual path) and a draft run.

1. **Fixtures made the real way.** Each employer generates its final bank file over HTTP, and an accepted bank validation is recorded for it.
2. **Borrowed validation.** An extra employer with a real bank file but no accepted validation of its own is refused manual completion (409), although three other employers hold an accepted validation of the same shared template.
3. **Victim positive.** The victim runs its own preflight on its control run, proving the provider path is reachable.
4. **Refusals (80).** Each attacker's owner, second owner and employee are refused (403) on both victim runs in all three modes with forged own-employer selectors. Also refused: an own employee, an anonymous caller, a cross-site request, a malformed run ID, an unreleased run, a session without MFA, a disbursement without confirmation or before a passed preflight, and a manual completion with a short reference or no confirmation. No refusal reaches the synthetic provider, leaks a victim marker, or changes any employer's rows.
5. **Own journeys**, each carrying forged body selectors that name the victim:
   - preflight performs provider reads only and writes one own audit;
   - disbursement creates exactly one synthetic batch whose reference, amount, account and idempotency key are the own run's; a replay is refused and sends nothing; the provider-paid run cannot also be completed manually;
   - manual completion of the second run is bound to the real bank export and the employer's own accepted validation, never contacts the provider, and a replay returns the first recorded reference.

Every employer's rows in all organization-scoped payroll, payout, approval, audit, bank, treasury, employee, outbox and webhook tables are compared before and after. The whole proof creates exactly two synthetic batch transfers, one per attacker.

## Mutation evidence

Two rules of the real route were each broken, the app rebuilt and the proof run, then the file restored:

| Rule broken | Caught as |
| --- | --- |
| Authorization trusts the body's `organizationId` instead of the run's employer | An attacker's preflight of the victim's run succeeded (200, expected 403) |
| Accepted bank validation not bound to the run's employer | The borrower's manual completion succeeded (200, expected 409) |

## What it does not prove

- It is a proof, not a credit: `coverageCredits: 0`. The ledger keeps the method GAP.
- **Recorded finding it does not close.** The route loads the run by ID before authorizing, so a foreign run answers 403 while a missing run answers 404. A signed-in user of any employer can learn which run IDs exist. Nothing else about the run is disclosed.
- **Not exercised:** enterprise treasury separation (the policy is off, so the owner-only legacy rule applies), multi-entity confirmation, organization-unit scoping of this POST, an underfunded wallet, provider errors and timeouts, an Xendit claim on the run (the existing PayMongo harness covers that refusal), the rate limit, and concurrent submissions.
- Independent security review stays PENDING.
