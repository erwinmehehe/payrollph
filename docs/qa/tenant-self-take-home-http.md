# Tenant isolation candidate — employee take-home estimate GET

**Method:** GET /api/self/take-home-estimate

**Coverage baseline:** scripts/qa/tenant-isolation-coverage-manifest.json classifies this exact method as GAP with no linked own-object and victim-only denial proof. This branch does not change the manifest, a credit registry, a reservation ledger or the production endpoint. Its acceptance status remains **GAP / ZERO NEW CREDITS** until the exact-head automation and security review establish enough evidence.

## Independence from current open PRs

Before creating this branch on 2026-10-28, the 12 open PRs were examined, including invitation writes, careers publishing, ESS documents, benefits/HMO, employee development, automation-language scope, payroll overpayment, attendance offline claims, performance governance and ESS identifiers. No PR had the employee take-home estimate endpoint or any of the four dedicated test files in its changed-file list. A later main update was detected during preflight; the branch was created from the subsequently verified latest main head, not a guessed historical SHA. Recheck current open diffs and exact-head CI before merge.

## What is actually tested

The new dedicated GitHub Actions workflow provisions a **fresh, empty, disposable PostgreSQL 16** database named app_db on 127.0.0.1, applies the already-reviewed synthetic baseline, prepares the SQL-only HCM snapshot fixture, builds Next in production mode and runs a real localhost HTTP endpoint at 127.0.0.1:3000.

The runner first rejects any run lacking GitHub Actions/CI flags, a precise localhost database and app URL, production Node execution with demo OFF, and payout/billing/scheduler OFF. Live provider credentials are refused. This is only a fictional CI database. It is **not** Neon production, a real payroll run, or a Vercel hosted deployment.

It creates two genuine fictional employer/employee attacker accounts and a third higher-ID victim employer. Each has a real employee and explicit, distinct stored pay profile. Each employer also has a same-employer peer with a different saved salary and independently authenticated employee session.

Expected probes:

- Legitimate victim and both attackers must receive **nonempty, real** monthly salary baselines and computed take-home estimates matching their own persisted profiles.
- A legitimate same-employer peer must receive **their own** different rate, not the attacker's.
- A legitimate attacker supplies foreign employer, worker, user and legal-entity selectors, and separately supplies a same-employer peer ID. The API must ignore forged selectors and return only the signed-in employee's own pay. A foreign or peer rate, blank positive response, public cache directive or missing no-store fails.
- An anonymous user gets 401. A company Owner, an employee identity without an employee link, and an A-only employee identity forged to point at the real victim employee must all receive 403 without salary/estimate data.
- Revoking the attacking employee's employer membership while leaving the session cookie intact must deny further reads with 403.
- Exact persisted employee profiles, employee records, payroll rows and audit evidence must remain unchanged after reads. The real higher-ID victim's broader recovery snapshot must remain unchanged.
- The source-only checks reject insecure fixture/provider values, wrong/blank/wrong-person positives, cacheable output, leaky denial responses and source guard drift.

## Scope and no-go conditions

**Read-only security regression:** nothing creates or releases payroll, submits remittances, pays out money, sends provider mail, changes actual employer data, performs a protected schema migration or activates a production feature. The only worker and member writes are made when building fictional fixtures on disposable PG16; the membership revocation is also synthetic.

The response is a **what-if estimate**, not an official released payslip or a sign-off of current Philippine statutory rates. Passing this test does not establish a complete financial reconciliation, a customer UAT pass, or closure of another endpoint's GAP. This remains **one GET method**, and the source tests plus actual PG16 HTTP run must pass at the proposed PR's exact head before a reviewer can evaluate coverage.

**Review checklist:** compare current open PR changed files, run the new self-take-home workflow at the exact PR head, verify required CI + CodeQL/security checks, retain sanitized fictional test summaries, and keep the PR in draft until reviewed. Do not close any external acceptance gate or claim new tenant coverage automatically.
