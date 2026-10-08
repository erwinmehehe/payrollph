# Automation Studio: natural-language release gates

Scope: **language request → typed proposal → server validation → signed inactive draft → zero-write Impact Preview → human approval/publish**.

This document applies only to natural-language drafting. Broader separation execution and production certification are separate workstreams.

## Server-only rollout control

`AUTOMATION_LANGUAGE_STUDIO_ENABLED=false` is the default. Unless deliberately
enabled for an authorized environment, it hides the plain-English drafting
interface and rejects **both** language generation and signed language-draft
saving at the API boundary (HTTP 403, `LANGUAGE_DRAFTING_DISABLED`).
The existing manual Automation Studio builder, reviewed templates, Impact
Preview, existing published workflows and governed execution are unaffected.

This is separate from `OPENAI_AUTOMATION_DRAFT_ENABLED`, which only controls
whether language interpretation is sent to an external AI provider. An AI key
alone cannot expose the feature. Both settings are server-only, not
`NEXT_PUBLIC_*`.

Automated positive-path tests use only the predefined `synthetic-postgres-only`
CI fixture with localhost application/database, an empty provider key, and no
explicit rollout setting. An explicit `false` always overrides that fixture.
Default-off behavior and denial for nonlocal targets are separately unit tested.

Until independent human review (issue #621) and isolated staging acceptance
(issue #622), leave the rollout setting off outside this disposable fixture.

## Automated evidence

The PR runs:

- TypeScript, regression tests, statutory payroll fixtures and Next.js production build
- Anonymous, cross-origin, cross-tenant and MFA security HTTP smoke
- Payout/payroll isolation and disposable PostgreSQL backup/restore
- CodeQL analysis
- Synthetic HTTP and Chromium administrator acceptance (no external AI)

These tests prove only the behavior under their fixtures. They do not substitute for an independent review or a live third-party provider check.

## Independent review gate — required before merge

An authorized reviewer other than the PR author must verify:

- No model output can call an execution or publication endpoint directly
- Typed allow-list excludes privileged access changes, money movement, arbitrary webhooks and custom recipients
- Tenant-specific IDs/codes cannot be generated or inferred in IF conditions
- Generated steps preserve explicit requested actions, recipients, known triggers and simple location/department scopes
- The signed proposal matches the definition saved, is session-bound and expires in 15 minutes
- Saving creates an inactive version; edited proposals require a new signed draft
- Impact Preview remains read-only and proof binds the exact stored draft, tenant, administrator and session
- Publish rechecks authoritative policy blocks and requires explicit human approval, with a limited-evidence acknowledgment for empty event samples
- Publishing a generated workflow does not activate it; enabling remains separate
- No prompt text, model output, credentials, receipts, or employee personal information is exposed through audit or CI logs

**No self-approval.** Leave the PR open until a verified reviewer approves the exact head commit and comments are resolved.

## Optional live-provider contract check — NOT automatic

Use the canonical operator guide:
**[Controlled provider acceptance](automation-language-provider-acceptance.md)**.

The one maintained executable is `scripts/automation-language-live-provider-contract.ts`. It requires explicit synthetic-only opt-in, a securely injected **staging-only** provider key, and **no `DATABASE_URL`**, then provides its own intentionally unreachable local pool setting so application imports cannot access a remote database.

It blocks unsafe requests before sending anything to the provider; checks the actual provider output for the expected trigger, every requested step, no unexpected conditions, and correct recipient; and prints only sanitized result metadata.

Do not run this from automatic PR workflows or unreviewed code. The check was **prepared, not performed**: no provider key was supplied. Even when it passes, it does not replace an isolated application staging test or an independent human code review.

## Final release decision

Do not merge or deploy solely because CI is green. Required evidence:

1. Independent human review on the final commit
2. Synthetic HTTP and browser acceptance passing on the final commit
3. Optional live-provider contract checked where an approved staging key is available
4. Real staging review using synthetic data, with no production data or dependencies
5. Separate production certification authorization, which is outside this PR

Any failed check or missing prerequisite means **no release**.
