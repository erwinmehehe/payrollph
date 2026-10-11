# Vercel Hobby deployment and central scheduler gate

## Release boundary

The Vercel project `erwinmehehe-payrollph` belongs to team `payrollph`, currently on the **Hobby** plan. Its previous `vercel.json` registered `/api/jobs/cron` every five minutes. Hobby does not support that frequency, preventing deployment of the production branch.

This change removes **only the Vercel Cron registration**. It does not change payroll, HR, compensation, statutory, bank/payment, audit, worker, or scheduler business logic; it does not delete `/api/jobs/cron` or `/api/jobs/tick`.

**Operational assertion at review time (2026-10-11):** The Vercel production environment had no `CENTRAL_SCHEDULER_ENABLED` or `CRON_SECRET` variable. The scheduler is separately gated by `criticalReleaseFlagEnabled("centralScheduler", env)` (exact true required), and the cron endpoint requires a valid configured secret. It returns an error when either gate is absent. Therefore, removing the unsupported cron registration does not interrupt a currently enabled central scheduler.

This is a deployment-configuration compatibility fix, **not activation of background automation**. While the central scheduler remains off, no one should rely on automated HR, salary, statutory, marketing, or retention jobs. Other dedicated payroll worker paths are separately controlled.

## Before enabling a five-minute central scheduler

1. Upgrade the Vercel team to a tier that supports the reviewed five-minute schedule, **or** approve and separately secure a reliable external scheduler with equivalent operational coverage.
2. Reintroduce the five-minute `crons` entry in a reviewed change and prove the deployment tier permits it.
3. Set a strong `CRON_SECRET` and explicitly approve the `CENTRAL_SCHEDULER_ENABLED=true` release flag. Confirm that `WORKER_ENABLED` does **not** enable central scheduling by itself.
4. Rehearse concurrent invocations, database lease fencing, failures and partial-run recovery, alerts, rate limits, retention controls and side-effect safety before activation.
5. Record a separate operations/security approval for all scheduled financial and HR side effects.

## Independent production gates still required

This configuration fix is **not** permission to push unvalidated code to customers. Keep release blocked until all applicable checks pass:

- A reviewed, stable, exact `main` SHA with passing CI/golden payroll/security/browser checks.
- DBA evidence of applied migration receipts, checksums, schema compatibility and tested rollback. Repository migration guards and CI's ephemeral `db:push` are **not** production migration proof.
- Verified production bank encryption/backfill and secrets, and independent employer-specific payroll release sign-offs where required.
- A staged build, production readiness smoke, deployment SHA verification and observation before assigning live domains.
- An approved rollback plan that doesn't replay or duplicate payroll releases or bank payouts.

See `docs/engineering/sql-migration-release-protocol.md` and `docs/payroll-certification/production-ga-gates.md`.

## Rollback

If the release requires a live five-minute scheduler, **do not** simply restore the prior `vercel.json` on Hobby: the unsupported cron prevents deployment. Obtain the appropriate plan/external scheduler and separate operations approval first.
