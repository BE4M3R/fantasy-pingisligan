#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -gt 1 ]]; then
  echo "Usage: npm run db:backup -- [/path/to/private/OneDrive/folder]" >&2
  exit 2
fi

backup_root=${1:-"$HOME/OneDrive/fantasy-pingisligan-db-backups"}
mkdir -p "$backup_root"
chmod 700 "$backup_root"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$backup_root/$timestamp"
mkdir "$backup_dir"
chmod 700 "$backup_dir"

db_url=${SUPABASE_DB_URL:-}
if [[ -z "$db_url" ]]; then
  read -r -s -p "Hosted Supabase Postgres connection URL: " db_url
  printf '\n'
fi
if [[ -z "$db_url" ]]; then
  echo "A connection URL is required." >&2
  exit 2
fi

cleanup() {
  unset db_url
}
trap cleanup EXIT

echo "Writing backup files to $backup_dir"
npx --no-install supabase db dump --db-url "$db_url" --role-only --file "$backup_dir/roles.sql"
npx --no-install supabase db dump --db-url "$db_url" --file "$backup_dir/schema.sql"
npx --no-install supabase db dump --db-url "$db_url" --data-only --use-copy \
  --exclude storage.buckets_vectors \
  --exclude storage.vector_indexes \
  --file "$backup_dir/data.sql"

chmod 600 "$backup_dir"/*.sql
printf 'Backup completed at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$backup_dir/README.txt"
chmod 600 "$backup_dir/README.txt"
echo "Backup completed. Confirm OneDrive has finished syncing this folder."
