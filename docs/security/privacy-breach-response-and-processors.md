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


## Optional WFM time-punch selfies and offline receipts (draft — DPO review required)

**Release gates:** `WFM_PUNCH_PHOTO_EVIDENCE_ENABLED` and `WFM_OFFLINE_PUNCH_QUEUE_ENABLED` both default OFF, separately from the document malware-scanning gate and central scheduler. The migration `drizzle/0116_wfm_selfie_offline_receipts.sql` must be applied before enabling either feature.

- **Purpose and consent:** An employee sees the photo purpose and default retention before choosing consent or decline. Consent is separately stored per employee/tenant and can be changed or withdrawn. Declining must not automatically suppress wages or count as absence. Worksite-specific optional photo capture is enabled only by policy and informed consent. **No face matching or biometric identity decision** is made.
- **Storage:** Limit uploaded JPEG/PNG photos to 512 KB; verify file signature, require malware scan and AES-256-GCM authenticated encryption under purpose-derived `PII_ENCRYPTION_KEY`. Store only the encrypted image, SHA-256, expiring evidence reference, worksite reference and audit metadata; never log a raw image or raw GPS. Reviewer reads require explicit tenant and HR scope.
- **Retention:** Default image retention is **90 days** from capture. The central leased scheduler deletes expired encrypted evidence in bounded batches while respecting an explicitly authorized legal hold; receipt records remain payroll-adjacent audit evidence subject to separately approved employment-record retention. The DPO must evaluate whether holds are justified and document secure backup/object-store deletion windows before approval.
- **Offline:** IndexedDB holds only client punch intent, opaque installation token and device timestamp. Sync records server-received timestamp, classifies clock skew and advisory shared-device / cross-site impossible-travel indicators, and stores all offline receipts as `pending_review`. A human HR reviewer must independently decide; even reviewed receipts are **not automatically inserted into payroll or attendance tables**. Apply accepted time only through the existing governed attendance correction workflow.
- **Processor/security:** Verify controller/processor roles, scanner and database contracts, incident notification, employee right to object, consent revocation effects, evidence access reviews, key-rotation drills, loss/device-theft risks, retention job health and restoration from backups. The DPO must approve the final purpose/retention notice before live employee collection.
