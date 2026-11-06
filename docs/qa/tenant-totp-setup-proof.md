# Authenticator setup: account-isolation acceptance

Scope: GET and POST `/api/auth/totp/setup`, fictional disposable PG16 and
production Next on localhost only. No runtime, default MFA, provider, schema or
coverage ledger changes. Both methods remain GAP; zero credits.

The runner requires an empty account database, two independently authenticated
attackers and a higher-ID victim with a genuinely enrolled factor. It tests
status without seed disclosure, forged user/session/employer selectors, wrong
password refusal, encrypted pending-seed persistence and rotation, invalid-code
refusal, successful own enrollment, hashed backup persistence, current-session
MFA verification, an unchanged second device, and refusal to restart enabled
enrollment. Victim factor, recovery codes, sessions, payroll and audit SQL must
remain identical. A victim-enabled status cannot satisfy the own-disabled proof.

**NOT_RUN:** real HTTP acceptance requires the dedicated CI job. Local syntax,
source/guard checks and lint do not substitute for execution. This does not
certify enrollment concurrency, recovery, SSO, production readiness or independent
review. Coverage promotion must follow separately reviewed executed evidence.

Source merge requires applicable current-head CI/security and maintainer diff
review under `docs/engineering/change-risk-policy.md`. Rollback: revert the
proof-only source addition; no migration, account mutation or deployed flag
change is authorized by merging it.
