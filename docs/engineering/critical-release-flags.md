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

## Newly introduced direct-flag usage check (A-7 follow-up)

`A-7 New Release-Flag Registration Guard` checks PR and main commit source diffs for **new** direct `process.env.*_ENABLED` (also literal bracket and destructured) reads. A newly referenced flag must appear in `src/lib/critical-release-flags.ts` with its owner, risk and approval. The check is source-only and runs without production secrets, providers or databases; unknown flags fail the build. Existing legacy reads are not retroactively certified, and dynamic/computed environment names, flag retirement schedules, full module conversion and runtime human approval still require separate inventory and review. This guard never changes any flag value or permission.

## October 16, 2026 — A-7 literal-diff guard hardening (source only)

The release-flag guard now parses only actual top-level typed registry entries and refuses missing or empty owner, risk, approval or environment metadata, duplicate environment names, and stray unparsed environment fields. A comment containing a flag name cannot silently register it.

For newly added contiguous source-diff lines, it also detects line-split process.env property reads, optional chaining, quoted or static template-literal bracket keys, and multiline environment destructuring. Dedicated offline tests cover each case, scope isolation, malformed entries and duplicate flag names.

**Limits:** This is still a source-diff check for direct literal flag references. It cannot certify pre-existing direct reads, aliased/computed environment access, dynamic flag names, runtime activation authority, complete module-by-module registry conversion or temporary-flag expiry schedules. Those parts of A-7 remain open. No feature switches, production configuration, payroll behavior, database schema or payout settings are modified.
