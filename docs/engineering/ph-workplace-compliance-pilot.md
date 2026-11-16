# Philippine Workplace Compliance pilot: DOLE, OSH/training, protected investigations

**State: source implementation ONLY. NO production activation, migration, genuine employee data, agency submission, or legal certification.**

This branch adds three strictly default-OFF capabilities. They deliberately do not change payroll, existing 13th-month reports, banking, or ordinary HR cases.

## 1. Extended DOLE reporting

Employer console: /workspace/workplace-compliance?organizationId=APPROVED_ID.

API: /api/compliance/dole-extended (GET, POST, PATCH).

Tracks employer-scoped source evidence for Work Accident/Illness Reports, telecommuting, flexible work, construction safety, labor inspection and other DOLE submissions. The state flow is draft -> submitted_recorded -> accepted_recorded/rejected_recorded -> independently_reviewed. The separate human review requires a different user and the original receipt reference plus SHA-256. **An operator's entered agency outcome is not official verification**. The app never submits a filing to DOLE, does not infer statutory deadlines, and does not call a worksheet an agency upload template.

## 2. OSH incidents, corrective action, and training proof

APIs: /api/compliance/osh-events and /api/compliance/osh-training.

The incident register holds a worksite label, civil date, category, severity, corrective-action reference and evidence hash; it has no medical narrative or diagnoses. A separate authorized reviewer must close a case with private evidence. The training register tracks exact worker identity, course type/title, completed and optional expiration date, protected evidence hash and independent review. An employer's OSH officer decides legally required courses, risk categories, reporting duties, proof, and expiry rules; the software does not make those determinations.

## 3. Encrypted protected complaints and case officers

Employee page: /self/workplace-concern (authenticated employee identity only; no query-selected employer or worker).
APIs: /api/workplace/case-officers and /api/workplace/protected-cases.

An independent Owner/Admin must appoint named company-member intake officers (no self-appointment). Any employee can create a case assigned to an active approved officer; statements are encrypted with purpose-derived AES-256-GCM and a required PII_ENCRYPTION_KEY, with rotation via PII_ENCRYPTION_KEY_PREVIOUS. The case list is metadata-only. One statement is decrypted and returned only after a separate, deliberate caseId request by the creator or a currently active named investigator/reviewer (staff requests require recent privileged MFA). Creator, investigator and final reviewer cannot be the same person for final case closure. Restricted audit events contain metadata only, not allegation text or case category. Cases can only close with private external-evidence digest.

This is **not an anonymous whistleblower product or certified Committee on Decorum and Investigation (CODI) process**. Counsel/DPO must independently assess member diversity, impartiality, replacement/recusal, conflicts, legal deadlines, policies, due process, retaliation protection, retention/legal holds and alternative reporting channels. An employer must provide external emergency and independent reporting channels before enabling this preview.

## Official guidance to check for the applicable period

- DOLE Online Compliance Portal: https://reports.dole.gov.ph/
- OSH Law RA 11058 / revised DO 252-25: https://bwc.dole.gov.ph/issuances/department-orders/
- DOLE workplace violence/harassment DO 259-26 (2026): https://bwsc.dole.gov.ph/news/department-order-no-259-26-guidelines-on-the-prevention-and-elimination-of-violence-and-harassment-in-the-workplace/
- PCW Safe Spaces Act and CODI: https://pcw.gov.ph/faq-republic-act-no-11313/
- Safe Spaces IRR: https://pcw.gov.ph/assets/files/2022/07/IRR-of-RA-11313-Safe-Spaces-Act.pdf

Review with a qualified Philippine OSH officer/labor practitioner, government bodies where needed and the DPO. Do not assume a report or training applies to every employer; legal deadlines and procedures are not guessed in software.

## Release flags and schema

- PH_DOLE_EXTENDED_REPORTS_ENABLED
- PH_OSH_RECORDS_ENABLED
- PH_PROTECTED_WORKPLACE_CASES_ENABLED

All flags require the exact value true and otherwise return 404. The existing multiEntity flag disables the entire pilot until employer/legal-entity authorization is separately verified. All new data is organization plus verified single-legal-entity scoped.

New additive source-only candidate: drizzle/0139_ph_workplace_compliance_foundation.sql.
Model definitions are in src/db/workplace-compliance-schema.ts, included explicitly in drizzle.config.ts. The protected core source src/db/schema.ts is restored byte-for-byte to the verified base; existing security proof hashes must never be fabricated or repinned without independent re-execution. **DO NOT run db:push, apply 0139 in Neon, or deploy to real customers from this PR.** An independent DBA must reconcile correct branch/schema/receipts and contiguous migration order; rehearse an isolated restore and rollback; review FK and table/model parity; record a signed release receipt. No historical receipts, incident records, allegations or committee appointments are inferred.

## Required engineering QA

- [ ] Exact-PR-head npm run typecheck, npm test and npm run source:size:check.
- [ ] Disposable PostgreSQL 16/18 apply + rollback, duplicate/partial rejection, catalog parity and schema-zero-write when flags OFF.
- [ ] Authenticated/anonymous, role, deny-only permission, employee linkage, cross-tenant, disallowed org scope and revoked membership tests with three fictional employers and two legal employers.
- [ ] Default-OFF page/API tests for all supported methods.
- [ ] Real device, accessible 390px, employee/HR/OSH/officer workflows and source SHA verification.
- [ ] Simulate key missing, tampered ciphertext, previous-key rotation; no plaintext in logs, audit, CI, or GitHub.
- [ ] Test concurrent case decisions, officer conflict, revocation hold, second-signatory review and no final closure without evidence.
- [ ] Test list replies never contain sealed/plain allegation statements, and one-record caseId detail reads deny foreign/non-assigned/revoked callers.
- [ ] Restore and re-run original source-pinned proof checks from original unchanged blob rather than editing legacy manifests or issuing fictitious proof credit.
- [ ] Independently review private storage, retention, deletion, case recusal and alternate reporting mechanisms.

## External business signoff / open acceptance

- [ ] Employer and OSH officer approve applicable forms/training/programs and current DOLE portal process.
- [ ] Philippine labor counsel reviews DO 259-26, RA 11313, the CODI and other workplace rules, and the employer's written policy.
- [ ] DPO approves complaint confidentiality, access, incident response, evidence retention and authenticated employee communications.
- [ ] Independent human QA checks actual roles, private case handling, employee mobile usability, secure backup/recovery and legal-employer isolation.
- [ ] Named release operator approves each flag individually, on a verifiable deployed commit, after protected database migration and external evidence.

**Unfinished post-MVP items:** official agency-file formats and acknowledgements, formal CODI membership/recusal/clock management, encrypted attachment provider, safety inspection schedules and risk registers, human-verified training accreditation, employer notifications, and real-customer acceptance. These are not implied by a source merge.
