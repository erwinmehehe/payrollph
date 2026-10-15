#!/usr/bin/env bash
set -euo pipefail
umask 077
# Synthetic database data only. This may run solely inside disposable CI.
if [[ "${CI:-}" != true || "${DR_OFFSITE_SMOKE:-}" != isolated-ci-only ||
      -z "${PG_CONTAINER:-}" || "${GITHUB_ACTIONS:-}" != true ]]; then
  echo "OFFSITE_SMOKE_ISOLATED_CI_ONLY" >&2
  exit 2
fi
container="$PG_CONTAINER"
docker inspect "$container" --format '{{.State.Running}}' | grep -qx true
command -v age >/dev/null
command -v age-keygen >/dev/null

work="$(mktemp -d)"
restore_container=""
cleanup() {
  if [[ -n "$restore_container" ]]; then
    docker rm -f "$restore_container" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
docker exec -i "$container" psql -X -U postgres -d app_db -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE public.p0_4_offsite_probe (
  id integer PRIMARY KEY,
  organization_id integer NOT NULL,
  reference text NOT NULL UNIQUE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0)
);
INSERT INTO public.p0_4_offsite_probe
  SELECT i, 101, 'SYNTHETIC-CI-ONLY-' || i::text, i*125
  FROM generate_series(1,50) i;
CREATE SEQUENCE public.p0_4_offsite_sequence START WITH 501;
SELECT nextval('public.p0_4_offsite_sequence');
SELECT nextval('public.p0_4_offsite_sequence');
SQL
digest="SELECT md5(string_agg(id::text || ':' || organization_id || ':' || reference || ':' || amount_cents, ',' ORDER BY id)) FROM public.p0_4_offsite_probe"
source="$(docker exec "$container" psql -XAt -U postgres -d app_db -c "$digest" | tr -d '\r\n')"
test -n "$source"
source_amount="$(docker exec "$container" psql -XAt -U postgres -d app_db \
  -c 'SELECT coalesce(sum(amount_cents),0)::bigint FROM public.p0_4_offsite_probe' | tr -d '\r\n')"
test "$source_amount" = 159375
source_sequence="$(docker exec "$container" psql -XAt -U postgres -d app_db \
  -c "SELECT last_value FROM public.p0_4_offsite_sequence" | tr -d '\r\n')"
test "$source_sequence" = 502

age-keygen -o "$work/age-identity.txt" >/dev/null 2>&1
recipient="$(age-keygen -y "$work/age-identity.txt")"

# A non-plaintext encrypted custom archive is generated FROM the disposable
# PostgreSQL18 database. Encryption happens before the temp file is written.
docker exec "$container" pg_dump -U postgres -d app_db -Fc --no-owner --no-acl |
  age -r "$recipient" > "$work/encrypted.pgdump.age"
test -s "$work/encrypted.pgdump.age"

# Bit corruption is detected by the outer archive digest.
cipher_sha="$(sha256sum "$work/encrypted.pgdump.age" | cut -d ' ' -f1)"

# Simulate detached media without claiming a durable offsite backup.
# Verify and RESTORE ONLY the separate copy, never the original encrypted file.
mkdir -m 700 "$work/detached-media"
cp "$work/encrypted.pgdump.age" "$work/detached-media/offsite.pgdump.age"
printf '%s  %s\n' "$cipher_sha" "$work/detached-media/offsite.pgdump.age" |
  sha256sum -c - >/dev/null
copy_sha="$(sha256sum "$work/detached-media/offsite.pgdump.age" | cut -d ' ' -f1)"
test "$copy_sha" = "$cipher_sha"
cmp -s "$work/encrypted.pgdump.age" "$work/detached-media/offsite.pgdump.age"
cp "$work/encrypted.pgdump.age" "$work/tampered.pgdump.age"
printf 'DAMAGED' >> "$work/tampered.pgdump.age"
if printf '%s  %s\n' "$cipher_sha" "$work/tampered.pgdump.age" |
    sha256sum -c - >/dev/null 2>&1; then
  echo "OFFSITE_SMOKE_CORRUPTED_ARTIFACT_ACCEPTED" >&2; exit 1
fi

# A wrong decryption key cannot read the ciphertext.
age-keygen -o "$work/unrelated-key.txt" >/dev/null 2>&1
if age -d -i "$work/unrelated-key.txt" "$work/encrypted.pgdump.age" \
  > /dev/null 2>/dev/null; then
  echo "OFFSITE_SMOKE_WRONG_AGE_KEY_ACCEPTED" >&2; exit 1
fi

# Restore only the VERIFIED DETACHED CIPHERTEXT into a network-disconnected
# NEW PostgreSQL 18 container. The original source container is not the target.
# Never run an actual production backup or restore in this synthetic test.
restore_image="$(docker image inspect postgres:18 --format '{{.Id}}')"
[[ "$restore_image" =~ ^sha256:[0-9a-f]{64}$ ]] ||
  { echo "OFFSITE_SMOKE_PG18_IMAGE_UNAVAILABLE" >&2; exit 1; }
restore_container="payrollph-p0-4-offline-restore-$GITHUB_RUN_ID-$$"
docker run -d --rm --network none --security-opt no-new-privileges \
  --name "$restore_container" \
  -e POSTGRES_PASSWORD=fictional-ci-only-unroutable \
  -e POSTGRES_DB=offsite_restore_test "$restore_image" >/dev/null
mode="$(docker inspect "$restore_container" --format '{{.HostConfig.NetworkMode}}')"
test "$mode" = none ||
  { echo "OFFSITE_SMOKE_RESTORE_NETWORK_NOT_ISOLATED" >&2; exit 1; }

ready=false
for attempt in $(seq 1 60); do
  if docker exec "$restore_container" pg_isready -q -U postgres \
    -d offsite_restore_test; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true ||
  { echo "OFFSITE_SMOKE_PG18_RESTORE_NOT_READY" >&2; exit 1; }

# No decrypted file exists: age plaintext is streamed directly into pg_restore.
age -d -i "$work/age-identity.txt" "$work/detached-media/offsite.pgdump.age" |
  docker exec -i "$restore_container" pg_restore -U postgres \
    -d offsite_restore_test --no-owner --no-acl \
    --single-transaction --exit-on-error
restored="$(docker exec "$restore_container" psql -XAt -U postgres \
  -d offsite_restore_test -c "$digest" | tr -d '\r\n')"
test "$source" = "$restored" ||
  { echo "OFFSITE_SMOKE_RESTORED_DATA_DIGEST_MISMATCH" >&2; exit 1; }
restored_count="$(docker exec "$restore_container" psql -XAt -U postgres \
  -d offsite_restore_test -c 'SELECT count(*) FROM public.p0_4_offsite_probe' |
  tr -d '\r\n')"
test "$restored_count" = 50
restored_amount="$(docker exec "$restore_container" psql -XAt -U postgres \
  -d offsite_restore_test \
  -c 'SELECT coalesce(sum(amount_cents),0)::bigint FROM public.p0_4_offsite_probe' |
  tr -d '\r\n')"
test "$restored_amount" = "$source_amount" ||
  { echo "OFFSITE_SMOKE_RESTORED_AMOUNT_CENTS_MISMATCH" >&2; exit 1; }
restored_sequence="$(docker exec "$restore_container" psql -XAt -U postgres \
  -d offsite_restore_test \
  -c 'SELECT last_value FROM public.p0_4_offsite_sequence' | tr -d '\r\n')"
test "$restored_sequence" = "$source_sequence" ||
  { echo "OFFSITE_SMOKE_RESTORED_SEQUENCE_MISMATCH" >&2; exit 1; }
if docker exec "$restore_container" psql -X -U postgres \
  -d offsite_restore_test -v ON_ERROR_STOP=1 \
  -c "INSERT INTO p0_4_offsite_probe VALUES(999,101,'BAD',-1)" \
  >/dev/null 2>&1; then
  echo "OFFSITE_SMOKE_RESTORED_CHECK_MISSING" >&2; exit 1
fi

# CI artifact contains ONLY synthetic facts and the ciphertext checksum.
# No database dumps, keys, decryption material or source table values are saved.
mkdir -p qa-artifacts
printf '{"kind":"p0-4-fictional-offline-restore","status":"SYNTHETIC_ONLY_PASS","postgresMajor":18,"syntheticRows":50,"amountCents":159375,"sequenceLastValue":502,"originalCiphertextSha256":"%s","detachedCopyCiphertextSha256":"%s","detachedCopyVerified":true,"tamperedCopyRejected":true,"wrongKeyRejected":true,"dataHashMatched":true,"sequenceMatched":true,"constraintsPreserved":true,"restoreNetworkMode":"none","archiveRetained":false,"actualProductionBackup":false,"independentExternalMedia":false,"productionCertified":false}\n' \
  "$cipher_sha" "$copy_sha" > qa-artifacts/dr-offsite-synthetic.json

echo "Synthetic PG18 backup -> age encrypted -> detached copy -> offline networkless PG18 restore -> exact cents/sequence/constraint proof PASSED"
