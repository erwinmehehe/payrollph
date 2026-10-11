# Protected production verification: operator handoff

Status checked 2026-10-11. **This is a release configuration blocker, not a filing-code certification.** Source tests, approval of a production build, the exact deployment and an employer's payroll/agency acceptance are separate decisions.

## Current confirmed blockers

- GitHub Actions **Production Readiness Report** run [38140522276](https://github.com/erwinmehehe/payrollph/actions/runs/38140522276) failed because `PRODUCTION_READINESS_TOKEN` was empty. The previous **Live RBAC Sandbox Smoke** failed at the same missing-token preflight. Do not replace this authenticated check with an unauthenticated health probe.
- The linked Vercel project `erwinmehehe-payrollph` (team `payrollph`) has a Production environment variable named `READINESS_TOKEN`. **Only the variable's name/target were checked; its value was not read, copied, logged or changed.**
- The Git-backed production deployment for `675728fd1420c244a6d430f9019c5c954cfd6193` is **CANCELED** with an Vercel **Ignored Build Step** indicator. Production's `erwinmehehe-payrollph.vercel.app` alias points to an older deployment. A source merge does not prove deployment.
- Independent DBA, payroll, bank, security/DPO, government filing and release acceptance gates remain open. **Do not turn off the Vercel ignore-build hold or promote a production deployment merely to make CI green.**

## Steps requiring authorized administrators

1. **Confirm deployment authorization.** Select a tested, immutable `main` commit and record the release owner, DBA rollback/migration plan, security review and employer/pilot constraints. Keep GPS/scheduler/bank transfers and all other opt-in financial features disabled unless separately accepted.
2. **Configure protected GitHub verifier credential.** From the approved secret vault, obtain the already provisioned Vercel Production `READINESS_TOKEN`. An authorized GitHub repository administrator sets a GitHub Actions repository secret named **`PRODUCTION_READINESS_TOKEN`** to the **same value** (32 or more bytes). In GitHub, use **Settings > Secrets and variables > Actions > New repository secret**. Never paste credentials into a chat, issue, PR, CI log, workflow YAML, or support screenshot. Consider moving it to a reviewed, protected Actions environment with branch/reviewer controls in a separate change; current workflows reference the repository secret.
3. **Confirm target mapping.** The Vercel project must have the intended `READINESS_TOKEN` only on Production. The server validates it through a constant-time comparison at `/api/readiness/deployment`. Do not expose the token to npm installation, untrusted code, unauthenticated routes or Preview.
4. **Approve and complete a production deployment.** The Vercel Ignored Build Step currently cancels Git production deployments. A Vercel administrator must inspect **Project > Settings > Git > Ignored Build Step** and, **only after the release gate above**, stage an exact-SHA production build, verify it, and authorize promotion. Do not broadly reopen unsafe Preview/staging. Check Vercel Hobby build/cron constraints, migrations, deployed SHA and rollback before assigning live aliases. Follow `docs/engineering/vercel-hobby-release-gate.md` and `docs/preview-isolation-guard.md`.
5. **Run the private GitHub release checks.** From **Actions > Production Readiness Report > Run workflow**, select `main`, the approved HTTPS origin and `code` mode. Then manually dispatch **Live RBAC Sandbox Smoke** against the same SHA. Inspect sanitized artifacts; an older healthy alias must fail exact-SHA verification. Pilot/full readiness requires distinct business/security sign-offs and the necessary source state.
6. **Retain external acceptance separately.** A successful code-mode readiness check does **not** imply live payroll authorization, bank transfer proof, agency portal acceptance, BIR 2316 issuance or government-upload certification. Use `docs/ph-official-filing-acceptance-pilot.md` and the private `payroll:evidence:check`/`payroll:acceptance:check` workflow under issue #744.

## What this repository fix changes

- Both GitHub workflows now fail **before downloading dependencies** when the production verifier credential is absent or too short. They print a sanitized `BLOCKED` explanation without printing any credential.
- The credential is scoped to only the private verification step, not the job-wide environment or dependency installation.
- The production readiness script rejects missing token or invalid exact SHA **before polling public aliases**. It writes a non-sensitive blocked artifact and does not convert an unavailable deployment into a green result.
- Statutory remediation text no longer instructs operators to treat a PayrollPH reconciliation worksheet as a certified BIR/SSS/PhilHealth/Pag-IBIG upload.

**No credentials, deployment, production data, migrations or agency submissions are changed by this code update.** A failing manual production gate is intentional until the private credential, exact live deployment and required independent evidence exist.
