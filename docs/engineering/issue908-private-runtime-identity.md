# #908: obtain the actual web runtime identity without retrieving credentials

The remaining role cutover cannot safely infer the deployed application login
from the Neon management connection. Existing `/api/readiness/database-target`
already authenticates with the readiness token and performs catalog/session
metadata SELECTs only. The broader live RBAC workflow also calls general
readiness and later business/fixture endpoints, so it is not a narrow substitute.

## Read-only operator path

After source CI/review and merge, manually run **Audit Runtime Identity
(Encrypted, Read Only)** on `main`, after Vercel is READY at that exact SHA.
It uses the existing GitHub `PRODUCTION_READINESS_TOKEN`; no token, database
URL or TOTP key is retrieved, generated, rotated or published by the workflow.
Missing/wrong credentials fail closed. It never runs on PRs or feature branches.

The operator generates a fresh RSA key pair of at least 3072 bits on their
trusted machine, retains the private key outside the repository with user-only
permissions, and supplies only the **DER SPKI public key encoded as base64**
in `recipient_public_key_base64`. Do not reuse a database/TOTP/bank key or a
cancelled backup key. This is diagnostic encryption, not a database backup or
staging service. No cloud resources or recurring spend are provisioned.

The probe makes exactly one HTTPS GET with redirects prohibited and a bounded
response/time limit. Exact production SHA, project, branch, endpoint, database,
primary state and response freshness are required. An allowlist retains only
that private identity (including the actual session role), never arbitrary
response extensions, headers, secrets or business records.

The result is encrypted with a random AES-256-GCM key, wrapped with the
operator's RSA-OAEP-SHA256 public key. Only ciphertext is uploaded, retained
for one day. Neither role names nor role fingerprints appear in logs, summaries
or plaintext artifacts. Download and decrypt locally with the private key;
keep the plaintext outside Git and public issue comments. Record source/run
and deployment SHA with the restricted evidence. The artifact run binds the
trusted probe source; an encrypted JSON file by itself is not a signed DBA proof.

## What this does and does not establish

This identifies the **web runtime session**. Use that exact identity to inspect
effective grants, owner/membership escalation and DDL authority in the catalog,
then prepare the concrete restricted-role/credential dependency diff. Do not
assume separately deployed workers or sealers use the same login or are absent.

It does not install audit triggers, create roles, demote logins, change grants,
seal historical rows, run retention, repair migration history, enable flags or
establish payroll readiness. #908 remains open until actual role isolation,
compound forward audit protection, restricted-login denial tests and controlled
cutover are verified. Existing source-only PG16/18 acceptance remains valuable
but does not replace this actual deployment identity or live privileges.

No application route or UI changes: flag-off/runtime behavior stays unchanged.
The new operator workflow is manual-only and inactive by default. Desktop and
390px screenshots are not applicable to this scripts/workflow-only change.
