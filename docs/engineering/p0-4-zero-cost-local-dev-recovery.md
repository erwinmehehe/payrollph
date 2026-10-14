# P0-4 zero-subscription local development backup and offline restore

**Scope: SOLO DEV / FICTIONAL DATA ONLY / NOT PRODUCTION-CERTIFIED.**
**New monthly cloud service cost: $0** when using software and storage you already own.
This interim development safeguard does not replace an independent durable
offsite production backup.

The owner decided not to open an AWS account while Payroll PH is
pre-customer and cannot afford monthly AWS costs. PR #999 is already merged
but **dormant**: code in GitHub does not create AWS resources or start billing.
Do not dispatch the AWS backup/restore workflows without separately
approving and configuring them.

The manual helper lives at **scripts/local-dev-encrypted-recovery.mjs**.
The backup action pipes PostgreSQL 18 custom-format output from pg_dump
directly into age encryption before writing a local encrypted archive.
The verify action checks the ciphertext SHA-256 and decrypts directly into
a disposable **PostgreSQL 18 Docker container with --network none**.
There is no plaintext dump file, public restore port, or mounted host
storage. Verification results are not production recovery certification.

## Install free prerequisites (Windows PowerShell)

Work in a local checkout of the repository. The helper requires:

1. Node.js 22+ (the repository's runtime).
2. PostgreSQL 18 command-line tools including pg_dump and psql:
   https://www.postgresql.org/download/windows/
   Add its bin directory to PATH and open a new terminal.
3. The free age encryption utility, maintained at:
   https://github.com/FiloSottile/age
   On Windows you can install using:

       winget install --id FiloSottile.age

4. Docker Engine or Docker Desktop **for verification only**. Check
   Docker Desktop licensing for your circumstances. Installing these
   tools does not require an AWS account or a cloud subscription.

Check the tools with these PowerShell commands:

    node --version
    pg_dump --version
    age --version
    docker --version

Use a PostgreSQL client major version matching the source Postgres 18
version; Neon recommends using the direct unpooled endpoint for pg_dump.

## Make your age private identity offline

Choose a directory OUTSIDE the Git checkout and outside shared/synced
folders. Secure it with your OS and make a separate offline recovery copy.

    New-Item -ItemType Directory -Force "$HOME\LinawPrivateKeys" | Out-Null
    age-keygen -o "$HOME\LinawPrivateKeys\dev-age-identity.txt"
    age-keygen -y "$HOME\LinawPrivateKeys\dev-age-identity.txt"

The last command prints a public recipient starting with age1. Only
that PUBLIC recipient is safe to put into the backup env file. Never
commit, paste, or upload the private identity. If it is lost, your age
ciphertext cannot be decrypted.

## Create an encrypted backup of a fictional local development DB

Create a file named **.backup-dev.env** in your checkout's root.
It is ignored by Git. Its contents should look like this with your
actual public recipient and development database settings:

    DEV_BACKUP_SOURCE=local
    DEV_BACKUP_CONFIRM=FICTIONAL_DATA_ONLY_NO_PRODUCTION
    BACKUP_AGE_RECIPIENT=age1REPLACE_WITH_ACTUAL_PUBLIC_RECIPIENT
    PGHOST=127.0.0.1
    PGPORT=5432
    PGDATABASE=linaw_dev
    PGUSER=linaw_reader
    PGSSLMODE=disable

If the local database requires a password, use a protected PostgreSQL
.pgpass file or an untracked PGPASSWORD entry in .backup-dev.env.
Do not copy credentials into shell command arguments, public issues or
chat. The helper refuses application DATABASE_URL variables and CI.

Run manually from the repository root:

    node --env-file=.backup-dev.env scripts/local-dev-encrypted-recovery.mjs backup

Expect a new encrypted archive with suffix **.pgdump.age**, plus a
metadata-only **.pgdump.age.json** receipt, under the already ignored
**qa-artifacts/local-dev-backups/** directory. The receipt contains the
ciphertext SHA-256 and size, with NO employee/payroll data or secrets.
An encrypted dump is not proven recoverable until the restore test passes.

### Remote Neon restriction (advanced, NOT the default)

A Neon dump necessarily transfers database rows to your local machine.
**Do not claim FICTIONAL_DATA_ONLY if the target contains real employee,
salary, government or banking records. STOP and reassess data handling.**

Advanced mode **DEV_BACKUP_SOURCE=pinned-neon** is only for a source
independently established as fictional development data. It requires the
exact project endpoint pinned in the repository, verify-full TLS, a
dedicated least-privileged reader and the existing read-only SQL identity
guard. It fails closed if any control is absent. This pinned endpoint
currently belongs to Neon main, **not automatically safe development data**.
Never use the application-owner database credential or bypass this guard.
For now, use a fictional local database.

## Verify the archive without writing to Neon

Start a FRESH PowerShell session, without the backup env file loaded.
Set only the offline restore inputs:

    $env:DEV_RESTORE_CONFIRM = "DISCONNECTED_DOCKER_ONLY"
    $env:AGE_IDENTITY_FILE = "$HOME\LinawPrivateKeys\dev-age-identity.txt"

Run the verifier with the REAL generated archive filename:

    node scripts/local-dev-encrypted-recovery.mjs verify "qa-artifacts\local-dev-backups\linaw-dev-REPLACE.pgdump.age"

Before decrypting, the script validates the encrypted size and SHA-256
against the adjacent receipt. It rejects any external database target
environment variables. It starts a new ephemeral Postgres 18 Docker
container with --network none, streams decrypted bytes directly into
pg_restore inside that container, counts restored public tables, writes
a local **.verify.json** receipt, then destroys the container. It does
not perform SQL writes against Neon or another remote database.

Clean up the session settings when complete:

    Remove-Item Env:\DEV_RESTORE_CONFIRM
    Remove-Item Env:\AGE_IDENTITY_FILE

## Make an independent second copy

Copy BOTH the encrypted archive and its receipt to storage you ALREADY
OWN and that you can disconnect from your computer (for example an
existing USB drive). Verify the checksum/restore from the copied files.
Keep a protected recovery copy of the age private key in a DIFFERENT
location. A dump and its private key on the same laptop do not protect
against losing the whole device. Cloud free tiers are not a substitute
for confirming data confidentiality, retention and recoverability.

## What counts as success

A passing run proves only that this archive's ciphertext was intact,
your chosen key could decrypt it, and a disconnected PG18 container
accepted its restore and had public tables. Record a private evidence
label **SOLO_DEV_RESTORE_SMOKE**, NOT an independently witnessed or
production-certified restore. This test does not establish complete
source/restored data or sequence parity, full application startup,
RPO/RTO or a production privacy audit.

The existing AWS P0 issue **#907 stays OPEN** for a future funded and
audited real offsite recovery design. Likewise, historical migration
provenance, the October 12 Neon incident, bank encryption, payroll
payouts and government filing gates remain unchanged.

## No-cost local checklist

- [ ] Confirm source contains only fictional development data
- [ ] Install or locate free Postgres 18 client, age and Docker tools
- [ ] Generate and independently protect age private identity
- [ ] Export one **encrypted** local development archive
- [ ] Copy ciphertext + receipt onto separate existing media
- [ ] Restore the copied ciphertext into networkless PG18
- [ ] Record SOLO_DEV_RESTORE_SMOKE evidence privately
- [ ] Keep production recovery issue #907 OPEN
