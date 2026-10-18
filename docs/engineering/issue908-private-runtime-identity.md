# #908: obtain the actual web runtime identity without retrieving credentials

The restricted-role cutover must not infer deployed web credentials from a Neon
management login. The existing token-protected /api/readiness/database-target
endpoint reads PostgreSQL session/catalog metadata without accessing business
rows. Its current_user identifies the *effective role*, not necessarily
session_user. Other workers, schedulers and the sealer need separate inventory.

## Mandatory authorization setup (before any dispatch)

1. In GitHub Settings -> Environments, use the existing production environment.
   **An environment name in YAML does not establish protection by itself.**
   An administrator must confirm that production has required, independent
   reviewers, prevents self-approval, and allows deployment from main only.
   If any requirement is unavailable or absent, do not dispatch this workflow.
2. Review who can edit environment variables, workflow files, branches and
   PRODUCTION_READINESS_TOKEN. Restrict the roles allowed to administer these.
   The new workflow requests read-only contents permissions and waits for
   production environment approval. Other existing workflows using a repository-
   scoped readiness token remain a separate access-control consideration.
3. The designated evidence recipient creates a dedicated >=3072-bit RSA key
   pair on a trusted local machine. Keep the private key outside any Git
   working tree, with user-only permissions. Do not reuse bank, TOTP, DB or
   backup keys. Example (on a trusted POSIX system):

~~~bash
umask 077
mkdir -p "$HOME/payrollph-private/issue908"
chmod 700 "$HOME/payrollph-private/issue908"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
  -out "$HOME/payrollph-private/issue908/runtime-identity-private.pem"
chmod 600 "$HOME/payrollph-private/issue908/runtime-identity-private.pem"
openssl pkey -in "$HOME/payrollph-private/issue908/runtime-identity-private.pem" \
  -pubout -outform DER | openssl base64 -A
~~~

4. A production-environment administrator stores ONLY the output public-key
   base64 in the production **environment variable**
   AUDIT_EVIDENCE_PUBLIC_KEY_BASE64 (Settings -> Environments -> production ->
   Environment variables). This must be an administrator-approved, fixed
   recipient: **no workflow-dispatch public-key input is accepted**. Keep the
   private key on the designated recipient's machine. Record the approved
   public-key fingerprint and authorized recipient in restricted evidence.
5. Confirm the existing PRODUCTION_READINESS_TOKEN secret is configured and
   usable by the production job; missing or incorrect credentials fail closed.
   The workflow does not retrieve, rotate or print secrets.

## Capture (read-only)

After an independent review and merge, confirm the exact main commit SHA is
deployed and Vercel reports READY. Manually select **Audit Runtime Identity
(Encrypted, Read Only)** on main, with no inputs. An independent production
environment reviewer must approve it. If approval enforcement or the approved
recipient variable is missing, STOP; do not weaken the workflow.

The script makes exactly one fixed HTTPS GET and refuses redirects; it bounds
the response and requires matching production SHA, pinned Neon project/branch/
endpoint/database, primary state and freshness. Only allowlisted identity
metadata is encrypted using AES-256-GCM with a random key wrapped by
RSA-OAEP-SHA256. Only ciphertext is uploaded for one day; no plaintext role,
fingerprint, token or DB URL is logged. There are no SQL clients, grants, DDL,
business requests, staging, payments, backups or migrations.

## Offline operator decryption

The authorized recipient downloads the encrypted artifact from the approved
GitHub Actions run, verifies the workflow/source/run SHA, and unpacks
audit-runtime-identity.encrypted.json locally. On a trusted machine with the
reviewed repo source and Node 22, run this command (replace the artifact path
with the actual download location):

~~~bash
umask 077
node scripts/qa/decrypt-runtime-identity.mjs \
  "$HOME/Downloads/audit-runtime-identity.encrypted.json" \
  "$HOME/payrollph-private/issue908/runtime-identity-private.pem" \
  "$HOME/payrollph-private/issue908/runtime-identity.json"
~~~

The offline utility does not contact production or make network requests.
Native Windows intentionally fails with `AUDIT_RUNTIME_POSIX_OPERATOR_REQUIRED`
before reading any private key or artifact. Windows mode bits do not prove
private NTFS access, and Node's POSIX no-follow guarantee is unavailable there.
On this Windows computer, use a trusted WSL Linux environment with Node 22 and
keep the private key, downloaded artifact and plaintext under the Linux home
directory with the permissions shown above. Do not use a Windows-mounted
`/mnt/c` directory for private operator files, and do not relax the checks to
make native Windows succeed. The repository itself can remain on `/mnt/c`.
It refuses GitHub Actions/CI execution, malformed/tampered artifacts, wrong
keys, unsupported envelopes, pre-existing plaintext outputs, and output paths
inside the repository (including symlinked destination directories). It writes
the plaintext with user-only permissions and prints only a fixed success/failure
code, never role metadata. Store the artifact and plaintext in approved
restricted evidence, not Git, PR comments, issue comments or public logs.
Record independently the reviewed commit, production SHA, artifact run,
recipient, approval and evidence retention/deletion decision.

## Scope and remaining #908 work

The private result observes the deployed web runtime's PostgreSQL current_user,
not necessarily session_user and not its grants, table ownership, membership,
DDL authority, or rights to alter audit chain/retention. Follow up with a
DBA-authorized catalog inspection of effective grants and potential escalation
using actual production-relevant identities, and independently inventory
workers, scheduler and audit sealer. Use a disposable PostgreSQL clone and
restricted roles for rollback-only denial tests before reviewed canonical
migrations, sign-offs or a controlled cutover.

This is not a signed DBA proof, migration receipt, effective privilege proof,
payroll release approval or evidence of successful cutover. Keep #908 OPEN
and payment, banking and filing activation OFF pending independent gates.
No UI/routes/runtime flags, SQL, grants, role changes, cloud spend or
production payroll operations are introduced. Screenshots are not applicable.
