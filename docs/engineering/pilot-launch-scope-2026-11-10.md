# Pilot launch scope (maintainer decision, 2026-11-10)

**Decision (maintainer, 2026-11-10):** the first pilot excludes **SSO/SAML sign-in, Xendit payroll payouts and Automation Studio**.

This file records what that decision means in the code as read on `main` at `20bbe2b99` (source read only; nothing here was executed against a deployment). It is not a security acceptance and not a production authorization.

## Effect on the tenant-isolation ledger

22 API methods are GAP. 8 belong to the excluded features, 14 remain inside the pilot surface.

| Excluded feature | GAP methods | Is it actually off? |
| --- | --- | --- |
| SAML | `auth/saml/start` GET, `auth/saml/acs` POST, `auth/saml/metadata` GET | **Yes, in code.** `start` and `acs` always answer 503 `SAML_RUNTIME_NOT_READY`; enabling a SAML provider is refused in `enterprise` POST. |
| OIDC SSO | `auth/sso/start` GET, `auth/sso/callback` GET, `auth/sso/resolve` POST | **Only by configuration.** There is no SSO release flag. Sign-in needs an enabled `identity_providers` row with a verified domain, and creating one needs `ENTERPRISE_IDENTITY_ENCRYPTION_KEY`. Leave that variable **unset** and SSO cannot be configured (provider creation answers 503). |
| Xendit payroll payouts | `payroll-runs/[id]/xendit-payout` POST | **Yes, by default.** Needs `XENDIT_PAYOUTS_ENABLED=true`, `XENDIT_PAYOUTS_LIVE_APPROVED=true` and three Xendit secrets; all absent by default. |
| Automation Studio | `automation-studio` POST | **No. There is no off-switch.** Any workspace owner or admin with MFA can call it. Only natural-language drafting has a kill switch. See "Open item" below. |

GAP methods still inside the pilot surface (14): `approvals/[id]` PATCH, `billing` POST, `bir/annual-employer/candidate` POST, `compliance/filing-validations/[id]` PATCH, `hcm/work-items/escalate` POST, `intake-challenge` POST, `marketing/leads` GET, `payroll-runs/[id]/exports` POST, `readiness/workspace` GET, `setup` GET and POST, `signup` POST, `signup/resend` POST, `signup/verify` POST.

## Required pilot configuration

| Variable | Pilot value | Why |
| --- | --- | --- |
| `ENTERPRISE_IDENTITY_ENCRYPTION_KEY` | unset | Keeps OIDC SSO unconfigurable |
| `XENDIT_PAYOUTS_ENABLED`, `XENDIT_PAYOUTS_LIVE_APPROVED` | unset | Xendit salary payouts stay off |
| `PAYMONGO_DISBURSEMENTS_ENABLED` | unset | No PayMongo salary transfers |
| `PAYMONGO_SECRET_KEY` | unset | The legacy `billing` POST then answers 503 before writing anything (it has no payment webhook; see the AI review, finding 3) |
| `XENDIT_BILLING_ENABLED` | unset | No recurring billing in a free pilot |
| `PUBLIC_SIGNUP_MODE` | `pilot` | Creates free 14-day Core workspaces only |
| `PRIVATE_PILOT_INVITE_*` with email delivery off | recommended | Invite-only signup: an uninvited signup is refused before any row is created, which also removes the squatting risk in finding 1 |
| `SETUP_TOKEN` | set, secret | First-run setup refuses without it in production |
| `VERCEL=1` or `TRUSTED_PROXY_HOPS` | set correctly | Otherwise every visitor shares one rate-limit bucket (signup 4/hour, setup 5/hour for everyone) |
| `WORKER_ENABLED`, `CENTRAL_SCHEDULER_ENABLED` | maintainer's call | Saved automation rules run only through the worker |
| `FINAL_PAY_MANUAL_RELEASE_ENABLED` | unset | Unchanged from #1842 |

## Open item: Automation Studio cannot be excluded by configuration

"Pilot excludes Automation Studio" is a decision the code cannot enforce today. Options:

1. Add a kill switch that defaults to today's behavior (for example `AUTOMATION_STUDIO_DISABLED=true` answers 404). It changes the route file, so the route's pinned blob and any credit that pins it must be re-inventoried.
2. Leave it reachable in the pilot and prove `automation-studio` POST like any other in-scope method.
3. Hide it in the UI only. This is not a control: the API stays callable.

Not decided here.

## What this file is not

It does not accept any GAP, does not move any method to COVERED or PUBLIC-BY-DESIGN, and does not change `scripts/qa/tenant-isolation-coverage-manifest.json`. The excluded methods stay GAP in the ledger.

## Subsequent pilot SSO hold draft — November 12

The review candidate `fix/tenant-oidc-sso-runtime-hold-20261112` adds a typed
`OIDC_SSO_RUNTIME_ENABLED` exact-true runtime gate across SSO start, callback
and discovery. The first pilot must keep this **unset/OFF**. Unlike the earlier
workaround of withholding the enterprise identity encryption key, this is a
server-side route-level hold that also blocks previously configured providers.
The three methods retain GAP/zero-credit classifications; independently
accepted enabled-mode security and any production rollout are still pending.
See `docs/qa/tenant-oidc-sso-runtime-hold-20261112.md`. This does not override
the Automation Studio scope decision or other pilot release blockers.
