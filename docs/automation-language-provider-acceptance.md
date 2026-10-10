# Automation Studio — controlled AI provider acceptance

**Status:** Prepared, **not executed** against a live provider or isolated deployed staging tenant.

This is a pre-merge handoff for the controlled sequence:

Natural-language request → typed draft → validation → Impact Preview → human approval / publish.

## What is automated

- Unit tests verify typed trigger, action, recipient, and condition fidelity against mocked model outputs.
- A disposable PostgreSQL + production-mode app HTTP test validates signed draft save, non-mutating Impact Preview, and publication gates with no real data.
- A separate Chromium browser test validates the admin review and confirmation experience.
- These tests intentionally keep the external AI provider disabled.

## Run the optional real-provider contract probe

**Owner:** An authorized tester who has reviewed the exact PR commit and the provider's handling of synthetic prompts.

**Prerequisites:**

1. Use an isolated test workstation or a protected, reviewer-approved CI environment; **never production**.
2. Create a dedicated provider key with a small test-only spending budget and restricted permissions. Inject it from the environment's secret manager, not GitHub repository variables, shell history, command-line flags, or a checked-in file.
3. Confirm that none of the example prompts contains real employee, payroll, bank, health, identity, or contact information.
4. Use a reviewed and pinned model that supports JSON-only responses. The current default is `gpt-4.1-mini`; check availability with the provider before acceptance.
5. Review the exact branch commit. The probe does not need a running app, a database, a Vercel project, or any Vercel credentials.

From the checked-out, reviewed PayrollPH commit, with dependencies installed and `OPENAI_API_KEY` already securely injected:

```sh
unset DATABASE_URL
export AUTOMATION_PROVIDER_CONTRACT_MODE=synthetic-only-no-database
export OPENAI_AUTOMATION_DRAFT_ENABLED=true
export OPENAI_AUTOMATION_DRAFT_MODEL=gpt-4.1-mini
npx tsx scripts/automation-language-live-provider-contract.ts
```

Do not print the key or paste it into a chat. The script exits without contacting the provider when the explicit opt-in, server-side key, or no-database restriction is missing. It makes at most two external requests, both using hard-coded synthetic prompts, and checks that a privileged pay-change command is rejected before network access.

**Expected output:** Only a `PASS` or `FAIL` per fixture, typed step count, and an overall result. A failure is not a reason to bypass type or intent checks; inspect it privately and adjust either the model mapping or the recognized intent before retrying. Never log raw generated draft JSON or provider responses in a shared CI log.

## This probe does NOT certify staging or production

The provider contract probe only verifies that the currently configured external model can produce correct **in-memory drafts** for two known synthetic requests, subject to real server validation. It does not write a rule, send email, submit payroll, call a worker, preview historical events, publish a version, or enable an automation.

An independent engineer and security reviewer must still approve the PR. A separate **staging-only** application with a non-production database, isolated credentials, MFA-enabled administrator, and documented provider data handling is required for live UI acceptance. Confirm the following in that isolated tenant:

- Correct trigger and every requested THEN action are represented in the typed draft; any scope restriction is retained, not silently expanded.
- Model interpretation cannot insert salary adjustment, permission change, money movement, arbitrary webhook, or custom recipient actions.
- Saving the signed proposal creates a versioned inactive draft and zero runtime executions.
- Expired or tampered proposal/preview proof fails, and changed drafts require a fresh Impact Preview.
- Low-evidence previews explicitly disclose the absence of authoritative events.
- Publish requires a separate human confirmation and never automatically enables a model-generated workflow.
- No raw prompt, model response, key, sensitive identity field, or session token appears in logs or audit records.

## Independent review and release decision

Document the exact commit SHA, model version, date, tester, prompt-fixture IDs, counts, approvals, staging database isolation, and any exception evidence in the PR. Do **not** mark accepted based solely on green CI.

**Merge is not authorized by this document.** Broader separation execution, production certification, and production deployment remain separate outstanding workstreams.
