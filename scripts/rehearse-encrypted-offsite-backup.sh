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
trap 'rm -rf "$work"' EXIT
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
SQL
digest="SELECT md5(string_agg(id::text || ':' || organization_id || ':' || reference || ':' || amount_cents, ',' ORDER BY id)) FROM public.p0_4_offsite_probe"
source="$(docker exec "$container" psql -XAt -U postgres -d app_db -c "$digest" | tr -d '\r\n')"
test -n "$source"

age-keygen -o "$work/age-identity.txt" >/dev/null 2>&1
recipient="$(age-keygen -y "$work/age-identity.txt")"

# A non-plaintext encrypted custom archive is generated FROM the disposable
# PostgreSQL18 database. Encryption happens before the temp file is written.
docker exec "$container" pg_dump -U postgres -d app_db -Fc --no-owner --no-acl |
  age -r "$recipient" > "$work/encrypted.pgdump.age"
test -s "$work/encrypted.pgdump.age"

# Bit corruption is detected by the outer archive digest.
cipher_sha="$(sha256sum "$work/encrypted.pgdump.age" | cut -d ' ' -f1)"
cp "$work/encrypted.pgdump.age" "$work/tampered.pgdump.age"
printf 'DAMAGED' >> "$work/tampered.pgdump.age"
if printf '%s  %s\n' "$cipher_sha" "$work/tampered.pgdump.age" |
    sha256sum -c - >/dev/null 2>&1; then
  echo "OFFSITE_SMOKE_CORRUPTED_ARTIFACT_ACCEPTED" >&2; exit 1
fi

# A wrong decryption key cannot read the ciphertext.
age-keygen -o "$work/unrelated-key.txt" >/dev/null 2>&1
if age -d -i "$work/unrelated-key.txt" "$work/encrypted.pgdump.age" \
  > "$work/wrong-decrypt.dump" 2>/dev/null; then
  echo "OFFSITE_SMOKE_WRONG_AGE_KEY_ACCEPTED" >&2; exit 1
fi

age -d -i "$work/age-identity.txt" \
  "$work/encrypted.pgdump.age" > "$work/decrypted.dump"
test -s "$work/decrypted.dump"

# Restore into a separate disposable DB. No original rows are modified.
docker exec "$container" createdb -U postgres offsite_restore_test
docker exec -i "$container" pg_restore -U postgres -d offsite_restore_test \
  --no-owner --no-acl --exit-on-error < "$work/decrypted.dump"
restored="$(docker exec "$container" psql -XAt -U postgres \
  -d offsite_restore_test -c "$digest" | tr -d '\r\n')"
test "$source" = "$restored"
restored_count="$(docker exec "$container" psql -XAt -U postgres \
  -d offsite_restore_test -c 'SELECT count(*) FROM public.p0_4_offsite_probe' |
  tr -d '\r\n')"
test "$restored_count" = 50
if docker exec "$container" psql -X -U postgres -d offsite_restore_test \
 -v ON_ERROR_STOP=1 -c "INSERT INTO p0_4_offsite_probe VALUES(999,101,'BAD',-1)" \
 >/dev/null 2>&1; then
 echo "OFFSITE_SMOKE_RESTORED_CHECK_MISSING" >&2
 exit 1
fi
echo "Synthetic PG18 backup -> age encryption -> decrypt -> fresh restore -> digest and constraint test PASSED"
