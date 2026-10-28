# Production environment checklist — PayrollPH

**SOURCE-ONLY / RELEASE NO-GO.** This file is a preparation and verification guide, NOT approval to deploy, rotate a key, run a migration, launch, enable money movement, or connect to Neon. Inspected source: verified GitHub main SHA **de52b3aea0332754a138c8bf8df96e9ff0375b5d** originally; all 50 code-reference rows reverified against **main@4d5b4c1756bfe480ded4c2eb03709ead4fe4e320** on 2026-10-18. The required initial `git fetch origin main` was attempted twice in the provided checkout: both returned **exit 128** (first no repository, then GitHub DNS unresolved). Source was fetched by connected GitHub commit SHA instead of trusting an empty/stale checkout.

## Gate semantics, in code rather than assumptions

- The exact `production-security-config` gate in [operational-readiness.ts](../src/lib/operational-readiness.ts#L168) is automatically green outside `NODE_ENV=production`. In production, it requires an origin starting `https://` (APP_BASE_URL, with VERCEL_PROJECT_PRODUCTION_URL fallback) and **presence** of TOTP_ENCRYPTION_KEY, not key validity. That is **only one gate**.
- [security-preflight.ts](../scripts/security-preflight.ts) is stricter about HTTPS, a valid **32-byte** TOTP key, 32+ byte SETUP_TOKEN and MALWARE_SCAN_TOKEN, DATABASE_URL presence, exact DEMO_MODE=false, and worker/readiness verifier secrets. Its REQUIRE_PRIVILEGED_MFA check rejects only literal false. A preflight PASS is necessary but not evidence of actual DB role isolation, applied migrations or live delivery.
- [production-certification-gates.ts](../src/lib/production-certification-gates.ts) directly reads **no environment variables**; it evaluates private operational evidence files and deliberately does not authorize general availability. Do not turn external/human proof into a boolean env flag.
- Direct readiness dependencies also read encryption keys, selected mail provider, scanner/feature flag state, and billing/payout indicators. The tables below include every env variable directly checked in the four requested executable files plus those direct helpers and the requested rollout/worker safeguards. Variables in the example that are unrelated to these paths are **not automatically launch requirements**.
- **Keep WORKER_ENABLED=false, CENTRAL_SCHEDULER_ENABLED=false and PAYMONGO_DISBURSEMENTS_ENABLED=false.** These require later separate decisions. Configure independent secrets without enabling those controls.

## Generating a key (text instruction only)

For rows specifying `openssl rand -hex 32`, **an authorized human** may run that exact command only within protected secret provisioning. It generates 32 random bytes represented by 64 hexadecimal characters. Do not run it here, echo output, paste values into Actions input, save values in repository files, log them or reuse them across roles. A provider-issued credential, bank URL, production DB connection string or reviewed commit SHA is not generated with OpenSSL. Every `*_PREVIOUS` key is **leave empty until rotating**.

## Value-free verification helpers

Paste these helpers once in an authorized, private operator shell **after** the protected env is loaded. Each prints PASS/FAIL and the NAME only; never the value. They are syntax/presence checks, not operational receipts.

```sh
check_env() {
  node - "$1" "$2" <<'NODE'
const [name, kind] = process.argv.slice(2);
const value = process.env[name] ?? "";
let ok = false;
switch (kind) {
  case "present": ok = value.trim().length > 0; break;
  case "empty": ok = value.trim().length === 0; break;
  case "min32": ok = Buffer.byteLength(value.trim(), "utf8") >= 32; break;
  case "key32": ok = /^[a-f0-9]{64}$/i.test(value.trim()); break;
  case "true": case "false": case "production": case "pilot":
    ok = value === kind; break;
  case "sha40": ok = /^[a-f0-9]{40}$/i.test(value); break;
  case "https":
  case "https-url":
    try {
      const u = new URL(value);
      ok = u.protocol === "https:" && !u.username && !u.password &&
        !u.hash && !u.search && (kind === "https-url" ||
          (u.origin === value.replace(/\/$/, "") &&
           u.pathname === "/" && !u.search));
    } catch { ok = false; }
    break;
  default: throw Error("Unsupported verification kind");
}
console.log((ok ? "PASS " : "FAIL ") + name + " (" + kind + ")");
if (!ok) process.exitCode = 1;
NODE
}
check_env_equal() {
  node - "$1" "$2" <<'NODE'
const { timingSafeEqual } = require("node:crypto");
const [a,b] = process.argv.slice(2);
const left = Buffer.from(process.env[a] ?? "", "utf8");
const right = Buffer.from(process.env[b] ?? "", "utf8");
const ok = left.length > 0 && left.length === right.length && timingSafeEqual(left,right);
console.log((ok ? "PASS " : "FAIL ") + a + " matches " + b);
if (!ok) process.exitCode = 1;
NODE
}
```

Optional/provider entries use their exact `check_env NAME present` command **only when an authorized provider is selected**; otherwise leave them unset. An environment value by itself never proves a bank settlement, email delivery, migration receipt, or safe demo/database isolation.

## Server / preflight / activation variables

| Variable | Why it is read / required state | Generation or secure provisioning, not performed here | Exact no-value verification | Code source |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Require production (nonproduction short-circuits the named gate). | Platform-managed, not secret. | `check_env NODE_ENV production` | [`src/lib/operational-readiness.ts:170`](../src/lib/operational-readiness.ts#L170) |
| `APP_BASE_URL` | Canonical HTTPS origin used for gate, origin checks and preflight. | Approved operator origin; do not invent. | `check_env APP_BASE_URL https` | [`scripts/security-preflight.ts:50`](../scripts/security-preflight.ts#L50) |
| `VERCEL_PROJECT_PRODUCTION_URL` | Platform fallback for origin; not sufficient for security:preflight. | Platform-managed; never invent. | `check_env VERCEL_PROJECT_PRODUCTION_URL present` | [`src/lib/operational-readiness.ts:168`](../src/lib/operational-readiness.ts#L168) |
| `DATABASE_URL` | Restricted, operator-attested serving database; preflight tests presence only. | Restricted operator/secret manager only. | `check_env DATABASE_URL present` | [`scripts/security-preflight.ts:74`](../scripts/security-preflight.ts#L74) |
| `TOTP_ENCRYPTION_KEY` | Valid dedicated 32-byte TOTP key; gate itself only tests presence. | openssl rand -hex 32 | `check_env TOTP_ENCRYPTION_KEY key32` | [`scripts/security-preflight.ts:20`](../scripts/security-preflight.ts#L20) |
| `READINESS_TOKEN` | Dedicated 32+ byte authenticated readiness verifier; separate from WORKER_TOKEN. | openssl rand -hex 32 | `check_env READINESS_TOKEN min32` | [`src/lib/operational-secret.ts:8`](../src/lib/operational-secret.ts#L8) |
| `WORKER_TOKEN` | Dedicated 32+ byte worker endpoint verifier (does not enable jobs). | openssl rand -hex 32 | `check_env WORKER_TOKEN min32` | [`scripts/security-preflight.ts:53`](../scripts/security-preflight.ts#L53) |
| `SETUP_TOKEN` | Independent 32+ byte setup token; no sample credentials. | openssl rand -hex 32 | `check_env SETUP_TOKEN min32` | [`scripts/security-preflight.ts:70`](../scripts/security-preflight.ts#L70) |
| `DEMO_MODE` | Must be literal false in customer production. | Set false; no secret. | `check_env DEMO_MODE false` | [`scripts/security-preflight.ts:79`](../scripts/security-preflight.ts#L79) |
| `REQUIRE_PRIVILEGED_MFA` | Set literal true (preflight otherwise only rejects literal false). | Set true; no secret. | `check_env REQUIRE_PRIVILEGED_MFA true` | [`scripts/security-preflight.ts:84`](../scripts/security-preflight.ts#L84) |
| `MALWARE_SCAN_URL` | HTTPS malware scanner; preflight requires even if uploads disabled. | Approved scanner HTTPS origin; no fake URL. | `check_env MALWARE_SCAN_URL https-url` | [`scripts/security-preflight.ts:51`](../scripts/security-preflight.ts#L51) |
| `MALWARE_SCAN_TOKEN` | Separate minimum-32-byte scanner secret required by preflight. | openssl rand -hex 32 | `check_env MALWARE_SCAN_TOKEN min32` | [`scripts/security-preflight.ts:71`](../scripts/security-preflight.ts#L71) |
| `DOCUMENT_UPLOADS_ENABLED` | Keep false until separately approved scanning/storage/privacy. | Set false; no activation. | `check_env DOCUMENT_UPLOADS_ENABLED false` | [`src/lib/critical-release-flags.ts:246`](../src/lib/critical-release-flags.ts#L246) |
| `WORKER_ENABLED` | KEEP FALSE until explicit worker activation decision. | Set false; no activation. | `check_env WORKER_ENABLED false` | [`src/lib/operational-readiness.ts:401`](../src/lib/operational-readiness.ts#L401) |
| `CENTRAL_SCHEDULER_ENABLED` | KEEP FALSE until explicit scheduler decision. | Set false; no activation. | `check_env CENTRAL_SCHEDULER_ENABLED false` | [`src/lib/critical-release-flags.ts:217`](../src/lib/critical-release-flags.ts#L217) |
| `PAYMONGO_DISBURSEMENTS_ENABLED` | KEEP FALSE until approved money movement. | Set false; no activation. | `check_env PAYMONGO_DISBURSEMENTS_ENABLED false` | [`src/lib/operational-readiness.ts:126`](../src/lib/operational-readiness.ts#L126) |
| `BANK_DATA_ENCRYPTION_KEY` | Dedicated 32-byte bank encryption key preferred over TOTP-derived fallback. | openssl rand -hex 32 | `check_env BANK_DATA_ENCRYPTION_KEY key32` | [`src/lib/bank-account-crypto.ts:18`](../src/lib/bank-account-crypto.ts#L18) |
| `PII_ENCRYPTION_KEY` | Dedicated 32-byte government-ID key; code has NO TOTP fallback. | openssl rand -hex 32 | `check_env PII_ENCRYPTION_KEY key32` | [`src/lib/government-id-crypto.ts:6`](../src/lib/government-id-crypto.ts#L6) |
| `BANK_DATA_ENCRYPTION_KEY_PREVIOUS` | Leave empty until rotating under a reviewed plan. | No generation now. | `check_env BANK_DATA_ENCRYPTION_KEY_PREVIOUS empty` | [`src/lib/bank-account-crypto.ts:27`](../src/lib/bank-account-crypto.ts#L27) |
| `TOTP_ENCRYPTION_KEY_PREVIOUS` | Leave empty until rotating under a reviewed plan. | No generation now. | `check_env TOTP_ENCRYPTION_KEY_PREVIOUS empty` | [`src/lib/bank-account-crypto.ts:27`](../src/lib/bank-account-crypto.ts#L27) |
| `PII_ENCRYPTION_KEY_PREVIOUS` | Leave empty until rotating under a reviewed plan. | No generation now. | `check_env PII_ENCRYPTION_KEY_PREVIOUS empty` | [`src/lib/government-id-crypto.ts:7`](../src/lib/government-id-crypto.ts#L7) |
| `PII_LEGACY_READ_ENABLED` | Keep false: legacy government-ID reads are separate approved compatibility work. | Set false. | `check_env PII_LEGACY_READ_ENABLED false` | [`src/lib/critical-release-flags.ts:190`](../src/lib/critical-release-flags.ts#L190) |
| `PII_LEGACY_GOVERNMENT_ID_KEY` | Keep empty; only used behind explicit legacy compatibility flag. | No generation now. | `check_env PII_LEGACY_GOVERNMENT_ID_KEY empty` | [`src/lib/government-id-crypto.ts:88`](../src/lib/government-id-crypto.ts#L88) |

## Conditional provider / monitoring / informational variables

| Variable | Why it is read / required state | Generation or secure provisioning, not performed here | Exact no-value verification | Code source |
| --- | --- | --- | --- | --- |
| `PAYMONGO_SECRET_KEY` | Conditional billing/payout provider; presence is not a settled payment. | Provider-issued, only if approved. | `check_env PAYMONGO_SECRET_KEY present` | [`src/lib/operational-readiness.ts:122`](../src/lib/operational-readiness.ts#L122) |
| `PAYMONGO_WEBHOOK_SECRET` | Conditional signed disbursement webhook; no payout activation. | Provider-issued, only if approved. | `check_env PAYMONGO_WEBHOOK_SECRET present` | [`src/lib/operational-readiness.ts:127`](../src/lib/operational-readiness.ts#L127) |
| `PAYMONGO_WALLET_ID` | Conditional payout source-account identifier; not acceptance evidence. | Provider-issued, only if approved. | `check_env PAYMONGO_WALLET_ID present` | [`src/lib/operational-readiness.ts:130`](../src/lib/operational-readiness.ts#L130) |
| `MAYA_SECRET_KEY` | Conditional billing indicator; not proof of paid invoices. | Provider-issued, only if approved. | `check_env MAYA_SECRET_KEY present` | [`src/lib/operational-readiness.ts:122`](../src/lib/operational-readiness.ts#L122) |
| `STRIPE_SECRET_KEY` | Conditional billing indicator; not proof of paid invoices. | Provider-issued, only if approved. | `check_env STRIPE_SECRET_KEY present` | [`src/lib/operational-readiness.ts:122`](../src/lib/operational-readiness.ts#L122) |
| `BANK_HOST_TO_HOST_URL` | Conditional direct-bank indicator; mere presence can affect readiness. | Approved bank endpoint only. | `check_env BANK_HOST_TO_HOST_URL https-url` | [`src/lib/operational-readiness.ts:125`](../src/lib/operational-readiness.ts#L125) |
| `INSTAPAY_API_KEY` | Conditional direct-bank indicator; not transfer evidence. | Provider-issued, only if approved. | `check_env INSTAPAY_API_KEY present` | [`src/lib/operational-readiness.ts:125`](../src/lib/operational-readiness.ts#L125) |
| `RESEND_API_KEY` | Conditional transactional mail provider. | Provider-issued, only if selected. | `check_env RESEND_API_KEY present` | [`src/lib/mail-provider.ts:4`](../src/lib/mail-provider.ts#L4) |
| `POSTMARK_SERVER_TOKEN` | Alternative transactional mail provider. | Provider-issued, only if selected. | `check_env POSTMARK_SERVER_TOKEN present` | [`src/lib/mail-provider.ts:5`](../src/lib/mail-provider.ts#L5) |
| `SMTP_URL` | Alternative mail transport; often contains credentials. | Provider-issued, only if selected. | `check_env SMTP_URL present` | [`src/lib/mail-provider.ts:6`](../src/lib/mail-provider.ts#L6) |
| `MAIL_FROM` | Verified sender for transactional provider, not delivered-mail proof. | Approve with chosen provider. | `check_env MAIL_FROM present` | [`src/lib/mailer.ts:103`](../src/lib/mailer.ts#L103) |
| `RESEND_WEBHOOK_SECRET` | Conditional delivery event signature verification. | Provider-issued, only if selected. | `check_env RESEND_WEBHOOK_SECRET present` | [`src/app/api/webhooks/resend/route.ts:11`](../src/app/api/webhooks/resend/route.ts#L11) |
| `S3_BUCKET` | Scale-only object storage indicator; gate still says not integrated. | Keep empty unless storage is approved. | `check_env S3_BUCKET empty` | [`src/lib/operational-readiness.ts:160`](../src/lib/operational-readiness.ts#L160) |
| `R2_BUCKET` | Alternate scale-only storage indicator; not integration proof. | Keep empty unless storage is approved. | `check_env R2_BUCKET empty` | [`src/lib/operational-readiness.ts:160`](../src/lib/operational-readiness.ts#L160) |
| `SAML_METADATA_URL` | Optional SSO scale indicator; SAML integration still false. | Keep empty until approved. | `check_env SAML_METADATA_URL empty` | [`src/lib/operational-readiness.ts:393`](../src/lib/operational-readiness.ts#L393) |
| `CRON_SECRET` | Separate private scheduler bearer; not permission to run cron. | openssl rand -hex 32 only after approval. | `check_env CRON_SECRET empty` | [`src/lib/scheduler-cron-auth.ts:7`](../src/lib/scheduler-cron-auth.ts#L7) |
| `SCHEDULER_MONITOR_TOKEN` | Separate private monitor token; not worker activation. | openssl rand -hex 32 only after approval. | `check_env SCHEDULER_MONITOR_TOKEN empty` | [`src/app/api/jobs/status/route.ts:20`](../src/app/api/jobs/status/route.ts#L20) |
| `HEALTH_TOKEN` | Optional dedicated health monitor credential. | openssl rand -hex 32 only after approval. | `check_env HEALTH_TOKEN empty` | [`src/app/api/health/route.ts:15`](../src/app/api/health/route.ts#L15) |
| `MALWARE_SCAN_TIMEOUT_MS` | Optional positive scanner timeout when enabled. | Operator-approved integer only. | `check_env MALWARE_SCAN_TIMEOUT_MS empty` | [`src/lib/storage.ts:151`](../src/lib/storage.ts#L151) |
| `TRUSTED_APP_ORIGINS` | Extra trusted origins, optional security-sensitive allowlist. | Keep empty without reviewed origins. | `check_env TRUSTED_APP_ORIGINS empty` | [`src/lib/security-request.ts:23`](../src/lib/security-request.ts#L23) |
| `PRIVILEGED_MFA_MAX_AGE_HOURS` | Optional MFA age policy; leave default until reviewed. | Optional reviewed integer. | `check_env PRIVILEGED_MFA_MAX_AGE_HOURS empty` | [`src/lib/security-request.ts:135`](../src/lib/security-request.ts#L135) |

## Protected rollout and platform verification variables

| Variable | Why it is read / required state | Generation or secure provisioning, not performed here | Exact no-value verification | Code source |
| --- | --- | --- | --- | --- |
| `PRODUCTION_BASE_URL` | Protected operator/Actions probe HTTPS origin. | Same approved origin as APP_BASE_URL. | `check_env PRODUCTION_BASE_URL https` | [`scripts/live-production-readiness.ts:4`](../scripts/live-production-readiness.ts#L4) |
| `PRODUCTION_READINESS_TOKEN` | GitHub protected verifier secret; must match deployed READINESS_TOKEN. | Transfer securely via approved secret manager. | `check_env PRODUCTION_READINESS_TOKEN min32` | [`scripts/live-production-readiness.ts:5`](../scripts/live-production-readiness.ts#L5) |
| `ROLLOUT_MODE` | Operator-only probe mode; pilot is an assertion not launch authority. | Set pilot only for authorized probe. | `check_env ROLLOUT_MODE pilot` | [`scripts/live-production-readiness.ts:7`](../scripts/live-production-readiness.ts#L7) |
| `EXPECTED_COMMIT_SHA` | Exact reviewed, deployed, 40-character Git commit. | Operator-provided, not guessed. | `check_env EXPECTED_COMMIT_SHA sha40` | [`scripts/live-production-readiness.ts:12`](../scripts/live-production-readiness.ts#L12) |
| `VERCEL_GIT_COMMIT_SHA` | Vercel-reported live deployment SHA from private endpoint. | Platform-managed; no invention. | `check_env VERCEL_GIT_COMMIT_SHA sha40` | [`src/app/api/readiness/deployment/route.ts:28`](../src/app/api/readiness/deployment/route.ts#L28) |
| `VERCEL_ENV` | Vercel deployment environment metadata. | Platform-managed; no invention. | `check_env VERCEL_ENV production` | [`src/app/api/readiness/deployment/route.ts:29`](../src/app/api/readiness/deployment/route.ts#L29) |

## Human-only verification sequence (not executed in this PR)

**Current release remains NO-GO.** These are *future operator instructions* after separate DBA, security and deployment review. They must not be executed against production during this preparation request.

1. Privately attest the **actual** web and worker database host/branch/database/role; prove app credentials have no CREATE/ALTER/DROP or audit bypass powers and do not share the demo database. Independently check source SQL vs the real target and authentic migration receipts. Readiness config cannot clear #899, #908 or #1198.
2. Configure approved production environment variables in a protected manager; run the value-free checks above. Confirm DEMO_MODE=false, REQUIRE_PRIVILEGED_MFA=true, the three activation toggles false, APP_BASE_URL HTTPS, and a valid 32-byte TOTP key. **Do not** apply migrations or backfills from this checklist.
3. **Preflight output disclosure HOLD.** The existing `security-preflight.ts` prints accepted **complete** `APP_BASE_URL` and `MALWARE_SCAN_URL` strings (`httpsUrl()` returns `detail: ok ? raw : ...`), and may print an unexpected `REQUIRE_PRIVILEGED_MFA` value. `https:` alone does not reject URL-embedded credentials or query tokens. **Do not run this preflight in shared CI, a recorded shell, or an auto-captured terminal; do not pipe, upload, paste, or retain raw stdout/stderr.** Only a separately reviewed source fix that suppresses URL and arbitrary environment-value output can permit shared logs or reproducible production evidence. Until then, a separately authorized security operator may run it only in a tightly restricted, non-recording environment with explicit output-handling approval; retain at most independently sanitized per-check PASS/FAIL status and actual exit code in a restricted vault. A nonzero code stays **BLOCKED**. **Neither the command nor any live preflight was executed in this PR**:

```sh
npm run security:preflight
```

4. **After a separately approved deployment only**, issue authenticated `GET /api/readiness` with header `x-readiness-token` whose value is read from `READINESS_TOKEN`; the command prints **only** HTTP status and the named gate (no token, host, or other payload data):

```sh
node --input-type=module <<'NODE'
const base = process.env.APP_BASE_URL;
const token = process.env.READINESS_TOKEN;
if (!base || !token) throw Error("Protected operator environment is incomplete");
const response = await fetch(new URL("/api/readiness", base), {
  headers: { "x-readiness-token": token },
  cache: "no-store", redirect: "error"
});
const data = await response.json().catch(() => ({}));
const gate = Array.isArray(data.gates)
  ? data.gates.find(item => item.key === "production-security-config") : null;
const ok = response.ok && gate?.ready === true;
console.log(JSON.stringify({ httpStatus: response.status,
  gate: "production-security-config", ready: gate?.ready === true }));
if (!ok) process.exitCode = 1;
NODE
```

**The named gate being green does not authorize any release or excuse other failing gates.** Obtain the full private readiness report and preserve all blockers as-is.

5. For the independently authorized protected HTTP probe, set **PRODUCTION_BASE_URL**, **PRODUCTION_READINESS_TOKEN**, **ROLLOUT_MODE=pilot**, and **EXPECTED_COMMIT_SHA** (the exact *already reviewed and deployed* 40-char commit). Never print or paste secrets. Run:

```sh
check_env PRODUCTION_BASE_URL https
check_env PRODUCTION_READINESS_TOKEN min32
check_env ROLLOUT_MODE pilot
check_env EXPECTED_COMMIT_SHA sha40
check_env_equal PRODUCTION_BASE_URL APP_BASE_URL
npx tsx scripts/live-production-readiness.ts
```

The script calls the private deployment endpoint to verify the actual Vercel SHA, polls public surfaces, checks critical gates and writes `qa-artifacts/production-rollout-readiness.json`. **Do not invoke it as part of this source-only PR.** Note that the code's `verifySanitizedReadiness` helper is defined but `main()` uses `verifyDetailedReadiness`.
6. A protected GitHub Actions **secret** named **PRODUCTION_READINESS_TOKEN** must match the deployed Vercel **READINESS_TOKEN** exactly (not WORKER_TOKEN or any placeholder). Provision through the approved secret manager and never display or commit either value. [Workflow source](../.github/workflows/production-rollout-readiness.yml#L31) verifies minimum credential length before dependencies.
7. **Only if a human separately authorizes a later verification**, select Actions → **Production Readiness Report** (the actual UI name of the workflow file `production-rollout-readiness.yml`, sometimes referred to as *Production Rollout Readiness*), select the exact approved deployed ref, set the approved `base_url` and choose **`rollout_mode=pilot`**. This is a human workflow dispatch; none is authorized here. The workflow uses GitHub SHA as EXPECTED_COMMIT_SHA, which must equal the live deployment.
8. Retain the private workflow artifact **payrollph-production-rollout-readiness** at `qa-artifacts/production-rollout-readiness.json` along with the run URL, exact SHA and actual success/failure status. The current workflow retains the artifact for **7 days** ([source](../.github/workflows/production-rollout-readiness.yml#L64)). Save it only in a restricted evidence vault, not the repository or a public PR. An artifact is **not** a migration receipt, operational approval or launch decision.

## Published shared-demo credential: rotation and database separation (human-only)

Do **not** reproduce the publicly known demo login or password in documentation, tests, PR comments, examples or logs. Source locations to review (not credentials to copy):

- [README.md:72–78](../README.md#L72): published sandbox login instructions.
- [src/components/auth-screen.tsx:319–324](../src/components/auth-screen.tsx#L319) and [src/app/login/page.tsx:46](../src/app/login/page.tsx#L46): conditional login UI hint.
- [src/db/seed.ts:419–456](../src/db/seed.ts#L419): static demo seed and exported credential; its nonproduction DEMO_MODE guard is not proof of customer isolation.
- [src/lib/demo-security.ts:1–19](../src/lib/demo-security.ts#L1): known public-demo identity restrictions.
- [src/lib/operational-readiness.ts:108–116](../src/lib/operational-readiness.ts#L108) and [214–229](../src/lib/operational-readiness.ts#L214): checks the published review password against the stored account hash and checks demo mode; **do not weaken/remove the detector while the credential remains live**.
- [src/db/public-demo.ts:284–304](../src/db/public-demo.ts#L284): creates a public demo **tenant on the hosted application's database connection**. Tenant segmentation is **not** proof of a separate environment/database. Treat this as a NO-GO finding pending independent target attestation.

- [ ] Authorized identity operator revokes/rotates the known published credential via protected admin flow, revokes extant sessions/recovery access, and verifies the former password can no longer authenticate. No password value may be recorded here.
- [ ] In a **separate, reviewed source change** remove published password hints from README/auth UI and the fixed seed; preserve demo identity restrictions and the readiness detector's ability to catch still-active published credentials until rotation is actually verified.
- [ ] Independently attest **demo host/project/runtime DB host/branch/database/role** and **customer app + worker DB host/branch/database/role** in private, access-controlled records. Verify demo uses a **different environment and database**, not merely another tenant in the customer database. If targets overlap, **NO-GO**.
- [ ] Prove on a customer deployment DEMO_MODE=false and both `review-credential` and `seeded-credentials` readiness gates true; verify no customer dataset is reachable from demo personas. No release approval inferred.

## Differences from .env.local.example and gates

| Finding | Exact code and documentation mismatch | Required response (no gate bypass) |
| --- | --- | --- |
| APP_BASE_URL absent in example | `scripts/security-preflight.ts:50` requires explicit APP_BASE_URL, while `operational-readiness.ts:168` accepts a Vercel fallback; .env.local.example has no APP_BASE_URL. | Configure the actual HTTPS APP_BASE_URL; do not treat fallback as preflight. |
| Development example enables demo | .env.local.example uses **DEMO_MODE=true** for development; preflight demands exactly **false** for production; runtime gate tests only literal true. | DEMO_MODE=false; rotate public credential and prove isolation. |
| TOTP validity disparity | Production gate checks only configured(TOTP_ENCRYPTION_KEY); security preflight validates 32 decoded bytes (64 hex/base64). | Require strict 64-hex key in protected production secret manager; do not claim green from mere presence. |
| Scanner conditionality differs | Operational malware gate is ready when uploads are disabled; preflight unconditionally requires HTTPS MALWARE_SCAN_URL and 32+ byte MALWARE_SCAN_TOKEN, even if DOCUMENT_UPLOADS_ENABLED=false. | Report preflight **FAIL** unless a real approved scanner is configured; no dummy scanner URL or skip. |
| Preflight raw URL / MFA-value disclosure | `security-preflight.ts` currently prints the complete accepted APP_BASE_URL and MALWARE_SCAN_URL, and can echo an unexpected REQUIRE_PRIVILEGED_MFA value. An HTTPS scheme check alone accepts userinfo and query-string credentials. | **HOLD shared/CI execution and prohibit capturing raw output**, including internal scanner addresses. Follow the restricted-operator-only warning above until separately reviewed code redacts values at their source. This checklist does not cure the script. |
| Diagnostic token fallback differs | Security preflight uses operationalSecretSource, which accepts TOTP-derived worker/readiness tokens; readiness-diagnostics-token and remote-scheduler-token gates check **dedicated variable presence**. | Prefer dedicated WORKER_TOKEN and READINESS_TOKEN of 32+ bytes; PRODUCTION_READINESS_TOKEN must match deployed readiness secret. |
| Government-ID fallback is incorrectly described | `operational-readiness.ts:293` says a domain-separated fallback may exist, but `government-id-crypto.ts:9–18` requires dedicated PII_ENCRYPTION_KEY; .env.local.example explicitly says **no fallback**. | Provision dedicated 32-byte PII key. Keep inaccurate runtime wording on review list; do not claim fallback works. |
| MFA preflight under-validates | Security preflight accepts unset or malformed REQUIRE_PRIVILEGED_MFA as long as it is not exact false; the example uses a boolean. | Require exact true by operator check; no change to authorization gate in this PR. |
| Storage signal is not integration | Object-storage gate hardcodes storageIntegrated=false; it checks S3_BUCKET/R2_BUCKET for messaging. .env.local.example instead documents DOCUMENT_OBJECT_STORAGE_* service config. | Leave scale gate red until actual storage integration and separate privacy/security acceptance. |
| Live probe env is not in example | PRODUCTION_BASE_URL, PRODUCTION_READINESS_TOKEN, ROLLOUT_MODE, EXPECTED_COMMIT_SHA are read by live-production-readiness.ts, not documented in .env.local.example. | Supply only in protected operator/Actions context, not as publicly embedded values. |
| Workflow UI label differs | Actual workflow UI name is **Production Readiness Report** (.github/workflows/production-rollout-readiness.yml), not the colloquial “Production Rollout Readiness”. | Select actual workflow name; rollout_mode=pilot only after authorization, never now. |
| Billing/bank readiness can reflect credentials | Configured provider/bank endpoint keys influence descriptive readiness while real paid ledger, preflight and acceptance evidence remain separate. | Do not substitute credentials or JSON for actual settlement, filings, encrypted data proof or approved migration. |
| Production evidence remains outstanding | Operational issue pointers #112, #735, #899, #907, #908, #1043–#1045, #1198 and source PR pointers #1223–#1224 were read from GitHub; #908 was closed as completed on 2026-10-18 but closure alone does not demonstrate production role-isolation acceptance; they are not evidence of acceptance. | Human operator independently reconciles missing migrations/roles, bank data, government filing, demos and tenant isolation; release NO-GO. |

## Verification status

**Prepared only.** No source-runtime gate has been made green by this documentation. No production/Neon connections, SQL, migration, backfill, workflow dispatch, key provisioning, secret output, acceptance receipt or release approval was performed.
