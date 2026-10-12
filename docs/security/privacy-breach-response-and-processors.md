**Migration conflict resolved in source (2026-10-12):** The only canonical numbered punch-evidence SQL is proposed as `drizzle/0118_wfm_punch_evidence.sql` in draft PR #865. This PR no longer creates duplicate `drizzle/0112` SQL. PR #856 remains **DRAFT, NO MERGE** until merged #855 Web Bundy overnight/role fixes are manually reconciled and independently validated. No Neon migration, image collection or offline attendance activation is authorized.

# Privacy incident and processor register — draft for DPO acceptance

**Status:** operational template, not a claim of actual legal sign-off or executed processor contracts.
**Owner:** assign a named Privacy Officer / DPO and incident commander before pilot.
**Applies to:** Linaw / PayrollPH deployments handling employee, payroll, government ID, bank, and public enquiry information.

## Immediate containment and triage

1. Record discovery time (UTC and Asia/Manila), reporter, affected environment, app SHA, tenant scope, and suspected data category in a restricted incident register. Keep sensitive evidence outside public GitHub.
2. Appoint an incident commander, DPO/privacy lead, security engineer and employer contact. Verify affected employer contracts and controller/processor responsibilities.
3. Preserve immutable logs, audit receipts and relevant access events, with controlled access and chain of custody. Do not copy payroll or ID records into tickets.
4. Isolate compromised access (revoke sessions/API keys, suspend a provider integration, rotate a specific exposed encryption key under an approved rotation runbook); do **not** destroy evidence or blanket-delete employer data.
5. Establish whether data was accessed or exposed, data sensitivity, potentially affected persons and tenants, likelihood of serious harm, and whether the event is a reportable personal data breach. Document uncertainty and evidence rather than assume a harmless outage.
6. Review the National Privacy Commission's governing breach notification rules, including NPC Circular 16-03 and amendments. For a breach meeting the applicable reporting threshold, prepare NPC notification within the applicable **72-hour** window from knowledge/discovery where required, including what remains under investigation; separately assess data-subject notification and any other agency/contract reporting windows. Legal/DPO review is mandatory; do not treat 72 hours as applying to every incident or as an automatic clock for an unverified event.
7. Track acknowledgement, internal and external notifications, resolution, evidence of containment, repeat-prevention tasks and post-incident lessons. Obtain an independent sign-off to close the incident.

## Responsible roles (must be assigned)

| Role | Assignment needed | Accountable work |
| --- | --- | --- |
| Incident commander | Unassigned | Timeline, containment, decisions and escalations |
| DPO/privacy officer | Unassigned | Reportability, regulator/data-subject notification and retention |
| Security technical lead | Unassigned | Forensics, credentials, access scope and verification |
| Payroll/tenant operations lead | Unassigned | Impact on payroll accuracy, approval and employee records |
| Legal/external communications reviewer | Unassigned | Review regulator, employer and individual communications |

## Processor and transfer verification (do not assume active)

| Provider | Potential work | Condition |
| --- | --- | --- |
| Vercel | Hosting, serverless runtime and deployment logs | Confirm hosting account/region, signed data terms and sub-processors |
| PostgreSQL database provider | Payroll/identity data storage | Identify actual database operator, processing region, security terms and backups |
| Resend / Postmark / SMTP mail provider | Email delivery and delivery-event telemetry | Record actual enabled provider, fields transferred and retention |
| Xendit | Subscription billing and payment flows | Check whether activated, applicable DPA, geography and API data |
| PayMongo | Optional payroll disbursement/billing | Check whether activated, bank recipient scope, security obligations |
| OpenAI | Optional automation language drafting | **Disabled by default.** Per-org informed authorization, contractual data-processing terms and verified retention controls required before any real inputs |
| Malware scanner / object storage provider | Uploaded document scanning/storage | Identify operator, data categories, storage region and contract before enabling |

For each actually deployed vendor, record controller/processor role, lawful basis, security/retention terms, cross-border transfer mechanisms where applicable, contract/DPA reference, expiry, subprocessors, restricted access path and incident notice procedure. Publish a reviewed public sub-processor register without posting contracts, keys or employee records to GitHub.

## Data subject requests

- Verify the requester through an approved identity proofing workflow (not just an email address on a public form).
- Resolve the employer and applicable tenant before processing a request. Do not disclose another employer's personnel or payroll history.
- Maintain a request register with request date, type, verification evidence, assigned reviewer, legal retention holds, actual fulfillment action and reviewer sign-off.
- Test access/export, correction, deletion/anonymization, objection and portability on synthetic tenant data, including negative cross-tenant cases and audit evidence.
- Statutory BIR/DOLE, payroll accounting, security investigation and litigation holds take priority over automated deletion until the legal basis expires.

## Pre-pilot verification

- [ ] DPO, security/incident roles and employer escalation contacts named.
- [ ] Actual provider inventory and contract terms reviewed; external retention and international transfer facts validated.
- [ ] Tabletop a synthetic breach, produce draft NPC and affected-person notices, and rehearse notification decisions.
- [ ] Test request fulfillment, authentication, hold/erase controls, tenanted exports and incident evidence access.
- [ ] Publish reviewed privacy notice and processor register; verify no unapproved OpenAI integration is activated.

## Optional workforce punch selfie evidence (RA 10173 / Data Privacy Act)

**Default:** WFM_PUNCH_EVIDENCE_ENABLED=false. No new image or offline history is captured without activation and the reviewed worksite policy. Once enabled, employee punches are *staged*, not payable attendance, until an independent workforce reviewer accepts the entry with a documented time source. This changes the legacy direct-punch behavior and requires a witnessed employee/payroll pilot before activation.

**Purpose / consent:** Before the first eligible photograph, show a versioned consent notice: a selfie may help a human checker review web/mobile punch identity. State the 90-day ordinary retention, recipient role, refusal/manual alternative, and that automated facial matching, auto-rejection and payroll deductions are prohibited. Record the employee’s accepted/declined choice once per notice version, scoped to employee and organization. Employees may withdraw prior acceptance; withdrawal must erase non-held ciphertext and log the event in the same transaction. Re-acceptance after declining requires a separate DPO-reviewed process. A decline may result in a *flagged manual-review* submission without a photograph, never an automatic payroll penalty. HR must provide a non-photographic attendance correction path. Review DPA notice and consent/lawful basis with the DPO before live use. Worksite policy changes require a company-wide workforce admin, MFA, reason and audit trail.

**Data minimization:** Use foreground browser JPEG selfie capture (512 KB max); strip JPEG APPn and COM metadata including EXIF/GPS before encryption. Store only a purpose-separated AES-256-GCM ciphertext in private database evidence keyed by UUID, and an evidence ID on a staged punch. Do not transmit selfies to AI/face-recognition services, persist raw GPS fixes, store employee geolocation history or copy images into payroll, logs or audit metadata. Photo reads are no-store, employer-scoped, workforce-role restricted, audited per viewing, and separately permission checked. The upload path requires sanitized JPEG bytes, a configured malware scanner reporting a clean image, and DOCUMENT_UPLOADS_ENABLED in production; scanner outages block storage. Device identifiers are HMAC-hashed per organization using PUNCH_DEVICE_HASH_KEY; do not place browser IP or device IDs in image evidence. These IDs are pseudonymous and remain personal data.

**Offline:** IndexedDB stores only the minimal unsent action, organization, employee, device installation pseudonym and original device timestamp. Offline selfies are *not* persisted on-device. Reconnect submits a stable idempotency ID with offline source and server-received timestamp. A difference exceeding 10 minutes becomes an `offline-synced` signal. GPS geofence verification is never inferred from stale raw GPS; late entries need independent manual review. Employees should avoid shared devices and browser storage; local queued data persists until confirmed server receipt or an authorized browser-storage wipe. Device clock manipulations may yield `clock-skew`/`time-invalid` review signals. Reviewer chooses device or server timestamp and records why; maker-checker separation and payroll period locks remain authoritative.

**Buddy-punch indicators:** Shared device across different employees within the same tenant and physically implausible travel between known configured *worksite centres* produce warning flags only. Worksite centre coordinates are employer configuration, not stored employee fixes. A flag never rejects a person, cuts time, or deducts wages. Do not make these analytics a disciplinary automated decision; check manually with contextual evidence.

**Deletion:** Photos expire 90 days after server receipt by default. Existing central scheduler runs the idempotent evidence-content purge under its PostgreSQL lease (requires CENTRAL_SCHEDULER_ENABLED=true as well). Legal holds require explicit DPO authorization and time-bounded review; a hold blocks deletion. Purging nulls ciphertext, retains minimal audit/status reference and records purge time. Image retrieval refuses expired or purged content even before the scheduler runs. Test synthetic data older than 90 days and active holds; monitor failures. Confirm backups, replication and DPA processor deletion controls separately, because SQL deletion cannot guarantee immediate erase of past backups.

**Processor register:** Database provider may store encrypted JPEG evidence; verify its region, backup expiry, incident obligations, restore/delete pathways and contract before activating. No image processor, facial identification vendor or object store should be added without DPO and vendor diligence.

**Operational launch requirements:** Apply and rehearse `drizzle/0118_wfm_punch_evidence.sql` on isolated synthetic data, configure a valid 32-byte PII_ENCRYPTION_KEY and independent PUNCH_DEVICE_HASH_KEY (32+ characters), configure DOCUMENT_UPLOADS_ENABLED, MALWARE_SCAN_URL and its production-scoped MALWARE_SCAN_TOKEN; independently test fail-closed scanner outages and consent withdrawal, check reviewer access and scope, run consent-declined, clock-skew and purge tests, and verify nightly scheduler and manual attendance alternatives. Enable `WFM_PUNCH_EVIDENCE_ENABLED=true` only after DPO and payroll go/no-go.
