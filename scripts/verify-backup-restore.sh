#!/usr/bin/env bash
set -euo pipefail

# This drill is deliberately limited to the disposable PostgreSQL GitHub
# Actions service. It must never be pointed at a customer/production database.
if [ "$(printenv DR_REHEARSAL_MODE || true)" != "isolated-ci-only" ] || [ "$(printenv CI || true)" != "true" ] || [ -z "$(printenv PG_CONTAINER || true)" ]; then
  echo "Refusing DR rehearsal outside isolated GitHub CI PostgreSQL."
  exit 2
fi

container="$PG_CONTAINER"
if ! docker inspect "$container" --format '{{.State.Running}}' | grep -qx true; then
  echo "Isolated PostgreSQL service container is unavailable."
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p qa-artifacts

# Synthetic data only. No real payroll records or production backups enter CI.
docker exec -i "$container" psql -X -U postgres -d app_db -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS dr_probe_parent (
  id integer PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  cents integer NOT NULL CHECK (cents > 0)
);
CREATE TABLE IF NOT EXISTS dr_probe_child (
  id integer PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES dr_probe_parent(id),
  event_note text NOT NULL
);
TRUNCATE TABLE dr_probe_child, dr_probe_parent;
INSERT INTO dr_probe_parent
  SELECT i, 'SYNTHETIC-CI-ONLY-' || i, i * 125 FROM generate_series(1,12) AS i;
INSERT INTO dr_probe_child
  SELECT i, i, 'FICTIONAL-RESTORE-PROBE' FROM generate_series(1,12) AS i;
SQL

query_value() {
  docker exec "$container" psql -X -qAt -U postgres -d "$1" -v ON_ERROR_STOP=1 -c "$2" | tr -d '\r\n'
}
parent_sql="SELECT md5(string_agg(id::text || ':' || external_key || ':' || cents::text, ',' ORDER BY id)) FROM dr_probe_parent"
child_sql="SELECT md5(string_agg(id::text || ':' || parent_id::text || ':' || event_note, ',' ORDER BY id)) FROM dr_probe_child"
count_sql="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
source_parent="$(query_value app_db "$parent_sql")"
source_child="$(query_value app_db "$child_sql")"
source_tables="$(query_value app_db "$count_sql")"
source_rows="$(query_value app_db 'SELECT count(*) FROM dr_probe_parent')"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_seconds="$(date +%s)"
docker exec "$container" pg_dump -U postgres -d app_db --format=custom --no-owner --no-privileges > "$work/backup.dump"
test -s "$work/backup.dump"
backup_sha="$(sha256sum "$work/backup.dump" | cut -d ' ' -f 1)"

# A corrupted local artifact must be rejected before restore is even attempted.
cp "$work/backup.dump" "$work/corrupted.dump"
printf 'TAMPER' >> "$work/corrupted.dump"
if printf '%s  %s\n' "$backup_sha" "$work/corrupted.dump" | sha256sum -c - >/dev/null 2>&1; then
  echo "Corrupted backup passed the integrity check."
  exit 1
fi

docker exec "$container" createdb -U postgres dr_rehearsal_restore
docker exec -i "$container" pg_restore -U postgres -d dr_rehearsal_restore --no-owner --no-privileges --exit-on-error < "$work/backup.dump"

restored_parent="$(query_value dr_rehearsal_restore "$parent_sql")"
restored_child="$(query_value dr_rehearsal_restore "$child_sql")"
restored_tables="$(query_value dr_rehearsal_restore "$count_sql")"
restored_rows="$(query_value dr_rehearsal_restore 'SELECT count(*) FROM dr_probe_parent')"

test "$source_parent" = "$restored_parent"
test "$source_child" = "$restored_child"
test "$source_tables" = "$restored_tables"
test "$source_rows" = "$restored_rows"
test "$restored_rows" = "12"

# Foreign-key enforcement must survive the restored schema.
if docker exec "$container" psql -X -U postgres -d dr_rehearsal_restore -v ON_ERROR_STOP=1 \
  -c "INSERT INTO dr_probe_child(id, parent_id, event_note) VALUES (777, 999, 'MUST-FAIL')" >/dev/null 2>&1; then
  echo "Restored foreign-key integrity failed."
  exit 1
fi

# Rehearse a failed transaction rollback and prove the recovered digest is intact.
docker exec -i "$container" psql -X -U postgres -d dr_rehearsal_restore -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
UPDATE dr_probe_parent SET cents = cents + 99999 WHERE id = 1;
ROLLBACK;
SQL
test "$(query_value dr_rehearsal_restore "$parent_sql")" = "$source_parent"

finished_seconds="$(date +%s)"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration="$((finished_seconds - started_seconds))"
printf '{"schemaVersion":1,"kind":"synthetic-postgresql-restore-rehearsal","status":"engineering-verified-only","customerDataUsed":false,"productionRpoRtoCertified":false,"startedAt":"%s","finishedAt":"%s","restoreSeconds":%s,"originalTableCount":%s,"restoredTableCount":%s,"syntheticRows":%s,"backupSha256":"%s","sourceFixtureDigest":"%s","restoredFixtureDigest":"%s","corruptArtifactRejected":true,"foreignKeyConstraintVerified":true,"transactionRollbackVerified":true,"requiresProductionLikeIndependentDrill":true}\n' \
  "$started_at" "$finished_at" "$duration" "$source_tables" "$restored_tables" "$source_rows" "$backup_sha" "$source_parent" "$restored_parent" \
  > qa-artifacts/dr-rehearsal.json
echo "Isolated backup/restore rehearsal passed; this is not production recovery certification."
