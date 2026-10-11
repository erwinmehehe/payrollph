# PayrollPH change-risk and merge policy

Purpose: move verified source fixes quickly without confusing **merging code**, **enabling a deployed feature**, and **executing real payroll or money movement**. This policy deliberately has **no blanket independent GitHub review/approval requirement** for pull requests. The repository owner/authorized maintainer may review and merge their own change when its actual merge checks and acceptance criteria pass.

## Merge requirements by change risk

| Tier | Scope | Code merge gate | Activation / live operations gate |
| --- | --- | --- | --- |
| T0 — low | Documentation, copy, non-executable assets | Owner decision; applicable checks; no outside reviewer | Ordinary release process |
| T1 — standard | UI and non-sensitive application logic | Current-head CI, relevant behavior tests, owner diff check; **no mandatory independent reviewer** | Functional smoke/rollback if deployed |
| T2 — sensitive | Payroll/WFM calculations, identity, privacy, worker workflows, AI automation | Current-head CI, applicable CodeQL/security/domain tests, focused owner diff check and recorded rollback; **no automatic second-person PR approval** | Synthetic staging and domain-specific acceptance before sensitive features are enabled |
| T3 — financial/structural | Bank/payout, financial ledger, compensation controls, DB schemas/migrations and recovery | Current-head CI, isolation/golden/security/DB tests as applicable, owner diff check, dependency and migration plan; **no blanket independent GitHub approval** | Authorized rollout/restore evidence; live migration, historical encryption backfill, provider billing, payroll release or transfer requires its own documented operator/financial controls |

Automated classification is advisory and may be raised when the *behavior* is riskier than the filenames. Do not silently bypass failed checks or reclassify dangerous code to T0/T1 to merge it.

## A code merge is not live payroll approval

1. **Source merge:** Maintainer can self-review and merge a PR after required current-head checks pass and its incremental diff, dependencies and overlap are understood. External review is optional unless a specific legal, contractual or environment requirement actually applies. Do not invent a review, screenshot or staging result.
2. **Staging/feature enablement:** Verify affected behavior with synthetic tenants, role/authorization boundaries, rollback controls and recorded operator acceptance. New payroll, HR, scheduler, provider and AI capabilities remain disabled by default until specifically authorized.
3. **Production payroll or payout:** Preserve strict business maker/checker/releaser separation where the application requires it. Employer authorization, bank/provider acceptance, statutory/financial reconciliations and operational recovery evidence cannot be replaced by a self-reviewed PR or green CI.
4. **SQL/bank migration:** A merge must never automatically apply live schema changes, decrypt/re-encrypt existing private bank records, run a live financial recovery, or turn on money movement. DBA/migration owner must validate the applied journal, staging restore and migration runbook before execution.
5. **Source evidence:** Record PR SHA, risk tier, relevant checks, tests, overlapping/dependent PRs, intended flags and rollback. Name external reviewers only when a review truly occurred; do **not** require a reviewer field for every PR.
6. **Recheck new heads:** Any rebase, merge conflict resolution or additional commit invalidates old-head green evidence. Rerun applicable CI and inspect the changed behavior.

## Current integration priorities

- **#741 client-IP limits:** Test Vercel/proxy provenance and rate-limit behavior, then merge when current-head checks and maintainer diff verification pass; no blanket independent approval.
- **#740 scheduler cron:** Source may be merged following applicable CI; keep scheduler disabled until authorized secret provisioning, synthetic staging tick/heartbeat and rollout proof.
- **#723 followed by #724 bank encryption and payment snapshots:** Resolve dependency order, protected-payroll isolation, exact-head tests and changed write paths before source merge. **Never** treat code merge as proof historical stores are encrypted or as authorization for real payout.
- **#720/#721/#739 financial overlaps, #743 payroll-money rules, #745 provider-event inbox:** Review integration diffs, unique SQL migration reservation and behavioral/golden test effects. Never bulk-merge overlapping implementations or use a draft PR as a substitute for operational certification.
- **HCM/WFM pilots:** Separate optional feature work from the first paying-customer payroll pilot. An unmerged/deferred branch is not delivered code.

## Workflow enforcement

GitHub's branch ruleset is currently absent. The PR Queue Gate enforces a maximum of three *review-ready* PRs and checks SQL reservations; it **does not require external reviewers**. Use branch protection primarily for current-head CI, CodeQL, security/isolation checks and safe changes to main, rather than a universal approval-count gate.

`.github/workflows/pr-change-risk.yml` remains a read-only advisory classifier. Neither that job nor the queue job grants or fabricates approval. Live payroll authorizations remain separate from PR operations.
