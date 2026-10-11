# Open issue reconciliation — October 11, 2026

Reviewed baseline: `d7211a2b1a26234daaccdd58867891607738c04a`.
The open-issue search returned 33 issues. This inventory is a source-status
reconciliation, not closure evidence or permission to activate live services.
Historical issue wording can refer to PRs that have since merged. The current
change-risk policy permits maintainer source review without a universal second
GitHub reviewer; explicitly requested operational reviews remain unevidenced.

## Confirmed fixes in this branch

- HR Work Queue previously retained rows, owners and its editable case across
  employer/filter changes. The mounted queue now belongs to an exact scope.
  Changing scope removes its data/editor immediately. Reads and selected-case
  history are aborted and callback results check the signal even if the transport
  ignores abort. A save finishing in a retired view cannot refresh the new view.
- Refresh hides the preceding queue result; failures clear success and show
  unavailable status. Initial loading is no longer labelled an empty queue.
  History loading, unavailable history and genuinely empty history are distinct.
- People Operations Inbox binds results/errors to employer, all filters and
  refresh identity during render. My Team and Worker 360 already had this
  binding; their redundant synchronous loading resets are removed.
- Four resolved effect-state counts are removed from the native ESLint bulk
  suppression file (99 remain on this baseline). No lint rule is disabled.
- Native ESLint still runs with bulk/unused-suppression checks. A file/rule
  warning baseline fails on new/increased warnings. The 16 existing warnings
  remain debt; this is not a zero-warning or zero-suppression claim.
- A separate Chromium check uses the actual React components in StrictMode,
  with deferred synthetic fetches that deliberately ignore abort. It exercises
  employer/filter switches, stale history, retired save completion, refresh,
  failure clearing and HCM loading/error transitions. It is client-lifecycle
  evidence, not authenticated server, employer or production acceptance.

## Complete open-issue register

| Issue | Current source evidence / remaining requirement |
| --- | --- |
| #774 | This branch removes four HCM effect counts; #782 separately addresses four WFM loads. Remaining effect/request lifecycle work and existing warnings stay open. Resolve suppression-file overlap when integrating. |
| #744 | Master re-audit, not one defect. #765, #759, #723/#724, #745/#771, #742, #750–#753, #755/#768/#773 and other main commits cover multiple slices. Migration mechanism, object-storage migration, DB tenant backstop, remaining module splits and full UX/flag work are not completed by this branch. Live evidence checkboxes remain open. |
| #737 | Main branch fetched as unprotected with no required-check enforcement. Integration cannot administer protection. Repository administrator must configure/verify non-destructive refs and applicable checks. No universal reviewer-count requirement. |
| #735 | Encryption and release-separation source #723/#724 is merged. Four-store live current-key scan, protected key provisioning, backfill/rotation/rollback, real authenticated SoD and operator evidence remain. |
| #734 | Future HCM real-employer activation review. It explicitly is not a pre-client source-merge gate. HR/privacy/security/accessibility and operator receipts are not fabricated. |
| #725 | My Team source is present and connected by #773. Current contract is a scoped directory with pending record counts, not the original direct-report-only proposal. Verify current scope/privacy and product requirements; don't claim every original checkbox is implemented. This branch fixes its effect lifecycle only. |
| #712 | Bounded read-only Process Monitor #768 is connected by #773. HR interpretation, accessibility and actual employer activation remain separate. |
| #709 | Organization/position explorer remains a proposed/deferred slice. No explorer delivery is claimed here. Respect the core-pilot product freeze before expanding it. |
| #700 | Tenant/worker/as-of bounded Worker 360 source and #773 navigation are present. This branch removes a redundant loading effect; historical completeness and employer acceptance remain unevidenced. |
| #695 | Dedicated server-minimized People Home worklist #755 and source-backed #773 are present. Validate its tenant/bounded-source contracts and customer use. The broader People Ops source still needs its own bounded-loader review; client pagination alone doesn't prove bounded SQL. |
| #692 | People Home/My Tasks #755/#773 is connected. Source workflow owners remain authoritative. Complete real operator UX acceptance before broad activation. |
| #691 | WFM cross-role/shift-to-pay acceptance is not supplied by source merges. #766 and other synthetic tests cover engineering scenarios. Actual manager/HR/payroll reviewer/device receipts remain. |
| #687 | ESS and signup/billing code exists. Merchant activation, provider recurring-payment/retry/cancellation proof, privacy/terms, encrypted photo operations, actual onboarding and recovery remain. Keep external billing activation gated. |
| #678 | Core WFM scheduling/live-floor/roster changes are merged; #782 handles a read-lifecycle batch. Smart-scheduling roadmap depth, mobile/device reliability and operator acceptance remain. |
| #674 | Historical queue counts are stale. At review, #781 and #782 were review-ready; #780 was draft. This source branch must stay within the three-ready cap; no bulk merge or independent-review fiction. |
| #671 | Source leave/lifecycle changes are integrated. Human HR/bookkeeper workflow acceptance is still not evidenced. Revalidate source regressions against current main rather than obsolete draft heads. |
| #665 | Historical SQL collision was reconciled by integrated migrations/loan controls. This does not prove the live applied journal or authorize deductions. Actual DBA application/rollback and employer loan acceptance remain. |
| #664 | Scheduler provenance source is merged. Explicit post-merge human security assessment is not recorded here; scheduler runtime proof belongs to #637. |
| #641 | A governed backdated salary **preview** exists (`hcm-salary-correction-preview.ts` and preview route/tests). Full approved, idempotent financial correction execution with immutable historical runs remains distinct outstanding work. |
| #637 | Cron/worker/lease source and telemetry are merged. #780 separately addresses the Hobby cron deployment configuration. Neither is automatic-tick, restart, two-worker or missing-tick alert proof. |
| #630 | Compensation atomic activation/schema/rehearsal source is integrated. Security/DBA/privacy and actual employer activation evidence remain separate. |
| #629 | WFM premium-boundary and payroll-blocking source/test work is merged. A real payroll officer's app reconciliation is not claimed. |
| #622 | Live-model/provider activation remains off pending actual isolated provider, consent/contract/retention and privacy evidence. Source and synthetic tests cannot replace it. |
| #621 | Automation source is merged and #742 adds fail-closed processor/tenant consent gates. Explicit human intent-fidelity/security assessment is not recorded here. |
| #601 | Multi-module HCM epic with integrated foundational flows. Send-back/rescind, full analytics/identity certification and broader hire-to-exit parity are not all delivered. Keep roadmap and activation evidence open. |
| #581 | Governed Change Job/BP foundation and read-only monitoring are present. Parallel/conditional steps, correction/rescind and broader routing need distinct scoped work. |
| #579 | Requires an authorized real employer period and independent employee-by-employee reconciliation. No real payroll data was accessed or money moved in this work. |
| #194 | Product roadmap/master direction. Numerous checked-off capabilities exist; deeper cross-functional execution and external certification remain. It is not an issue to close with one patch. |
| #191 | Existing `compliance-rules-registry.ts` and tests supply a registry foundation. Full reviewed/approved statutory source/version evidence and trace coverage need agency/payroll review; no legal validation is inferred. |
| #190 | Six vertical packs are explicitly deferred until common core stability and customer need. They are not implemented by this remediation and should not bypass the core-pilot freeze. |
| #189 | Approval, delegation, SoD, OIDC/SCIM and enterprise controls foundations exist. SAML runtime remains disabled pending signed assertion/replay and real identity-provider acceptance. |
| #188 | Existing labor-costing and GL dimensions/reporting supply core foundations. Vertical-specific allocation/reporting and employer accounting reconciliation remain roadmap/acceptance work. |
| #187 | Existing versioned pay-policy engine and phase-3 golden suite supply foundations. Complete company/CBA rule acceptance and deterministic trace reconciliation remain customer-specific work. |
| #112 | Production key/security, four-store encryption, delivered transactional email, live personas, employer reconciliation, provider/government receipts and readiness evidence remain. Do not close because synthetic CI passes. |

## Review and rollback

Risk T2: tenant visibility and HCM client request ownership; no server permission,
financial calculation, SQL, key, feature flag or production data changes. Revert
this source commit to roll back. Source review must retain the role/tenant checks
in the owning APIs and financial maker/checker controls.

The current baseline and this branch must be checked separately. Changing a
commit invalidates its prior CI receipt. This document deliberately makes no
claim that all open issues are fixed. Administrator/provider/employer evidence
and deferred implementation work cannot be invented as closure receipts.
