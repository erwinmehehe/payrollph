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

## Read-only exact-commit release checker

The canonical verifier now lives in the repository:
`scripts/verify-automation-language-release.mjs`. Its fail-closed fixtures
live in `tests/verify-automation-language-release.test.mjs` and are exercised
by the regular CI suite through
`tests/automation-release-gate-integration.test.ts`.

The read-only checker has **two explicit scopes** so code merge does not become production authorization. Both require an exact SHA, clean comparison to current `main`, six successful exact-head workflows, and an independent trusted human approval. The default `AUTOMATION_RELEASE_SCOPE=merge` additionally requires closing [code/security review #621](https://github.com/erwinmehehe/payrollph/issues/621). It **does not** require staging-provider acceptance while the feature stays server-side OFF.

`AUTOMATION_RELEASE_SCOPE=activation` also requires closing [isolated staging acceptance #622](https://github.com/erwinmehehe/payrollph/issues/622) with independent exact-SHA attestation; this is **not** automatically enabled by merging. A newer failing workflow or unresolved changes-requested review invalidates an older successful result. This aligns with the risk-based change policy without weakening the human code-review gate.

An authorized operator may run the checker from a reviewed checkout after
injecting a **read-only** `GITHUB_TOKEN` through a secret manager:

```sh
node --test tests/verify-automation-language-release.test.mjs
export GITHUB_REPOSITORY=erwinmehehe/payrollph
export AUTOMATION_REVIEWED_HEAD_SHA=<exact-reviewed-40-character-commit-sha>
# Code-merge readiness; leaves language drafting OFF
AUTOMATION_RELEASE_SCOPE=merge node scripts/verify-automation-language-release.mjs
# Separately, after real isolated live-provider staging and independent attestation:
AUTOMATION_RELEASE_SCOPE=activation node scripts/verify-automation-language-release.mjs
```

Do not paste tokens or secret environment values into a shell transcript, chat,
GitHub comment, log, or repository file. The CLI refuses a missing token,
unrecognized repository, unpinned head or incomplete evidence. A nonzero exit
code means **not ready for the selected decision**.

The independent staging reviewer should attach sanitized underlying test
evidence to issue #622. A qualified independent collaborator may add the
following evidence-index lines to one comment after verifying the exact SHA:

```text
STAGING-ACCEPTED: <reviewed-40-character-sha>
LIVE-PROVIDER: PASS
NONPROD-DB: VERIFIED
MFA: VERIFIED
NO-PRODUCTION-DATA: VERIFIED
```

These labels are **not a cryptographic certification** and do not authorize
merging or production release. The human reviewer must inspect the evidence.
The script does not post approval, edit issues, deploy or modify workflow state.

## Post-merge activation verification (distinct from the PR merge checker)

PR #609 is **already merged**. The older `scripts/verify-automation-language-release.mjs` intentionally requires an **open** PR, so its former `activation` scope cannot certify a deployment **after** that merge. Do not override its open-PR checks or treat the merge commit as an independent review.

For the actual post-merge decision, use the separate, **read-only and fail-closed** verifier `scripts/verify-automation-postmerge-activation.mjs` (tests: `tests/verify-automation-postmerge-activation.test.mjs`). It requires all of the following:

- An exact 40-character commit SHA equal to current `main`, with the original merged #609 commit in that SHA's ancestry.
- A **closed** security/intent review issue #621 and a separate, authorized GitHub collaborator's exact-SHA comment containing `SECURITY-REVIEWED: <main-sha>`, `INTENT-FIDELITY: PASS`, `TENANT-ACCESS: VERIFIED`, and `NO-EXECUTION-BYPASS: VERIFIED`.
- A **closed** staging issue #622 and an independent reviewer comment containing `STAGING-ACCEPTED: <main-sha>`, `LIVE-PROVIDER: PASS`, `NONPROD-DB: VERIFIED`, `MFA: VERIFIED`, `NO-PRODUCTION-DATA: VERIFIED`, and `ROLLOUT-FLAG: OFF`.
- All six existing required workflows successful **on the exact current main SHA**. Because synthetic Automation Language Acceptance normally runs on PRs, an authorized operator must first run its existing non-provider `workflow_dispatch` on the protected current `main` branch (using synthetic fixtures only). No provider credentials are required for that workflow.
- Independent review and privately retained source evidence: the issue comments are *evidence indexes*, not proof by themselves. The verifier cannot inspect actual staging hosts, live provider prompts or real-environment secrets.

From an authorized, reviewed checkout with a read-only `GITHUB_TOKEN` injected securely:

```sh
node --test tests/verify-automation-postmerge-activation.test.mjs
export GITHUB_REPOSITORY=erwinmehehe/payrollph
export AUTOMATION_ACTIVATION_MAIN_SHA=<current-main-40-character-sha>
node scripts/verify-automation-postmerge-activation.mjs
```

The new verifier only reads GitHub metadata. It does not set `AUTOMATION_LANGUAGE_STUDIO_ENABLED`, call an AI provider, deploy an application, or approve any payroll or banking action. **Keep the language feature OFF** until authorized staff have independently completed both security and real-provider staging reviews, and a separate operational change-control authorizes activation. If current `main` changes, collect fresh exact-SHA evidence; never reuse an earlier acceptance.

## Final release decision

**To merge default-OFF code:** current-head CI, synthetic acceptance, independently approved code/security review and closed issue #621. Do not self-approve. Merging alone must not enable the runtime lane.

**To activate natural-language drafting:** separately complete actual isolated staging/live-provider acceptance, independent attestation and issue #622, recheck exact-head security evidence, and approve server-side rollout. Keep `AUTOMATION_LANGUAGE_STUDIO_ENABLED=false` while this remains open.

**To authorize production payroll or money movement:** separate employer, bank, statutory, privacy and recovery controls apply; this feature's merge/activation check cannot certify them.

Any failed check or missing prerequisite blocks **that scope**, rather than every unrelated engineering activity.
