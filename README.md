# Linaw: Philippine HR & Payroll Workspace

Linaw is a database-backed multi-client Philippine HRIS and payroll workspace. Complexity is opt-in: freelancers and small teams stay simple, while bookkeepers and multi-branch companies can use org hierarchy, scoped payroll, approvals, and exports.

## What is implemented

### Core platform
- PostgreSQL + Drizzle data model for organizations, org units, employees, time punches, payroll runs/entries/jobs, payslips, pricing, bank templates, calamity advisories, approvals, users, sessions, reset tokens, and audit events
- Idempotent demo seed with a bookkeeper managing multiple client businesses plus a self-employed profile
- Multi-client workspace UI with progressive disclosure and Linaw design language

### Authentication & security (request-path enforced)
- scrypt password hashing with timing-safe verification
- Account lockout after repeated failed logins
- Real TOTP second factor (RFC 6238-style HOTP/SHA1) inserted **between password success and session creation**
- Backup codes
- Server-side revocable sessions (hashed tokens in `sessions`)
- Forgot/reset password with hashed, time-limited tokens
- In-memory per-IP sliding-window rate limiting on `/api/auth/*`
  - UI/docs explicitly say: **single-instance, not yet distributed**
- Demo account: `celine@linaw.ph` / `LinawDemo2026!`
  - After password success, the login API returns a development-only current TOTP code so the second factor can be completed in this sandbox without a physical authenticator

### Payroll processing
- Semi-monthly run model
- Background-style job queue using Postgres `FOR UPDATE SKIP LOCKED`
- Chunked, resumable, idempotent calculation per run
- Clock-derived hours from raw punches (tardiness, undertime, OT, night differential, incomplete punch = zero + exception)
- Statutory deductions via tested formulas
- Active calamity/hazard advisory premiums applied during calculation and traced to the DOLE advisory number in payslip notes
- Payslip artifacts generated per employee entry

### Exports
- Bank templates as versioned data with generators:
  - BDO DAT
  - BPI / UnionBank CSV
  - GCash disbursement CSV
- Bank dry-run validation before live-looking file output
- Xero/QBO journal CSV
- Government worksheet **drafts**: 1601-C, Alphalist/2316 summary, SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF
- Full company data portability export

### Approval delegation (enforced)
- `approval_delegations` table with date-bounded, revocable proxies
- Server-side permission check: a decision from anyone outside the approver/delegate chain returns **403**
- Delegate decisions record `decidedBy` + `decidedOnBehalfOf` and the full delegation chain in the audit trail
- Cycle-safe resolution (max depth 3)

### Public API & webhooks
- `GET /api/v1`: self-describing API reference (auth, scopes, rate limit, events, explicit not-implemented list)
- `GET /api/v1/employees` and `GET /api/v1/payroll-runs`: API-key auth, scope checks, `limit`/`offset` pagination
- API keys stored as SHA-256 hashes, shown once, prefix-identified, revocable
- Webhook endpoints with generated signing secrets
- HMAC-SHA256 signed deliveries: `Linaw-Signature: t=<unix>,v1=<hex>` with 300s replay tolerance
- Every delivery attempt logged with real response code or error

### Report builder
- Real aggregate SQL for headcount, payroll cost, turnover, and compliance exceptions
- Paginated result table in-app, CSV export for Excel/BI, audit-logged

### Benchmarks (measured, not assumed)
Run on the sandbox Postgres instance via `npx tsx scripts/benchmark.ts`:

| Employees | Chunk size | Chunks | Process time | Per employee | Throughput |
|-----------|-----------|--------|--------------|--------------|------------|
| 50 | 250 | 1 | 124 ms | 2.48 ms | 403/sec |
| 500 | 250 | 2 | 988 ms | 1.98 ms | 506/sec |
| 3,000 | 250 | 12 | 5,709 ms | 1.90 ms | 526/sec |
| 8,000 | 500 | 16 | 13,254 ms | 1.66 ms | 604/sec |

Throughput holds (and slightly improves) as headcount grows. The queue chunks work rather than
processing one oversized transaction, so an 8,000-employee run completes in ~13 seconds without timing out.

### Out of demo mode
- **No credentials are seeded.** Demo data (including the shared `celine@linaw.ph` account) is created only when `DEMO_MODE=true`.
- A production instance boots empty and goes through `/setup`, which creates the organization and its owner with a policy-checked password.
- Setup refuses to run once any user exists (409), so the wizard cannot be used to hijack a live workspace.
- Weak passwords are rejected server-side with per-rule messages (12+ chars, upper, lower, digit).

**Demo credentials for this sandbox** (set `DEMO_MODE=true`): `celine@linaw.ph` / `LinawDemo2026!`, TOTP from the login response's `demoTotpCode`.

### Password reset no longer leaks tokens
- Reset and invitation tokens are stored as SHA-256 hashes and sent by email only.
- With no mail provider configured the message is **queued in the outbox**, not returned in the HTTP response.
- Completing a reset revokes every active session for that user.

### Transactional email (outbox)
- `outbox` table + provider adapter for Resend / Postmark / SMTP.
- With no provider, rows stay `queued` and `GET /api/outbox` shows them honestly: nothing is reported as sent.
- Set `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, or `SMTP_URL` to enable real delivery.
- Resend sends are tagged with the Linaw app + durable outbox id so provider events can be reconciled to the exact message.
- For Resend, register `<APP_BASE_URL>/api/webhooks/resend` for delivered, delayed, bounced, complained, failed, and suppressed events, then set its signing secret as `RESEND_WEBHOOK_SECRET`.
- The Resend webhook verifies the raw Svix signature and timestamp before processing; unrelated or untagged account events are ignored.
- Outbox send status and provider-confirmed delivery status are separate: provider acceptance is not displayed as confirmed delivery.

### Document storage
- `POST /api/documents` content-sniffs magic bytes (PDF/PNG/JPEG); the declared browser MIME type is never trusted.
- Disguised executables are rejected with 422. 5 MB cap. Filenames are sanitized against traversal.
- Uploads call an authenticated malware scanner through `MALWARE_SCAN_URL`; production fails closed on scanner timeout, outage, malformed response, or detected malware.
- A deployable ClamAV scanner service lives in `services/malware-scanner`.
- Currently stored in Postgres; swap the column write for an S3/R2 PUT before production volume.

### Embedded benefits administration
- `benefit_plans` + `benefit_enrollments`; the PH catalogue seeds one click (HMO, group life, Pag-IBIG MP2, SSS Flexi-Fund, rice allowance)
- Enrolments deduct automatically on the next calculated run as `BEN-<planId>` lines with their basis printed on the payslip
- Voluntary savings respect legal caps: an over-cap contribution is rejected with a specific reason, never silently clamped away
- Employer share is tracked separately as cost, never deducted from the employee
- **This was caught being decorative:** the first wiring accepted `benefits` in the calculation but the engine never queried the tables, so a run produced no `BEN-` line. `tests/benefits-wiring.test.ts` now fails the build if the engine stops loading enrolments.

### Public capability scorecard
- `/scorecard` and `GET /api/capabilities` render a 22-row competitive parity grid plus a 15-row capability matrix
- Every Linaw claim is classified **verified / partial / absent** and carries its evidence (a file path, a test name, or a live row count), generated from this deployment's code and database
- Competitor columns are explicitly labelled as our reading of public positioning, **not** independently verified
- The honest-status block states that the four remaining gaps are all blocked on external access, not code

### Tenant isolation (fixed a systemic IDOR)
- Before this pass, most session routes trusted `organizationId` from the query string or request body.
  Any signed-in user could substitute another tenant's id and read their payroll, export their data,
  or invite users into their workspace.
- Every session-authenticated route now calls one shared gate, `assertMembership(userId, organizationId)`
  in `src/lib/access.ts`, which returns **403** unless the user is a member of that workspace.
- Routes addressed by a resource id (`/api/payroll-runs/[id]/process`, `/release`, `/exports`,
  approvals, delegations, provisioning, data requests) resolve the resource's own organization and
  check against that. The URL id is never treated as authorization.
- The self-service link no longer accepts `organizationId` from the body at all; it resolves the
  caller's own memberships and constrains the employee lookup with `IN (…)`.
- Verified with a user scoped to a single workspace: **17/17 cross-tenant attempts return 403**,
  including job-status, process, release, and exports on a foreign run; own-workspace access still returns 200.
- `tests/tenancy.test.ts` fails the build if any session route drops the gate.

### Employee self-service portal
- A session with `role="employee"` is linked to exactly one employee record and lands on a personal portal
- Every query filters by `session.employeeId`, never a client parameter, so a colleague's payslip is unreachable (404, not 403, to avoid confirming existence)
- Shows YTD gross/net/tax, per-period line items, and a downloadable PDF payslip
- Linking is blocked for `admin`/`bookkeeper` accounts (409). This guard exists because linking an admin used to demote them to `employee` and lock them out of their own workspace

### CSV bulk import
- Accepts a customer's existing spreadsheet: column order and extra columns are tolerated and reported
- Quoted fields, doubled quotes, currency symbols (`₱ 28,000.00`) and thousands separators parse correctly
- Row-level errors are specific (`monthlyBasic "notanumber" is not a number`), and valid rows still import
- Re-uploading the same roster updates in place by `employeeNo` instead of creating duplicates
- Enforces the plan gate first, then the seat limit; every import is batched and audited
- `?template` download gives a 3-row starter file

### Billing & plan gating (enforced)
- `subscriptions` + `invoices` tables; every organization gets a row on first boot (14-day Core trial, Enterprise active)
- `getEntitlements()` is read on the request path; `requireFeature()` returns **402**, not a UI hint
- Payment state is checked **before** plan features. A cancelled/past-due workspace is blocked even for features its plan includes (a test caught this ordering bug after it shipped)
- Seat limits enforced at import and employee creation
- A billing provider only needs to write to `subscriptions`; entitlements follow automatically

### Data Privacy Act data-subject requests
- `data_requests` with access/correction/deletion/portability/objection types
- Every request gets a 30-day statutory due date, overdue flagging, and audit coverage

### Dependency-free PDF payslips
- `src/lib/payslip-pdf.ts` writes valid PDF 1.4 with a hand-built xref table, no PDF library
- Tested for structural validity (offsets point at the right objects), WinAnsi sanitization, string escaping, and note wrapping

### Auth pages are real routes (was broken)
- `/reset-password?token=…` and `/invite?token=…` now exist: both email templates previously linked to pages that did not exist.
- Invitation acceptance verifies the token, shows the invited email/role, creates the account, and blocks reuse (400).
- Reset requires the outbox token, enforces the password policy, and revokes all sessions.

### Login page no longer leaks credentials
- The login form previously shipped **pre-filled** with `celine@linaw.ph` / `LinawDemo2026!` and rendered them on screen.
- Credentials are now empty by default and the demo hint renders only when `DEMO_MODE=true`.
- The stale "rate limit: single-instance" claim was corrected. Limiting is Postgres-distributed.
- `tests/auth-surface.test.ts` asserts none of this regresses.

### Payslip-ready email on release
- Releasing a run queues a "your payslip is ready" message for every active employee with an email on file.
- Employees now have an optional `email` column; the public API accepts it on create and patch.

### Launch readiness probe
- `GET /api/readiness` reports each gate with `blocks: launch | scale | none` and a plain-language detail string.
- Verdict is computed from real config, never asserted.

### Leave (real, not decorative)
- `leave_requests` table; submitting a request creates an approval task
- Approving the task updates the leave row and fires `leave.approved`
- Workspace leave page reads/writes this table

### Onboarding / offboarding checklists
- Lifecycle tasks are generated per employee (IDs, bank, laptop, email, HMO)
- Separating employees automatically receive an offboarding checklist
- Completing an item is audit-logged via `PATCH /api/provisioning`

### Department-scoped RBAC
- `user_organizations.org_unit_id` is null for company-wide access
- Dashboard employee queries filter by the caller's unit when scoped
- The people directory states the restriction instead of pretending the user sees everyone

### Regional minimum wage + holiday stacking in payroll
- DOLE wage orders (NCR WO-NCR-26 ₱695/day, effective 18 July 2025, and selected regions) live in `src/lib/wage-orders.ts`
- A rate below the regional floor is treated as MWE for tax exemption cascading
- Punch dates matching 2026 national holidays (plus a demo 11 Mar special day) apply the holiday multiplier matrix as a HOLIDAY line item

### Progressive disclosure
- Freelancer accounts hide People, Payroll, Time, Leave, Approvals and Developer nav

### SMTP delivery was a false-ready gate (fixed)
- `activeMailProvider()`/`deliveryCapable()` recognized `SMTP_URL` and `/api/readiness` reported the
  gate as satisfiable, but `deliver()` had no `"smtp"` branch. Every SMTP send returned
  `"Provider smtp is not implemented."` while the UI/API implied it was wired.
- `src/lib/mailer.ts` now sends via `nodemailer` for the SMTP path, same outbox/error recording as
  Resend/Postmark. `tests/mailer-smtp.test.ts` asserts the delivery attempt is real (fails on an
  unroutable host with an `SMTP:`-prefixed connection error) rather than the old stub message, so this
  can't silently regress.

### Government filing wasn't "accreditation-blocked": it was mislabeled
- BIR and SSS publish their file layouts and give away free validation tools (ADES,
  R3 File Generator) for standard filing; no vendor accreditation is required the way
  an earlier pass through this README implied. The real gap is that our DRAFT exports
  aren't yet byte-identical to BIR's ADES-importable `.DAT` layout (needs a middle-name
  field this schema doesn't have, plus the exact field-position spec).
- `/api/readiness` now exposes one gate per agency (`gov-bir-alphalist`, `gov-sss-r3`,
  `gov-philhealth-rf1`, `gov-pagibig-mcrf`) instead of one aggregate gate, each set by a
  human confirming that run's output actually validated in the agency's own free tool.
- `generateGovernmentDraft`'s Alphalist branch now splits the TIN into BIR's documented
  9-digit-TIN + branch-code convention. The one part of the real layout safe to fix
  without the full spec in hand. `tests/government-draft-tin.test.ts` covers it.
- Checked the other two: PhilHealth also has a file-based path (an "RF-1 Excel Format"
  template, submitted as a textfile via EPRS or a bank upload facility), not yet built
  since the exact column layout isn't confirmed. Pag-IBIG's MCRF, unlike the other three,
  has no confirmed published batch-file spec. Other PH payroll tools only seem to
  produce a filled PDF for it, so it stays honestly listed as portal data entry.

### PayMongo Disbursements as a bank-submission path (added)
- `src/lib/paymongo-disbursements.ts` submits payroll as a PayMongo batch transfer
  (Transfers V2: their older Wallet V1 API was already decommissioned by BSP-mandated
  deadline) via the same `PAYMONGO_SECRET_KEY` already used for billing. Bank BICs are
  always resolved against PayMongo's live receiving-institutions list, never hardcoded,
  since a wrong code would misroute real payroll money. `POST /api/payroll-runs/[id]/exports`
  triggers it, gated to owner/admin/bookkeeper and to `PAYMONGO_DISBURSEMENTS_ENABLED=true`.

### SSS R-3 draft was under-reporting EC and half-reporting SSS (fixed)
- Cross-checked `payroll-rules.ts` against an independent PH payroll reference package
  (`@ph-dev-utils/payroll`, MIT) and found the SSS R-3 exporter had a hardcoded EC of
  ₱10.00 for every employee. Correct EC is ₱30 once MSC reaches ₱15,000, which is most
  employees earning above roughly ₱15,000/month. It also read SSS from a single payroll
  run's line item, which is only half the monthly amount by design (the engine splits SSS
  evenly across the two semi-monthly cutoffs), but SSS R-3 is a monthly filing.
- `generateGovernmentDraft`'s `sss-r3` branch now recomputes full monthly figures from
  `computeSss()` directly (single source of truth, shared with actual payroll calculation)
  and reports the regular-vs-MPF sub-account split SSS's own R-3/R-5 forms expect for MSC
  above ₱20,000. `tests/sss-r3-draft.test.ts` covers both fixes.
- The core SSS/PhilHealth/Pag-IBIG math itself checked out correctly against the reference
  package. This was an export/reporting bug, not a payroll calculation bug.

### Status page + opportunistic scheduler
- `/status` and `GET /api/status` show real `/api/health` snapshot history
- Health checks also tick the webhook retry drain if ≥30s have elapsed
- Honest copy: this is not a third-party status-page vendor and not a dedicated cron

### Public API writes
- `PATCH` / `DELETE /api/v1/employees/:id`: delete is a soft offboard (status=Separating + checklist), payroll history is retained

### CI
- `.github/workflows/ci.yml` runs `tsc --noEmit`, the unit tests, and `next build`

### Year-end annualization (BIR 2316)
- Aggregates every **released** run for the tax year per employee
- 13th month / other benefits exempt up to **PHP 90,000**, excess becomes taxable
- Subtracts employee-share SSS / PhilHealth / Pag-IBIG, applies TRAIN annual brackets
- Compares tax due vs tax withheld: **refund**, **collect**, or **balanced**
- MWE is fully exempt: tax due is zero and anything withheld in error is refunded
- `POST /api/year-end` computes and stores adjustments (idempotent per org + year)
- `GET /api/year-end?format=2316` renders a per-employee certificate; `format=alphalist` exports the CSV
- Both outputs are explicitly labelled DRAFT: not validated against the BIR Alphalist module

### Webhook retry with exponential backoff
- Backoff schedule: **1m → 5m → 25m → 125m**, max 5 attempts, then `exhausted`
- `POST /api/webhooks/drain` claims due retries with `FOR UPDATE SKIP LOCKED` so concurrent workers never double-send
- Every attempt records `attempts`, `responseCode`/`error`, and `nextAttemptAt`

### Distributed rate limiting
- Postgres fixed-window counter keyed on `(bucket_key, window_start)` with a unique index, so the limit is **shared across app instances**
- Atomic `INSERT ... ON CONFLICT DO UPDATE` increments serialize concurrent requests
- Falls back to the per-process sliding window if the database is unreachable (never fails open silently)
- Applied to all `/api/auth/*` endpoints and the public API

### API write endpoints + idempotency
- `POST /api/v1/employees` with `employees:write` scope, field validation (422 on bad input)
- `Idempotency-Key` header: replaying a key returns the original response with `Idempotent-Replay: true` instead of creating a duplicate
- Emits the `employee.onboarded` webhook and writes an audit event attributed to the API key

### Tests
- Payroll rules: SSS, PhilHealth, Pag-IBIG, TRAIN tax, MWE, holiday stacking, clock derivation
- Security: password hashing, TOTP window verification, rate limiter
- Integrations: webhook signing/verification/replay window, API key hashing + scopes, CSV escaping
- Annualization: 90k 13th-month cap, refund/collect/balanced outcomes, MWE exemption, 2316 draft rendering, retry backoff schedule
- Wage orders: NCR floor, holiday recognition, special-day 1.3× multiplier

```bash
npx tsx --test tests/payroll-rules.test.ts tests/security.test.ts tests/integrations.test.ts tests/annualization.test.ts tests/wage-orders.test.ts tests/csv-import.test.ts tests/billing.test.ts tests/payslip-pdf.test.ts tests/self-service.test.ts tests/tenancy.test.ts
```

### Interface redesign (public site + authenticated workspace)
- One design system in `src/app/globals.css`: white sidebar and light canvas, Inter for UI and
  **JetBrains Mono for data**, every amount, employee number, rule code, trace line and API string is
  set in mono with tabular figures so a register stays scannable.
- Accent semantics are fixed and never decorative: green = released/verified, blue = in progress,
  amber = needs a decision, red = exception, purple = delegated or simulated.
- Every navigation destination carries its own icon hue (green, blue, amber, red, purple, cyan, teal,
  pink, slate) so a row is recognisable by colour before the label is read. The tint sits on the icon
  chip only, so the list still reads as one clean column of text.
- The same palette runs through every icon in the product, not just the sidebar. `.i-green`,
  `.i-blue`, `.i-amber`, `.i-red`, `.i-purple`, `.i-cyan`, `.i-teal`, `.i-pink` and `.i-slate` in
  `globals.css` set colour and nothing else, so they can be dropped straight onto a lucide icon
  (which forwards `className` to its `<svg>`). The hue follows meaning rather than position: money and
  verified outcomes green, documents and exports teal, people purple, time cyan, review and security
  gates amber, exceptions red, messages pink, platform surfaces blue.
- Pure affordances (chevrons, arrows, menu and panel toggles) stay neutral on purpose. They are
  controls rather than subjects, and colouring them competes with the content.
- Icons sitting on a solid fill (primary buttons, toasts, the active sidebar row) fall back to
  `currentColor`, so the container keeps control of contrast.
- No em-dashes anywhere in the interface copy.
- Workspace shell (`src/components/workspace/shell.tsx`): collapsible sidebar with a rail mode, mobile
  drawer, contextual top bar, breadcrumbs, current-client indicator, and a notification tray built from
  real rows (pending approvals, run exceptions, open checklist items, active advisories).
- Command palette on Cmd/Ctrl+K (`command-palette.tsx`): pages, client switching, people lookup and the
  actions the current role can actually trigger. It offers nothing the server would refuse.
- The payroll run is the focal workflow (`payroll-run.tsx`): gross → deductions → net, queue progress,
  an entry-status bar, exceptions listed with their engine flags, a searchable register whose rows expand
  into the stored line items and trace, and **prepare / approve / release / export as four separate,
  separately-authorised stages**. Release opens a confirmation that requires explicit acknowledgement
  when exceptions exist, the server enforces the same rule and its 409 is surfaced verbatim.
- Redesigned People, Time & attendance, Approvals, Analytics and a new Exports hub. The old Time page
  rendered hardcoded names and percentages; it now derives everything from stored punches.
- Charts are hand-built SVG (no chart dependency) and only ever plot stored rows. Loading, empty, error
  and success states exist for every async view.
- Reduced-motion support is global, focus-visible outlines are global, and the layout is responsive down
  to 375px with no horizontal scroll.

### Public site
- `/welcome`, a focused landing page: a full-width console composition in the hero, then a **playable
  workspace preview** below it. The preview is labelled a simulation everywhere it appears and persists
  nothing, but its SSS / PhilHealth / Pag-IBIG / withholding figures call `src/lib/payroll-rules.ts`
  directly, so the arithmetic is the product's own.
- The statutory slider, pricing table and capability grid all read real sources: `payroll-rules.ts`,
  the `pricing_plans` table, and `buildCapabilityReport()`. Verified / partial / absent is carried
  through with each row's evidence, and government worksheets are labelled DRAFT throughout.
- `/signup`, the real account path. An empty instance renders first-run setup; once an owner exists it
  says so plainly (setup returns 409) and points at the demo, sign-in and book-a-demo routes instead of
  showing a form that would fail.
- `/book-demo` + `POST /api/demo-requests`, rate-limited intake that writes to the same `outbox` table
  as every other message, addressed to an operator inbox rather than an address the visitor typed. With
  no mail provider configured the success state says the request is **queued, not sent**.

## Deliberately not built yet

- CDN/edge rate limiting (Postgres-distributed, not Cloudflare/nginx)
- Email provider credentials (Resend/Postmark/SMTP): outbox queues instead of sending
- Object storage (S3/R2): uploads persist in Postgres with content validation
- SSO / SAML identity provider integration
- Mandatory MFA for every role (TOTP is available and enforced for the demo account, not org-wide policy)
- Email/SMS delivery providers (Resend/Postmark/Semaphore/Infobip)
- Object storage migration for production document volume
- Subscription billing (PayMongo/Maya/Stripe)
- Live bank host-to-host / InstaPay / PESONet submission
- Certified government portal validation: BIR 2316 and Alphalist outputs are generated but labelled DRAFT
- OAuth client credentials
- Dedicated worker/cron process (webhook drain is opportunistic via /api/health)
- SOC 2 report

## Local development

1. Set `DATABASE_URL` in `.env`
2. Fresh schema: `npm run db:push`, then confirm it created 55 tables. See
   `drizzle/README.md` if it creates nothing.
3. `npm run dev`
4. Sign in with the demo account and complete the TOTP step

## Deploying

`src/db/index.ts` throws when `DATABASE_URL` is missing, and `next build`
imports every route module to collect page data, so a deploy with no database
URL configured fails the build rather than starting without one:

```
Collecting page data ...
Error: DATABASE_URL is required
Error: Failed to collect page data for /api/auth/reset-password
```

Set the environment variables before the first deploy, not after:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Postgres connection string, required |
| `APP_BASE_URL` | the deployment's own URL, used in email links |
| `DEMO_MODE` | `false` for anything reachable publicly |
| `WORKER_TOKEN` | strong random server-to-server secret |
| `READINESS_TOKEN` | strong random secret for production readiness diagnostics |
| `SETUP_TOKEN` | strong random first-run bootstrap secret |
| `TOTP_ENCRYPTION_KEY` | exactly 32 bytes, encoded as 64 hex characters or base64 |
| `BANK_DATA_ENCRYPTION_KEY` | exactly 32 bytes (64 hex or base64) for AES-256-GCM employee bank-account encryption; keep it outside the database and do not rotate it without re-encrypting existing values |
| `MALWARE_SCAN_URL` | HTTPS scanner endpoint, for example the Railway ClamAV service |
| `MALWARE_SCAN_TOKEN` | strong random bearer secret shared only with the scanner |
| `PG_POOL_MAX` | a low number on serverless, where each instance opens its own pool |

Mail is optional: with no provider the outbox queues and reports honestly rather
than claiming a send. `DEMO_MODE=true` on a public URL exposes the workspace
through seeded demo credentials, so it belongs on local and private previews
only.

Apply the schema (see `drizzle/README.md`) before the first request, then visit
`/setup` to create the owner account.

For an existing production database, apply `drizzle/0004_bank_account_envelope.sql`, set `BANK_DATA_ENCRYPTION_KEY`, run `npx tsx scripts/encrypt-bank-accounts.ts` as a dry run, then rerun it with `--apply`. `/api/readiness` remains launch-blocked until the key is configured and no employee bank account remains in plaintext.

## Validation sequence

```bash
npx next typegen
npm exec tsc -- --noEmit --pretty false
npx tsx --test tests/payroll-rules.test.ts tests/security.test.ts
npm run build
```
