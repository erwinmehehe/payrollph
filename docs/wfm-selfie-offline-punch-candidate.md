# WFM optional selfie + offline punching: candidate, feature disabled

This **draft review-only** candidate follows the WFM-12 rules branch. Do not migrate `drizzle/0116_wfm_selfie_offline_receipts.sql` until `0115` is reviewed and applied. Both feature flags default off.

## Gating and use
- `WFM_PUNCH_PHOTO_EVIDENCE_ENABLED=true` separately enables the opt-in employee image evidence UI/API. `DOCUMENT_UPLOADS_ENABLED=true`, malware scanner and `PII_ENCRYPTION_KEY` are required before uploads work.
- `WFM_OFFLINE_PUNCH_QUEUE_ENABLED=true` separately allows offline IndexedDB evidence. Use `PII_ENCRYPTION_KEY` to derive only a pseudonymous device token hash; no raw GPS.
- Each consent covers the stated single purpose, default 90-day encrypted photo retention, and a worksite policy. Decline is accepted and never triggers automatic rejection/deduction.
- Dedicated photo purge runs in the existing leased daily retention task (when central scheduler separately enabled) with legal-hold exclusions, up to 100 per pass. Validate purge throughput, lag, backup expiration and DPO policies.
- Offline IndexedDB queue preserves client tap timestamp and random token; server receipt adds server-received timestamp. Skew > configurable `WFM_OFFLINE_SKEW_MINUTES` (default five), device reuse, impossible cross-worksite speed become **advisory** flags.
- All offline events go to `pending_review`; the HR review page is `/workspace/offline-punch-review?organizationId=<id>`. Even `reviewed` does not write `time_punches`. A separate existing HR attendance-correction approval is required.
- Photo evidence is encrypted AES-256-GCM and referenced by UUID; image evidence is solely for human inspection. No automated face comparison. No user raw GPS history is retained.

## Acceptance not run
Execute `TZ=Asia/Manila npx tsx --test tests/wfm-selfie-offline-punch.test.ts`, `npx tsc --noEmit`, `npm run lint`, golden payroll and complete TZ=Asia/Manila suite plus security/privacy, employee/mobile offline, cross-tenant/cross-entity and 90-day retention/purge UAT. Live migrations and scheduler activation require DPO/SRE authorization. IDB local data erasure at logout requires device acceptance.
