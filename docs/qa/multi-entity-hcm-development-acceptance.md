# Multi-entity HCM: disposable development acceptance

This is a **developer-only test path**, not a bypass switch, a published test URL, a new HCM endpoint, or authorization to modify a real employee. The production application's `multiEntityHcmDeferred()` logic, HCM proxy/route HTTP 403 `ENTITY_HCM_DEFERRED`, and the scheduled-worker hold remain unchanged.

## Entry point

Use the existing GitHub Actions workflow **Multi-Entity Browser and HTTP Acceptance (Synthetic Only)** on this pull request. The PR-triggered workflow automatically runs on changes to deferred HCM services, People Inbox/Lifecycle components, and their browser tests. It executes with a fresh PostgreSQL 16 service on `127.0.0.1`, isolated fictional tenants and workers, fresh masked test encryption keys, and restricted localhost HTTPS. There is no production database or live payroll connector.

The development acceptance steps run in order:

- Disposable PostgreSQL schema creation and seeded legal employers, fake HR roles and workers.
- Actual employer-scoped HCM **read service** regressions: A1 and A2 worklists, foreign tenant ID denial, missing/invalid employer scope denial, legacy single-employer read compatibility, and linked HCM records.
- Actual effective-change worker/scheduler *hold* regressions: even a scheduled synthetic change is not mutated when the multi-entity flag is ON. This is intentionally **not** a successful effective-change execution.
- React StrictMode + intercepted-fetch browser QA for People Inbox and lifecycle panels: employer 101 to 102 switch, ignored late 101 response, wrong-employer echoed ID rejection, missing legal employer no-fetch, refreshed data cleared pending reauthorization.
- Real authenticated multi-entity UI and HTTP acceptance: selected legal employer scope, tenant and role separation, responsive widths, and `403 ENTITY_HCM_DEFERRED` on protected HCM endpoints in the actual flag-ON Next.js instance. A separate flag-OFF instance proves legacy HCM is not accidentally blocked.

## Development evidence and boundaries

- A successful workflow is evidence of **source, synthetic browser, role/tenant separation and disposable database readiness**. Use the *same exact commit* for full CI, CodeQL, HCM Request Lifecycle Browser QA, and ESS profile browser acceptance.
- No HCM runtime bypass is introduced: turning `MULTI_ENTITY_ENABLED=true` in a deployed environment still deliberately blocks protected HCM routes. The synthetic browser fixture can demonstrate intended UI behavior because it supplies fictional mocked responses; it does **not** prove a live route accepted requests.
- These checks cannot certify actual legal-employer changes, historical transfer maker-checker decisions, private HR operations, production PostgreSQL migrations, real object storage, physical-device UAT, payroll payouts or employee data handling.
- Never point the acceptance scripts at Neon, Vercel production, remote hosts or actual employee records. The workflow fails closed on unapproved host/database parameters. Keep all production `MULTI_ENTITY_*` flags OFF until an independently authorized deployment decision.

## Diagnostics

If full CI fails, inspect the failing regression shard's first `not ok` subtest. An obsolete test that expects organization-only HCM request cache identity must be updated to require **organization plus selected legal employer** rather than restoring a weaker implementation.

The separate ESS profile browser workflow checks HR navigation after a real synthetic login. It now retries a read-only People tab click only if the transition did not occur after server-rendered HTML was returned; a failure still reports the route and workspace state instead of silently skipping HR verification.
