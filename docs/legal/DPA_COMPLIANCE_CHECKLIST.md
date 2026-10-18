# DPA compliance checklist for counsel (DRAFT — NOT LEGAL SIGN-OFF)

**Status:** TODO-LEGAL / blocked for real-customer publication.
**Review owners:** TODO-LEGAL — identify Philippine privacy counsel, accountable operator, employer/controller representatives and a named DPO or privacy lead.
**Scope:** Linaw / PayrollPH's public enquiry intake and employer payroll/workforce features; reassess per actual deployment and employer agreement.

This is a **question-and-evidence checklist**, not a legal opinion or an assertion that an NPC registration, DPO appointment, contract, transfer safeguard, certification or Privacy Impact Assessment (PIA) exists. Implementation references describe source code, **not deployed configuration**, lawful basis or operational acceptance. Counsel must record answers and dated evidence outside this public repository. Keep the warning in [the live privacy page](../../src/app/privacy/page.tsx) until documented approval.

## DPO, accountability, registration and PIA — questions for counsel

- [ ] **TODO-LEGAL — identify the actual operators.** Which legal entity receives public enquiries? For each employer, which party acts as personal information controller (PIC), personal information processor (PIP), or independent PIC for each purpose? Who handles employee requests and reports on an employer's behalf? Document contracting entities, jurisdictions, escalation contacts and roles.
- [ ] **TODO-LEGAL — DPO designation.** Who is the formally appointed DPO, their authority/resources, dedicated private contact channel, reporting line and backup? What documented appointment and training evidence is required? Is a separate employer DPO needed?
- [ ] **TODO-LEGAL — NPC registration analysis, not an assumption.** Under the *currently applicable* NPC rules (including Circular 2022-04 and later issuances), must this operator or an employer register its DPO and/or any data processing systems? Which size, sensitive-data, risk, system and timing tests apply? Is an exemption declaration, voluntary filing, update or renewal relevant? Obtain documentary evidence; **do not** publish "NPC registered" or show a seal based on code.
- [ ] **TODO-LEGAL — PIA necessity and scope.** What PIA(s) and refresh triggers apply to payroll, government identifiers, bank details, document uploads, workforce attendance/photos, location signals, applicant data, external AI drafting and cross-border integrations? Who signs the risk assessment and mitigations? What employer-specific assessments are required before enabling features?
- [ ] **TODO-LEGAL — purpose and lawful basis.** For each ROPA row below, identify personal/sensitive information, lawful processing ground, whether consent is appropriate in the employment context, notice timing, minimization, security measures, child/dependent data considerations and third-party recipients.
- [ ] **TODO-LEGAL — rollout proof.** Check real configuration and tenant permissions, contracts, migrations, backups, data-flow tests, access reviews and environment secrets; do not infer activation from code or example environment values.

Counsel's starting points (check the most recent revisions): [NPC registration guidance](https://privacy.gov.ph/pips-and-pics/register/), [NPC PIA guidance](https://privacy.gov.ph/5-pillars-of-compliance-2/), [NPC data-subject rights](https://privacy.gov.ph/data-subject-rights/). These are review sources, **not** findings about PayrollPH.

## Public and employer privacy notices — items to verify before approval

- [ ] **TODO-LEGAL — notice identity:** correct legal name, physical/service contact, DPO/privacy-request contact, controller/PIP distinctions and employer-notice boundary. The public page currently says "Linaw / PayrollPH"; verify its authority to speak for each role.
- [ ] **TODO-LEGAL — effective/version date and collection points:** actual effective date, version management, which enquiry and product screens display it, and whether consent timestamps/versions match production behavior ([public page](../../src/app/privacy/page.tsx), [enquiry intake](../../src/app/api/demo-requests/route.ts), [consent code](../../src/lib/marketing-consent.ts)).
- [ ] **TODO-LEGAL — categories and subjects:** enquiry names/emails/company/attribution; workforce identity, TIN/SSS/PhilHealth/Pag-IBIG IDs, bank/payout data, leave, time, payroll, employment and audit data; applicants; optional selfie/location/pseudonymous device indicators. Validate feature gates and deployed data actually collected.
- [ ] **TODO-LEGAL — purposes and lawful criteria:** marketing enquiry follow-up versus separate marketing; employee payroll/benefits/statutory reporting; account security/fraud prevention; billing/disbursement; support/analytics; discretionary integrations. State each legal basis only after assessment, including any sensitive personal information basis.
- [ ] **TODO-LEGAL — recipients:** identify actual categories and named external processors/independent controllers as appropriate, with transfers, sub-processors and who sees payroll information.
- [ ] **TODO-LEGAL — cross-border details:** countries, storage/backup/logging/support access locations, safeguards and rights/contract terms; do not say a particular country or zero-retention term applies without verified evidence.
- [ ] **TODO-LEGAL — retention:** map distinct operational windows, statutory/legal-hold exceptions, backups and disposal to [retention review notes](RETENTION_REVIEW_NOTES.md) and the employer schedule; do not imply a default-off scheduler is running.
- [ ] **TODO-LEGAL — rights, objections and redress:** explain how to make/verify a request, controller-versus-employer routing, applicable rights, limits, complaint/escalation channels, any applicable response periods and the internal 30-day target without calling it a universal statutory deadline.
- [ ] **TODO-LEGAL — consent and withdrawal:** confirm choices and consequences for enquiry follow-up and optional features; document the withdrawal route and residual lawful bases rather than implying all payroll records erase on withdrawal.
- [ ] **TODO-LEGAL — safeguards and breach communications:** ensure claims about encryption, MFA, isolation and notification reflect tested deployment; no false guarantee or certification.
- [ ] **TODO-LEGAL — update process:** counsel-approved content owner, trigger for changes, notice publication mechanism, version archive and sign-off record.

**Hard block:** [src/app/privacy/page.tsx](../../src/app/privacy/page.tsx) explicitly requires DPO/legal verification before real-customer publication. The TODO-LEGAL placeholders do not close this gate.

## Evidence-based service-provider and transfer inventory

**Important:** These are **repository-supported integration paths**, not evidence that a vendor is contracted, turned on, deployed, based in a country, or a PIP for every use. [package.json](../../package.json) uses `next`, `pg` and `nodemailer` but does not itself name a deployed host/database/mail operator. [.env.local.example](../../.env.local.example) contains unpopulated, often default-off configuration. Determine *actual* provider and role for each deployment before the notice is approved.

| Code-supported service/provider | Repository evidence | TODO-LEGAL confirmation |
| --- | --- | --- |
| Vercel (potential hosting/runtime) | [vercel.json](../../vercel.json), [cron route](../../src/app/api/jobs/cron/route.ts), [.env.local.example](../../.env.local.example) | Is production actually hosted here? Entity, data/log regions, sub-processors, DPA, transfer and backup policies. |
| PostgreSQL / **unnamed database host** | [package.json](../../package.json) `pg`, [.env.local.example](../../.env.local.example) `DATABASE_URL`, [DB entrypoint](../../src/db/index.ts) | Identify actual managed Postgres host, storage/replica/backup regions and operator agreements. **Do not assume Neon is the deployed database.** |
| Resend, Postmark **or** a configured SMTP operator (transactional email) | [mail provider selection](../../src/lib/mail-provider.ts), [delivery code](../../src/lib/mailer.ts), [.env.local.example](../../.env.local.example) `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` / `SMTP_URL` | Which is configured? Email/personal data payloads, provider role, retention, geography, inbound event callbacks and contracts. |
| PayMongo (optional billing/disbursement) | [checkout implementation](../../src/lib/paymongo.ts), [disbursement path](../../src/lib/paymongo-disbursements.ts), [.env.local.example](../../.env.local.example) `PAYMONGO_SECRET_KEY` and disbursement gate | Activated or not? Payout/bank fields, independent payment-provider role, retention, transfers, terms and employer authorization. |
| Xendit (code-supported subscriptions/payroll payouts) | [subscriptions](../../src/lib/xendit-subscriptions.ts), [payouts](../../src/lib/xendit-payroll-payouts.ts), [payout route](../../src/app/api/payroll-runs/[id]/xendit-payout/route.ts) | **Not enumerated in the reviewed example env file**; verify whether corresponding keys/gates exist in any *real* deployment. Do not omit merely because SDK is absent from package.json; source makes direct HTTPS calls. |
| OpenAI (optional automation draft model) | [draft call](../../src/lib/automation-language-draft.ts), [consent gating](../../src/lib/automation-model-consent.ts), [.env.local.example](../../.env.local.example) `OPENAI_*` switches default false | Confirm feature disabled unless specifically approved; no signed DPA, zero-retention, opt-in or transfer safeguard is established by a boolean flag. Verify requested data, model terms, region, retention and alternative workflow. |
| Private S3-compatible storage (**provider unnamed**) | [storage adapter](../../src/lib/document-object-storage.ts), [.env.local.example](../../.env.local.example) `DOCUMENT_OBJECT_STORAGE_*` / `DOCUMENT_UPLOADS_ENABLED=false` | Which object-store operator/bucket? Data class, object metadata, replicas, deletion proof, contracts, residency and access logs. |
| Malware scanning (**provider unnamed**) | [.env.local.example](../../.env.local.example) `MALWARE_SCAN_URL` / `MALWARE_SCAN_TOKEN`, [upload design](../../docs/security/file-object-storage-review-plan.md) | Is any scanner deployed? What bytes/metadata leave the system, region and retention; is a DPA required? |
| OTLP error-log collector (**provider unnamed, default off**) | [safe telemetry emitter](../../src/lib/safe-otel-error.ts), [.env.local.example](../../.env.local.example) `SAFE_OTEL_ERRORS_ENABLED=false` / `OTLP_LOGS_ENDPOINT` | Does any endpoint receive even sanitized events? Confirm minimization, geography, access and retention. |
| Slack (optional tenant connector) | [Slack integration](../../src/lib/slack-connector.ts), [.env.local.example](../../.env.local.example) `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY` | Is Slack connected per tenant, what is messaged, who is controller/recipient, data residency, consent/notice and processor terms? |

- [ ] **TODO-LEGAL — verify each row against secrets/deployed features without disclosing secrets.** Record enabled/disabled, legal entity, controller/PIP/independent-recipient role, data categories, purpose, flow, physical locations, subprocessors, contract ID, contract date, international-transfer analysis, incident SLA, deletion/backups, and evidence owner.
- [ ] **TODO-LEGAL — discover omissions.** Inventory analytics, CDNs, observability, support tickets, email/SMS, monitoring, banks and any employer-configured integrations that *actually* touch data; do not insert vendor names based on assumptions.
- [ ] **TODO-LEGAL — vendor claims.** Verify security attestations, subcontracting, audit rights, retention promises and encryption/storage claims with executed documents; do not assert SOC 2, ISO or signed zero-retention terms from repository flags.

## Data-subject rights: source implementation versus review questions

The [README's "Data Privacy Act data-subject requests"](../../README.md#data-privacy-act-data-subject-requests) section lists five request types but calls 30 days "statutory." **That wording conflicts with the implemented internal-target comment** in [the request route](../../src/app/api/compliance/data-requests/route.ts). TODO-LEGAL: determine the correct statement for each right; do not reuse the README's universal deadline wording.

The request API is **authenticated, company-wide owner/admin/HR**, uses same-origin checks for writes and MFA for sensitive actions. This is an **administrator register**, not a self-service public identity-verified request portal. The public [privacy page](../../src/app/privacy/page.tsx) directs external requests to `/contact`.

| Right / workflow | Current implementation evidence | TODO-LEGAL / operational gap to verify |
| --- | --- | --- |
| Be informed | [public privacy notice](../../src/app/privacy/page.tsx), [enquiry consent](../../src/lib/marketing-consent.ts) | Review complete notice, employer delivery, version, actual lawful bases and optional feature notices. |
| Access | `access` request type, org-scoped JSON export of matched employee, payroll, loan and separation data, audited; [route GET export](../../src/app/api/compliance/data-requests/route.ts) | Confirm identity proofing **before** recording/releasing data, scope/completeness, secure handoff and employer instructions; email-match export may not cover all data classes. |
| Rectification / correction | `correction` request; [PATCH](../../src/app/api/compliance/data-requests/route.ts) allows selected employee profile/ID fields, requires evidence to complete; excludes payroll rates/payout history | Review source-of-truth corrections for historic payroll and statutory records; document manual remediation and when refusal is lawful. |
| Erasure/blocking/deletion | `deletion` request; in-app execution is limited to separated/inactive staff, clears some profile/contact/bank fields, keeps historical/statutory records and requires retention assessment for completion; [PATCH](../../src/app/api/compliance/data-requests/route.ts) | Verify applicable retention rule/hold *per record class*, whether other systems/backups/providers are addressed, and how objections/restrictions are delivered. Not an unconditional erase-all endpoint. |
| Objection | `objection` request type, evidence-gated completion via [PATCH](../../src/app/api/compliance/data-requests/route.ts) | Identify operational workflow for pause/restriction, legal basis and response; no general automatic stop-processing path established by this route. |
| Portability | `portability` request type shares [JSON export path](../../src/app/api/compliance/data-requests/route.ts) and export audit | Confirm eligibility, format/coverage, authorized recipient and secure delivery; audit proof does not prove transfer to requester. |
| Consent withdrawal | Enquiry follow-up scope in [intake](../../src/app/api/demo-requests/route.ts) and [consent helper](../../src/lib/marketing-consent.ts); five API types do **not** include a general `withdrawal` type | Specify actual human/operator withdrawal process, marketing suppression, optional photo/model consent handling, and legal bases remaining after withdrawal. |
| Complaint, damages, authorized representative | Not enumerated in the five registered request types; public contact page is the intake pointer | Confirm regulator complaint information, escalation, identity/authority checks for agents/heirs, and a manual case/appeal path. |

- [ ] **TODO-LEGAL — test end to end** with synthetic multi-tenant data and employer reviewers; verify no cross-tenant leakage, sensitive JSON access controls, MFA, request trace, response evidence, exceptions, backup and processor coordination.
- [ ] **TODO-LEGAL — set per-right handling deadlines** from counsel's actual legal review; keep the route's 30-day value described only as an **internal** target pending review ([source](../../src/app/api/compliance/data-requests/route.ts)).
- [ ] **TODO-LEGAL — request operations:** assign requester verification, employer escalation, redaction, secure delivery, audit retention and dispute owners. Do not put IDs/payroll attachments into public support tickets.

## Breach-response runbook (proposed; counsel approval required)

Source companion: [existing DPO draft incident/processor runbook](../security/privacy-breach-response-and-processors.md). Reference for counsel to check: [NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf), subsequent amendments, the DPA and IRR. **TODO-LEGAL:** confirm the applicable reporting threshold, whether any 72-hour obligation applies, clock origin, notifications to NPC and affected subjects, permitted delays, exemptions and mandatory content **for each incident**. A security event alone is not an adjudicated reportable breach.

**Initial response workflow (proposed operational steps, not a claim of deployment):**

1. **Receive & timestamp:** use the private contact in [SECURITY.md](../../SECURITY.md) *once TODO-OWNER has been replaced*. Log discovery and reasonable-belief timestamps in Manila time and UTC, caller, affected product/tenant, source, access and evidence owner. Do not file sensitive details in public issues.
2. **Mobilize:** TODO-LEGAL assign incident commander, DPO, counsel, security engineer, infrastructure contact, affected employer/controller contacts, and 24-hour backup. Distinguish PIC/PIP contractual notification paths.
3. **Contain safely:** revoke involved sessions/API keys, disable affected integrations, investigate data stores and independent backups, preserve logs and chain of custody. Never destroy evidence or live payroll records indiscriminately.
4. **Assess:** affected people/tenants, nature of data (government ID, bank, payroll, photos, device metadata), confidentiality/integrity/availability, exposure likelihood, encryption and accessible keys, harm, scope certainty and current controls.
5. **Determine reportability:** TODO-LEGAL/DPO document reasoning and sign off, including *whether and when the conditional 72-hour notification obligation is triggered*. Open a tracked countdown promptly; don't postpone triage until the investigation is complete.
6. **Notify if required:** TODO-LEGAL approve recipient list, NPC channel/forms, employee/employer communication, preliminary notice contents and supplemental notices. Log actual submission acknowledgements and any approved delay/exception.
7. **Restore, verify, learn:** correct root cause, test access restoration/tenant isolation, remediate vendor exposure, record notifications, evidence retention, follow-up and independent closure sign-off.

**Proposed incident severity matrix — triage only, never a legal-reportability determination:**

| Priority | Engineering triage example | Immediate escalation / counsel question |
| --- | --- | --- |
| P0 / Critical | Verified or reasonably suspected broad exposure of decrypted payroll, government-ID or bank data; active unauthorized access across tenants | Contain urgently; DPO/counsel evaluate NPC and individual notifications and the conditional **72-hour** clock without delay. |
| P1 / High | Credible tenant-scoped sensitive-data compromise, leaked production secrets that could reveal data, or compromised provider handling it | Escalate to privacy incident team; determine exposure and reporting trigger with evidence. |
| P2 / Moderate | Limited metadata disclosure, compromised low-scope integration, uncertain unauthorized access, or substantial integrity/availability concern | Preserve evidence, investigate promptly, reassess priority if impact grows; counsel decides reportability. |
| P3 / Low | No identified personal-data exposure, blocked attempt, synthetic-only test incident | Record and monitor; document evidence for non-reporting and trigger review if facts change. |

**72-hour decision worksheet — TODO-LEGAL to complete per incident:** first knowledge/reasonable-belief time: ______; party receiving notice: ______; PIC/PIP contractual escalation deadline: ______; affected categories: ______; threshold analysis: ______; NPC notification required? ______; affected-person notice required? ______; statutory deadline/time zone if applicable: ______; notice version/submission receipt: ______; delay/exemption advice and proof: ______; DPO/counsel sign-off: ______.

- [ ] **TODO-LEGAL — rehearse** at least one synthetic multi-tenant breach/tabletop with the actual on-call chain, an attempted regulator notice, affected-subject draft and documented decision to notify or not notify.
- [ ] **TODO-LEGAL — confirm provider notification SLAs** and interaction with statutory deadlines; do not assume the provider's clock substitutes for the controller's duties.

## ROPA / data-processing register template (one row per activity + tenant role)

Blank template; **none of these fields indicate a verified processing activity or statutory retention conclusion**. Store completed registers and contracts in access-controlled systems, not GitHub.

| Activity ID / owner | PIC/PIP and employer role | Data subjects + data categories (sensitive?) | Purpose + proposed lawful basis (counsel-confirmed?) | Source/collection + recipients/processors | Location/cross-border flow + safeguards | Retention start/stop + holds/backups | Technical/organizational measures + DPIA/PIA | DSR owner and vendor deletion process | DPO approval/evidence/date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL | TODO-LEGAL |

For completeness, **TODO-LEGAL** decide whether to create separate entries for public enquiries, employment/payroll/statutory filings, billing/payouts, recruitment, authentication/audit trails, workforce optional selfie/location, private documents, optional AI drafting, and external integration messages. For each, verify primary and derivative records, partner-tenant responsibilities, documented flows and retention triggers.

## Processor / controller-to-processor contract checklist

For **every actually enabled vendor and each employer relationship**, counsel must review applicable contract status and the proper PIC/PIP/independent-controller classification. **No contract is assumed executed.**

- [ ] **TODO-LEGAL — parties and scope:** correct entities, roles, processing instructions, approved purposes, data categories, confidentiality and employer authority.
- [ ] **TODO-LEGAL — security:** proportionate technical/organizational controls, access control, encryption/key management, incident handling, audit/evidence rights and security testing.
- [ ] **TODO-LEGAL — subcontractors:** list, approval/change notice, flow-down obligations, support access and verification rights.
- [ ] **TODO-LEGAL — international transfers:** actual countries/subprocessors, transfer conditions, protections, notice and any applicable contractual/regulatory requirements.
- [ ] **TODO-LEGAL — breach assistance:** prompt vendor-to-controller escalation, severity data, preservation and cooperation within counsel-confirmed reporting windows.
- [ ] **TODO-LEGAL — data-subject requests:** verification and assistance, secure export/correction/deletion, permitted limitations, response-time coordination and audit evidence.
- [ ] **TODO-LEGAL — retention and end of service:** expiry, deletion/return, legal holds, backups and deletion certificate/evidence, hosted logs and subcontractor copies.
- [ ] **TODO-LEGAL — liability and governance:** warranties (if any), audit/inspection, exit strategy, notice of changes, dispute mechanism and contract review cycle.
- [ ] **TODO-LEGAL — evidence:** signed DPA/contract reference, effective date, version, business owner, DPO approver and periodic reassessment (stored outside repo).

## Legal publication sign-off (must remain OPEN)

| Required evidence | Status |
| --- | --- |
| Named DPO / operator / employer role analysis | TODO-LEGAL — OPEN |
| NPC registration/exemption decision with verified evidence | TODO-LEGAL — OPEN |
| PIA scoping, completed assessments and risk acceptance | TODO-LEGAL — OPEN |
| Deployed vendor/subprocessor and transfer/contract register | TODO-LEGAL — OPEN |
| Corrected public/employer notices and data-subject rights workflow | TODO-LEGAL — OPEN |
| Retention, breach-notification and incident tabletop acceptance | TODO-LEGAL — OPEN |
| Final sign-off date, approver and publication authorization | TODO-LEGAL — OPEN |

**No production customer-publication approval is granted by this checklist.** A verified counsel/DPO sign-off must explicitly authorize removing the existing privacy-page caveat in a **separate, reviewed change**.
