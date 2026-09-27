# Public Demo Funnel Patch

Implemented the website flow:

**Homepage → Try Live Demo → isolated sandbox → Create Account / Book Demo**

## What changed

- Added a one-click public demo launcher on `/welcome`.
- Added a persistent demo banner inside the bookkeeper and employee workspaces.
- Added `/signup` plus `POST /api/signup` for an isolated customer workspace and 14-day Core trial.
- Added `/book-demo`; set `NEXT_PUBLIC_BOOK_DEMO_URL` to the real scheduling URL.
- Demo role switching is visible only to demo sessions.
- Demo identities are restricted to the four fixed `Demo · ...` organizations.
- Older seeded demo organizations are migrated to the new clearly labeled names when safely identifiable.
- The old bug that could attach a demo account to every organization is repaired before a demo session is issued.
- Shared demo credentials can no longer be used through normal password login.
- Password-reset requests for fixed demo identities do not create reset tokens or send mail.
- Live billing, PayMongo payroll disbursement, invitations, API keys, webhooks, organization renaming, account changes, session revocation, and TOTP changes are blocked in demo sessions.
- Payroll release and approval interactions still work inside the sandbox, but outbound email/webhook side effects are suppressed.
- `/api/readiness` now treats the public sandbox as intentional and no longer recommends disabling demo mode. It also keeps a code-audit launch gate red until the unresolved real-payroll launch blockers are fixed.

## Production environment

At minimum:

```env
DATABASE_URL=postgresql://...
DEMO_MODE=true
APP_BASE_URL=https://your-domain.example
NEXT_PUBLIC_BOOK_DEMO_URL=https://your-scheduler.example/your-demo
```

Configure the existing mail and payment variables separately when those production integrations are ready.

For a brand-new database, enable `DEMO_MODE=true` before first boot so the demo dataset is seeded. If upgrading the original demo seed, the app migrates the known seeded demo organization names and repairs demo memberships. If demo mode is enabled on an unrelated existing customer database with no recognizable demo seed, the launcher fails closed rather than attaching itself to customer organizations.

## Verification performed here

- Parsed all 146 `src/**/*.ts` and `src/**/*.tsx` files with the TypeScript parser: **PASS**.
- Ran source-level demo-isolation and conversion assertions: **PASS**.
- Attempted `npm ci --prefer-offline --no-audit --no-fund`, but dependency installation timed out in this environment. A clean `npm test`, `npm run typecheck`, and `npm run build` must still be run in CI or a normal development machine before deployment.

## Important launch boundary

This patch makes the **public demo flow** safe to expose. It does **not** by itself clear the real-payroll launch blockers identified in the code audit: payroll period/scope integrity, role authorization, disbursement gating, statutory data, and government-export correctness still need their own fixes and reconciliation tests before processing customer payroll.
