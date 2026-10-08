# Controlled payroll pilot and general availability (GA) gates

**Last process update: 2026-10-08.** The automated payroll engine is substantially implemented. This file records required **evidence**, not a claim that employer-specific external sign-off has occurred. Real-money payroll remains **controlled pilot only** until the employer's independent release decision is documented.

| Gate | Status | Proof / exact procedure |
| --- | --- | --- |
| CI, TypeScript, golden payroll, pilot and security suites | Automated — re-run for candidate commit | GitHub workflow summaries and sanitized artifacts, matched to release SHA |
| Independent reconciliation (10+ workers, 2 real months minimum) | **Pending external employer evidence** | `payroll:parallel:check` + original approved inputs, canonical tax/GL bridge, independent checker |
| Mid-period hire, variable pay, 13th-month and final-pay review | **Pending independent sample sign-off** | Engine tests exist, but reviewer must validate real employer policies and samples |
| BIR 2316 / 1601-C / Alphalist | **Pending external validation and receipts** | 2316 reviewed sample; BIR output and required acceptance artifacts per actual filing workflow |
| SSS / PhilHealth / Pag-IBIG files | **Pending external agency acceptance** | Real employer file, current template and distinct portal acceptance |
| Controlled PayMongo/bank UAT | **Pending external bank test** | Owner/checker approval, low-value positive case, rejected case, reversal/failure reconciliation |
| Synthetic CI backup/restore rehearsal | Automated — new workflow | PostgreSQL 16 backup SHA, restored tables/records, tamper check, FK/rollback; not production proof |
| Encrypted production-like DR/rollback rehearsal | **Pending witnessed staging recovery** | Restore to isolated environment; verify payroll source and RPO/RTO against agreed objectives |
| Role separation, MFA, demo isolation | Automated controls plus **pending independent access review** | Current RBAC, approval snapshot and security suites; employer-specific role review |
| Privacy, retention, professional and final committee review | **Pending human sign-off** | Vault access, DPO/CPA review, exact source SHA and signed final release authorization |

## Evidence-driven release decision

See [Production payroll certification and controlled-GA gate](docs/payroll-certification/production-ga-gates.md). The private offline check combines:

- `payroll:parallel:check` — actual incumbent vs PayrollPH reconciliation, no PII output.
- `payroll:evidence:check` — external reviewer, government acceptance, positive/negative bank proof, all hashes.
- `payroll:ga:evidence` — employer/month alignment, 10-worker threshold, independent operational proof, RPO/RTO, release SHA, role separation.

A successful combined output says **`evidence-ready-for-independent-final-review`**, explicitly **`gaApproved: false`**. A named employer representative and an independent reviewer must authenticate underlying receipts/signatures and sign the final decision outside automated CI. No fake government, bank, or production recovery outcomes may be substituted.

Commercial demo/marketing availability is **not** proof of live payroll GA.
