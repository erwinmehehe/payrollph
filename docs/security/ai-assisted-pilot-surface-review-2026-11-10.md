# AI-assisted review of the pilot's unproven API surface (2026-11-10)

**What this is:** a source read by an AI assistant (Claude) of the 14 API methods that are still GAP and inside the pilot scope (`docs/engineering/pilot-launch-scope-2026-11-10.md`).

**What this is not:** it is **not an independent review** (the same assistant wrote several of this repository's proofs and credits), **not a human review**, not a penetration test, and it executed nothing. `independentSecurityReview` stays **PENDING** everywhere. No ledger status changes because of this file.

**Read:** `setup`, `intake-challenge`, `signup`, `signup/resend`, `signup/verify`, `marketing/leads`, `readiness/workspace`, `hcm/work-items/escalate`, `billing` POST, `compliance/filing-validations/[id]` PATCH (authorization half), `payroll-runs/[id]/exports` POST (authorization half), `bir/annual-employer/candidate` POST, and the access helpers they call. `approvals/[id]` PATCH (876 lines) was only checked for employer-scoped `where` clauses on its writes, not read line by line.

**Not read:** the 450 COVERED methods, pages and server components, database roles, session handling, dependencies, infrastructure.

## Result

**No cross-tenant read or write was found** in the routes read. Every route that takes an employer selector checks membership and role for that employer before reading or writing, and every write seen in `approvals/[id]` is scoped to the task's employer.

Nine findings follow. None is a confirmed tenant leak. Each is from reading source; none was reproduced.

| # | Severity | Finding |
| --- | --- | --- |
| 1 | Medium | An unverified signup permanently squats an email address, with the squatter's password |
| 2 | Low | Signup reveals whether an email is already registered |
| 3 | Medium (money, not isolation) | Legacy PayMongo billing checkout has no payment webhook |
| 4 | Low | Invoice numbers repeat and are not unique |
| 5 | Low | Payroll-run IDs can be probed for existence |
| 6 | Scope | Automation Studio has no off-switch |
| 7 | Scope | OIDC SSO has no release flag |
| 8 | Configuration | Rate limits collapse to one shared bucket if the proxy setting is missing |
| 9 | Info | `setup` GET tells anyone whether the instance is uninitialized |

### 1. Unverified signup squats an email (Medium)

`src/app/api/signup/route.ts`: a signup creates an organization and an **inactive** owner with the submitted password, then emails a link. If the email already exists, the route answers a generic 202 and sends nothing. Nothing deletes or replaces an unverified registration, and `signup/resend` only re-sends the link for the original record.

So anyone who signs up with someone else's email first causes this: the real owner gets one unexpected verification email. If they ignore it, they can never register that address. If they click it, the account activates **with the squatter's password**, and the squatter can sign in.

Suggested fix: when a signup arrives for an owner that is still inactive and unverified, replace the name, company and password hash and issue a new token; and expire unverified workspaces after a day. Pilot mitigation: run invite-only with email delivery off. An uninvited signup is then refused with 422 before any row is created.

### 2. Signup reveals registered emails (Low)

Same file. An existing email gets `"If the address is eligible, check your inbox…"`; a new one gets `"Check your email to verify your account…"` plus a `delivery` field. The password hash is also computed only for a new email, so timing differs. The route clearly intends not to reveal this (its unique-violation path returns the generic text). Bounded by 4 requests an hour per IP and 3 a day per email. Suggested fix: return one identical body for both.

### 3. Legacy PayMongo billing checkout has no payment webhook (Medium, money)

`src/app/api/billing/route.ts` POST creates an open invoice, creates a PayMongo checkout, and sets the subscription to `pending_payment`, saying the plan "activates only after PayMongo confirms payment by webhook". The only PayMongo webhook in `src/app/api/webhooks/paymongo/` is `transfers` (salary transfers). No handler marks that invoice paid or activates the plan. A customer could pay and never be activated, and a trialing pilot subscription is switched to `pending_payment` by one click.

Not a tenant-isolation issue: the route checks billing-admin role, company-wide access and MFA for the selected employer before anything else. Pilot mitigation: leave `PAYMONGO_SECRET_KEY` unset; the route then answers 503 before writing. The recurring Xendit path is the maintained one.

### 4. Invoice numbers repeat (Low)

Same route: `INV-<year>-<last 7 digits of the millisecond clock>`. That value repeats every 2 hours 47 minutes, and the `invoices` table definition has no unique constraint on `number`. Two employers can get the same number. Harmless while nothing looks an invoice up by number; a risk if a future webhook does.

### 5. Payroll-run IDs can be probed (Low)

`src/app/api/payroll-runs/[id]/exports/route.ts` POST loads the run by ID before checking membership. A run that does not exist answers 404; another employer's run answers 403. Any signed-in user can tell which run IDs exist. `approvals/[id]` deliberately avoids this ("a foreign task is identical to a nonexistent ID"), and the merged transfers proof asserts it. `xendit-payout` has the same pattern. IDs are sequential, so the disclosure is small. Suggested fix: answer 404 for non-members.

### 6 and 7. Scope controls

Automation Studio has no off-switch and OIDC SSO has no release flag; details and options are in the pilot scope file. SAML is hard-blocked in code.

### 8. Shared rate-limit bucket (Configuration)

`clientIp` trusts forwarded headers only when `VERCEL=1` or `TRUSTED_PROXY_HOPS` is set; otherwise every caller is one "unverified" client. That is safe against spoofing, but it turns per-IP limits into global ones: 4 signups an hour and 5 setup attempts an hour for the whole internet.

### 9. `setup` GET (Info)

Returns `needsSetup` to anyone. `setup` POST is protected by `SETUP_TOKEN` in production, a zero-users check and an advisory lock, so this only reveals that an instance is fresh.

## Routes with nothing to report

`intake-challenge` (same-origin, flag, two rate limits, no employer data), `signup/verify` (single-use hashed 192-bit token, owner-only activation), `marketing/leads` (operator allowlist plus MFA, aggregate only, window clamped to 1-365 days), `readiness/workspace` (always refuses after authorization), `hcm/work-items/escalate` (constant-time worker secret; every insert carries the case's own employer), `filing-validations/[id]` PATCH and `bir/annual-employer/candidate` POST (employer, role, MFA, legal-employer and unit checks before the record is used).

## Suggested order

1 (fix or run invite-only), 3 (keep the key unset, then remove or finish the legacy path), 6 (decide), then 2, 5, 4.
