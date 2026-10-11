# Critical release flags — registry v1 (A-7)

**Status:** code inventory / configuration hardening, NOT a release approval.

The typed registry in `src/lib/critical-release-flags.ts` lists release-critical booleans, accountable function and mandatory external evidence. Only exact string `true` enables a flag. Missing/typo/malformed values fail closed. The server scheduler and document-upload boundary consume the new typed gate; other legacy call sites still require deliberate staged integration.

| Flag | Owner | Default | Additional authorization required |
| --- | --- | --- | --- |
| CENTRAL_SCHEDULER_ENABLED | Operations | OFF | External monitor, scheduler lease/retry staging acceptance |
| WORKER_ENABLED | Payroll Operations | OFF | Synthetic worker exercise and controlled release |
| PAYMONGO_DISBURSEMENTS_ENABLED | Treasury | OFF | Payout recipient review, provider bank UAT, money-transfer authorization |
| DOCUMENT_UPLOADS_ENABLED | Security | OFF in production | Malware scanner, retention and virus quarantine validation |
| OPENAI_AUTOMATION_DRAFT_ENABLED | Privacy | OFF | Per-tenant opt-in, DPA, verified retention and notice |
| AUTOMATION_LANGUAGE_STUDIO_ENABLED | Security | OFF except isolated CI fixture | Governed staging postmerge acceptance |
| PILOT_FOCUS_NAV_ENABLED | Product | OFF | Individually allowlisted employer and UX review |

This is an initial **high-risk registry**, not a claim that all environment variables are typed. Before closing A-7, migrate and test every module-level rollout gate, establish expiry/retirement dates for temporary flags, and enforce a static diff gate that rejects unregistered boolean feature variables. Do not flip a production switch merely because the registry exists.
