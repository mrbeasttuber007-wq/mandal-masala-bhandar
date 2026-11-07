#!/usr/bin/env bash
# Runs every automated test. Needs the local test PostgreSQL (see docs/TESTING.md).
set -e
cd "$(dirname "$0")/.."
bash tests/db/reset.sh mmb_test >/dev/null && node --test tests/db/db.test.mjs
bash tests/db/reset.sh mmb_test >/dev/null && node --test tests/notify/notify.test.mjs
