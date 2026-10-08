# Automation Studio: natural-language release gates

Scope: **language request → typed proposal → server validation → signed inactive draft → zero-write Impact Preview → human approval/publish**.

This document applies only to natural-language drafting. Broader separation execution and production certification are separate workstreams.

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

`scripts/automation-language-live-provider-check.ts` makes **two requests about synthetic workflow policies only** and checks the actual model response through the server's typed validator. It does not save a draft, use an actual employee record, invoke workflow actions, or contact the app's database.

Run only after an independent reviewer has approved the exact code and a protected, isolated staging secret store has supplied a **dedicated non-production provider key**. The key must never be pasted into chat, the command line, a PR comment, or a log.

Environment variables required in the protected job:

| Variable | Value / source |
|---|---|
| `AUTOMATION_LANGUAGE_PROVIDER_ACCEPTANCE` | `synthetic-only` |
| `OPENAI_AUTOMATION_DRAFT_ENABLED` | `true` |
| `OPENAI_API_KEY` | Dedicated staging-only key via environment secret |
| `OPENAI_AUTOMATION_DRAFT_MODEL` | Reviewed compatible model, optional |
| `DATABASE_URL` | Omit or use a local-only dummy DSN; remote DB URLs are rejected |

From the reviewed project directory, after the environment has securely injected the key:

```bash
npx tsx scripts/automation-language-live-provider-check.ts
```

For GitHub-hosted execution, use **manual `workflow_dispatch` on the reviewed branch** under an environment with required reviewers, and bind `AUTOMATION_LANGUAGE_APPROVED_COMMIT` to the exact `GITHUB_SHA`. Do not add this script to automatic `pull_request` CI; never expose an external-provider secret to unreviewed code.

Expected success: `result: PASS`, `test: synthetic-live-provider-contract`, two successful scenarios, `savedDrafts: 0`, `executionsCreated: 0`, and `productionCertified: false`. On any mismatch, treat the check as failed and diagnose privately; the script emits only sanitized status.

**A live-provider contract PASS is not a staging UI test.** An operator still needs a separately configured staging tenant, dedicated non-production database, MFA-enabled admin, and an end-to-end review. No PayrollPH project was found in the previously connected Vercel workspace.

## Final release decision

Do not merge or deploy solely because CI is green. Required evidence:

1. Independent human review on the final commit
2. Synthetic HTTP and browser acceptance passing on the final commit
3. Optional live-provider contract checked where an approved staging key is available
4. Real staging review using synthetic data, with no production data or dependencies
5. Separate production certification authorization, which is outside this PR

Any failed check or missing prerequisite means **no release**.
