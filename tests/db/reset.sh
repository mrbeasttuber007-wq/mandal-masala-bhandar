#!/usr/bin/env bash
# Rebuilds a throw-away test database from the real SQL files.  usage: reset.sh [dbname]
set -euo pipefail
DB=${1:-mmb_test}; H="-h /tmp -p ${PGPORT:-54329} -U postgres"
cd "$(dirname "$0")/../.."
bash scripts/build-setup-sql.sh >/dev/null
psql $H -qAt -c "drop database if exists $DB" -c "create database $DB" postgres
psql $H -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/supabase_shim.sql
psql $H -q -v ON_ERROR_STOP=1 -d $DB -f supabase/setup.sql 2>&1 | grep -v NOTICE || true
psql $H -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/gateway.sql
echo "database $DB ready"
