# A-5 employee 201-file vault — independent acceptance record

**Status: NOT ACCEPTED for production.** Source and synthetic CI are not equivalent to a private object-store deployment, a legal-hold policy, or HR authorization. Flags EMPLOYEE_DOCUMENT_VAULT_ENABLED and DOCUMENT_UPLOADS_ENABLED remain OFF on production.

## Automated source / synthetic acceptance

- Exact-head full CI, CodeQL and four payroll golden suites.
- Disposable PostgreSQL A-5 SQL rollback rehearsal, immutable uploader / checker enforcement, tenant / employee isolation and 30/14/7 reminder idempotency.
- New local MinIO S3-protocol acceptance: signed 60-second GET reads exact SHA-256 bytes, no unsigned GET, no key/expiry tampering, If-None-Match prevents replacing a scanned object, delete on disposable service.
- New deterministic scanner-contract probes: clean response, infected response, scanner unavailable and malformed response. **These mocks do not prove a deployed ClamAV scanner.**

## Required independent staging/UAT

1. DBA reconciles numbered migration against canonical 0115–0121 and HCM document-compliance prerequisites. Capture journal SHA and rollback/restore signatures. Do not replay any DDL to Neon main.
2. Security configures a **private** object store and approved scanner using an isolated staging employer. Record region/residency, provider DPA, private-bucket policy, KMS/key handling, IAM least privileges, signed-URL expiry, log/URL leak review and legal-hold/version retention.
3. Authorized HR uploads a clean fictional PDF and a local malware-test fixture (not real malware) through the real HTTP UI. The scanner must reject the test signature; unauthorized roles and wrong employer must get 403/404 without object access or records. Never bypass the scanner to make the path pass.
4. Test object-storage outage, malware-scanner outage, HTTP timeout after PUT, audit-write failure and DB rollback. Ensure no approved compliance state survives failure; document orphan object cleanup without exposing object keys.
5. Test independent HR checker different from uploader, recent MFA, verified scanned upload, immutable uploader ID, one-time audit, duplicate verification replay rejection and replacement document with same expiry.
6. On two physical 375px-class phones with distinct authorized HR and employee roles, verify required versus optional documents, replacement, denied access, 30/14/7 Asia/Manila reminders, one notice per document/milestone after retries and scheduler restart. Retain screenshot hashes without personal data.
7. Test secure migration/dual-read/backfill against a separately restored **non-production** DB and object versions, including row counts, SHA-256 and length matching, audit/consent/legal holds, and rollback. Never delete historical inline bytes without separately authorized reconciliation.

## Evidence / approvals

| Control | Responsible independent party | Status |
| --- | --- | --- |
| Latest CI + local disposable MinIO/scanner-contract acceptance | Engineering CI | PENDING |
| Actual staging private object store and ClamAV signature test | Security | NOT_RUN |
| HCM schema/migration receipt + restore | DBA | NOT_APPROVED |
| Legal hold, provider location, encryption custody | DPO/Legal | NOT_APPROVED |
| HR maker/checker & multi-tenant physical mobile UAT | HR/QA | NOT_RUN |
| Production feature activation | Release owner | NOT_AUTHORIZED |

No payroll transfers, production migrations, live employee files or real customer emails may be used in automated checks.
