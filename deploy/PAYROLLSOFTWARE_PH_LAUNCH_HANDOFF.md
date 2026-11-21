# payrollsoftware.ph — launch preparation and operator handoff

> **Preparation only — production NO-GO.** This document records read-only observations made on **2026-11-21** and the order of work to perform **after** the named owner approves each change. It is **not** permission to purchase a domain, alter DNS, enable a feature, deploy an unreviewed commit, change database targets, execute production SQL, process live payroll, or move funds. Recheck every observation before acting. Do not paste credentials, tokens, personal details, bank data, or government identifiers into a PR, issue, chat, or build log.

## 1. Current inventory — reuse; do not duplicate

| Area | Observation on 2026-11-21 | Required conclusion/action |
| --- | --- | --- |
| Code | GitHub `erwinmehehe/payrollph`; main at `939d18c81a24f3fe31090150713a54e2073526be`; Next.js, PostgreSQL and Drizzle | Use an exact reviewed main commit for any eventual release; do not merge unfinished feature branches as a shortcut |
| Hosting | Vercel team `payrollph`, project `erwinmehehe-payrollph`, id `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`; GitHub already connected | **Do not create a second Vercel project** |
| Production | Latest inspected deployment `dpl_AuFMF7rcvBaHt6ypqCDfc9y3YczY` (`main@939d18c`) was **ERROR** with `One or more integration resources failed to provision for this deployment.`; no build events were returned | Resolve existing [issue #1974](https://github.com/erwinmehehe/payrollph/issues/1974) at the integration/provider layer before any controlled production retry; a new domain or mail key is not by itself the fix |
| Domain | Both `payrollsoftware.ph` and `www.payrollsoftware.ph` are already attached to the project and show *project verification*; `www` is configured to redirect (308) to the apex | **Do not add duplicate project-domain associations.** Project verification does not prove a registrar purchase, registrar ownership, or working DNS |
| Authoritative DNS | Vercel reports `serviceType: external`, no Vercel-owned DNS zone, and `misconfigured: true`; an existing apex A address does not match the currently recommended Vercel records | Domain purchaser must first confirm registration/ownership with a legitimate `.ph` registrar, then make records at the **actual authoritative DNS host** using the **current project-specific Vercel instructions**. Avoid guessing records from this document |
| Resend | Vercel production environment inventory includes the **name** `RESEND_API_KEY` (and `RESEND_EMAIL_DOMAIN`), but no secret value was inspected; delivery/domain verification not demonstrated | Reuse and validate the existing credential through the authorized provider/secret manager, rather than creating a second key without cause |
| Plan | Hosting team is on Vercel **Hobby** as inspected | Vercel Hobby is non-commercial; the responsible operator must move the existing team to an eligible paid plan **before a commercial deployment**: https://vercel.com/docs/plans/hobby |
| Source release flags | `vercel.json` only enables Git deployment from `main`; all other patterns are disabled | Preserve this release hold; a PR or documentation commit is not permission to deploy |
| Deployment protection | Current Vercel project reports authentication enabled with `deploymentType: all_except_custom_domains` | **Custom production domains are not protected** by the current scope; before a private hosted UAT, independently enable and verify full deployment protection. Decide on public exposure only as a separate launch act. Vercel's 2026 protection controls must be checked in the current dashboard |
| Payroll acceptance | `PILOT_GATES.md` records independent payroll/agency/bank/restore and owner review as outstanding | No customer payroll GA or live payment/filing authorization |

## 2. Release lanes — distinguish website from payroll

**Lane A: marketing / demonstration only.** After domain ownership, DNS, provider, hosting and security approvals, the public homepage, sales material, booking and an **isolated synthetic demo** can be evaluated for an appropriate commercial launch. Keep real employer/employee payroll, transfers, filings, and unreviewed AI features out of this lane. Any demo must be isolated from the customer production database and its credentials; do **not** turn on `DEMO_MODE` against the customer production database. Follow `DEMO_LAUNCH_CHANGES.md` plus current security/privacy review, not a generic demo-mode switch.

**Lane B: real employer payroll controlled pilot / GA.** Requires separate named employer, payroll accountant/tax reviewer, DPO/security sign-off, exact source SHA, two-month parallel reconciliation, valid official filing outputs and agency receipts, bank acceptance/rejection UAT, backup/restore rehearsal, documented approval chain, and actual provider/worker tests. See `PILOT_GATES.md`, `MANUAL_LAUNCH.md` and `docs/payroll-certification/production-ga-gates.md`. Automated source-only or fictional CI passes do **not** count as external acceptance.

## 3. Domain acquisition and DNS handoff

1. **Registrant/owner:** Ask the chosen `.ph` registrar to confirm whether `payrollsoftware.ph` is available, already registered, or belongs to the intended business before paying. The Vercel association is **not** proof of purchase; the Vercel registration API did not establish availability. Save the receipt, registrar account owner, renewal date and DNS access privately.
2. **Do not overwrite unrelated records:** Identify the authoritative DNS provider from the **registrar's actual delegation after registration**. The nameservers Vercel currently displays for the unconfigured domain also appear in IANA's delegation for the entire `.ph` top-level domain; they must **not** be assumed to be this business domain's own DNS provider. Export existing DNS/TTL/MX/TXT configuration privately before editing. No live DNS change is authorized by this document.
3. **Website routing:** In existing Vercel project > Settings > Domains, recheck exact apex A/ALIAS and `www` CNAME recommendations and verification status. At the actual authoritative DNS host, publish **only** the reviewed project-specific records. Keep `www` -> apex redirect. Do not guess A or CNAME values, and do not switch nameservers merely to avoid correcting a record.
4. **Email routing:** Maintain separate DNS entries for Resend sending verification (SPF/DKIM, recommended DMARC); do not delete MX records for any human inbox and do not create duplicate SPF policies at the same hostname. Take exact values from the verified Resend domain's dashboard; no arbitrary filler TXT values.
5. **Validation:** Confirm fresh authoritative DNS, correct HTTPS certificate, apex URL, `www` redirect, expected Vercel commit and no public secrets. Re-run verification after propagation. Do not open customer registration or invite flows until the final approved launch stage.

## 4. Vercel provisioning blocker — first technical priority

The latest production build failed **before application build logs**, with a provider/integration provisioning error. The production project and the expected main SHA are already identified, but this evidence does **not** identify Neon (or any specific integration) as the cause.

Operator steps:

1. Open [the latest deployment](https://vercel.com/payrollph/erwinmehehe-payrollph/AuFMF7rcvBaHt6ypqCDfc9y3YczY) in team `payrollph`; inspect full error details, Resources and Integrations. Record the exact resource identifier privately.
2. If the UI has no actionable provider reason, contact Vercel Support with **project** `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`, **deployment** `dpl_AuFMF7rcvBaHt6ypqCDfc9y3YczY`, **commit** `939d18c81a24f3fe31090150713a54e2073526be`, and error string. Ask which integration and resource failed provisioning and what the non-destructive fix is.
3. Verify provider authorization, availability, plan/billing and integration access with its admin. **Do not disconnect/swap/repoint the production database or recreate Neon resources.** Coordinate with GitHub issues [#899](https://github.com/erwinmehehe/payrollph/issues/899), [#1061](https://github.com/erwinmehehe/payrollph/issues/1061), and [#1974](https://github.com/erwinmehehe/payrollph/issues/1974).
4. After the identified root cause is resolved, request an **independently authorized** exact-commit controlled deployment; confirm `READY`, protected `/api/readiness/deployment` matching SHA, and supported smoke/rollback tests before any domain traffic switch or product activation.

### Vercel Support message (copy into a private support ticket)

**Subject:** Production deployment blocked before build — integration resource provisioning failure

We have an existing Vercel project `erwinmehehe-payrollph` in team `payrollph` (project ID `prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh`). Deployment `dpl_AuFMF7rcvBaHt6ypqCDfc9y3YczY` for GitHub `erwinmehehe/payrollph`, main commit `939d18c81a24f3fe31090150713a54e2073526be`, reports: "One or more integration resources failed to provision for this deployment." No build events are present. Please identify the **exact integration/provider/resource ID**, the provisioning-stage failure reason, and a safe remediation path that **preserves the existing production PostgreSQL database and credentials**. We will not reconnect or recreate production resources without a separately reviewed recovery plan.

## 5. Resend transactional email — existing code, unverified live delivery

Repository source already has a Resend adapter in `src/lib/mailer.ts`, an outbox ledger and signed provider-event endpoint in `src/app/api/webhooks/resend/route.ts`. **Do not build another adapter.** The sender label still defaults to `Linaw` if `MAIL_FROM` is absent.

**After domain control and infrastructure repair:**

1. In the intended Resend account, add and verify `payrollsoftware.ph` (or a separately approved sending subdomain). Obtain its exact SPF/DKIM and optional DMARC instructions. Publish them at the authoritative DNS host without breaking website or inbound mail; verify sender domain in Resend.
2. Authorize proposed sender `Linaw <no-reply@payrollsoftware.ph>` (or a final brand-approved name); set **`MAIL_FROM`** only after sender verification. Do not assume the repo-facing project name means the product was rebranded.
3. In the **existing** Vercel project, verify the **presence, proper environment scope and validity** of `RESEND_API_KEY`. No token value should be copied into a PR or support ticket. Configure `RESEND_WEBHOOK_SECRET` via the secret manager; do not use `POSTMARK_SERVER_TOKEN` or `SMTP_URL` concurrently unless a deliberate provider switch was reviewed.
4. In Resend, create a **signed** webhook to `https://payrollsoftware.ph/api/webhooks/resend`; include supported delivered, delayed, bounced, complained, failed and suppressed events using the provider's current UI. Retrieve the provider-issued signing secret into protected Vercel production configuration.
5. Once a **reviewed production or isolated staging environment** is healthy, send **one consented invitation/password reset to an owner-controlled test inbox**. Verify: email arrives, HTTPS link uses the intended host, outbox shows provider acceptance, Resend sends the signed event, app stores **provider-confirmed delivered**, and no token appears in HTTP responses or logs.
6. Read the authenticated `/api/readiness` email-delivery gate. A configured key or API acceptance alone is not sufficient. Never send test emails to real customers without approval.
7. Separate choice: a `support@payrollsoftware.ph` human inbox is **not** automatically created by Resend's outbound email service; procure/configure an inbox and its MX records separately if business support email is required.

## 6. Secure environment checklist (names only, no values)

Review existing `deploy/PROD_ENV_CHECKLIST.md` and `.env.local.example` before entering credentials into the **correct Vercel project and protected environment**. Do not infer a key is missing simply because a paginated inventory omitted it.

- Approved HTTPS production origin `APP_BASE_URL=https://payrollsoftware.ph`; exact `TRUSTED_APP_ORIGINS` only if separately reviewed.
- Privileged auth secrets: `TOTP_ENCRYPTION_KEY`, `SETUP_TOKEN`, `READINESS_TOKEN`, `WORKER_TOKEN`, and `REQUIRE_PRIVILEGED_MFA=true`; all independent, protected, sufficiently strong.
- Sensitive employee records: `PII_ENCRYPTION_KEY`, `BANK_DATA_ENCRYPTION_KEY`, and separate role-specific `DATABASE_URL` targeting the **already attested** serving database. Do not rotate live keys, backfill, migrate, or replace connection strings from this runbook.
- If the production security preflight requires scanner settings, use the actual authorized scanner endpoint and separate `MALWARE_SCAN_TOKEN`; keep uploads disabled until its malware scanning and private storage are independently validated.
- Transactional mail: `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_WEBHOOK_SECRET` and verified sending domain. Validate full webhook delivery before declaring ready.
- **Explicitly OFF until separately signed off:** `DEMO_MODE=false` for customer production, `WORKER_ENABLED=false`, `CENTRAL_SCHEDULER_ENABLED=false`, `PAYMONGO_DISBURSEMENTS_ENABLED=false`, `DOCUMENT_UPLOADS_ENABLED=false`, `SAFE_OTEL_ERRORS_ENABLED=false`, and optional AI/automation feature flags. Verify other rollout flags remain default-off; avoid an indiscriminate copy of local-dev env values.
- GitHub environment verifier must be provisioned by the authorized operator for the **exact approved deployment**: `PRODUCTION_BASE_URL`, `PRODUCTION_READINESS_TOKEN`, `EXPECTED_COMMIT_SHA`, `ROLLOUT_MODE`. A source CI pass is not proof that the public URL serves that source.

## 7. Final test and acceptance checklist — do not self-certify

- [ ] Domain ownership documented and registration/renewal under business control, not inferred from Vercel verification.
- [ ] Appropriate **commercial** Vercel plan approved; existing project reused.
- [ ] Vercel integration provisioning root cause identified, repaired and independently accepted; issue #1974 handled.
- [ ] DNS, HTTPS, apex and `www` redirect verified without loss of inbox/MX records.
- [ ] Before private UAT, verify Vercel deployment protection also applies to the **custom production domain**; do not rely on protection of generated preview URLs only.
- [ ] Exact GitHub commit approved; required CI/security checks green; deployment metadata matches that commit.
- [ ] Resend domain verified, sender approved, webhook signed and delivered event actually reconciled.
- [ ] Security preflight and protected readiness checks passed against the correct environment; secrets are not exposed; PII/bank encryption, RBAC/MFA and tenant isolation independently verified.
- [ ] Backups, restore, error and uptime monitoring validated with a named owner; private vulnerability contact in `SECURITY.md` is no longer `TODO-OWNER`.
- [ ] Any public marketing/demo release checked for privacy, correct non-payroll claims and explicit separation from live customer processing.
- [ ] For **real payroll only**, independent specialist/employer evidence and the named final payroll release authority recorded outside CI. NO-GO until `PILOT_GATES.md` is satisfied.

## Related repo references

- [Open deployment blocker #1974](https://github.com/erwinmehehe/payrollph/issues/1974)
- [Existing security and production environment checklist](PROD_ENV_CHECKLIST.md)
- [Existing monitoring and on-call setup](MONITORING_SETUP.md)
- [Existing restore runbook](BACKUP_DR_RUNBOOK.md)
- [Manual pilot playbook](../MANUAL_LAUNCH.md)
- [Actual payroll acceptance gates](../PILOT_GATES.md)
- [Security policy requiring private reporting contact](../SECURITY.md)

**Acceptance state as of 2026-11-21: PREPARED HANDOFF ONLY / PRODUCTION NO-GO.** All operator purchases, provider credentials, DNS updates, live deployment, real bank/email/customer operations, and final payroll certification remain unperformed unless separately verified by explicit evidence.
