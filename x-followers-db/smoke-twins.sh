#!/usr/bin/env bash
# Publishes this module to a scratch Maincloud DB and exercises every twin reducer, then deletes the DB.
# Usage: ./smoke-twins.sh [scratch-db-name]   (default ripple-twins-smoke). Never points at ripple-mhacks.
set -euo pipefail
DB="${1:-ripple-twins-smoke}"
SERVER="${SERVER:-maincloud}"
[ "$DB" = "ripple-mhacks" ] && { echo "refusing to smoke-test the live DB"; exit 1; }
N='{"none":[]}'
s() { printf '{"some":%s}' "$1"; }
call() { spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1 || { echo "FAIL: $1"; exit 1; }; }
must_fail() { if spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1; then echo "FAIL: $1 should have been rejected"; exit 1; fi; }
sql() { spacetime sql --no-config -s "$SERVER" "$DB" "$1" 2>/dev/null; }
expect() { echo "$1" | grep -q "$2" || { echo "FAIL: expected '$2' in:"; echo "$1"; exit 1; }; }

echo "publishing to scratch db $DB..."
spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || true   # start from an empty scratch DB
spacetime publish --no-config "$DB" -s "$SERVER" --module-path . -y >/dev/null

call upsert_niche '"backend_infra"' '"Backend, databases & cloud"' '"Servers and databases"'
call upsert_niche '"gaming"' '"Playing games"' '"Games"'
call start_twin_build_run '"run1"' '"100"' 3
call start_twin_build_run '"run1"' '"100"' 3            # retried start (lost reply) is a no-op
must_fail start_twin_build_run '"run1"' '"999"' 3       # same id, different brand
call set_twin_job_status '"run1"' '"1"' '"alice"' '"queued"' "$N"
call publish_twin '"run1"' '"1"' '"alice"' '"100"' 3 0.3 0.1 0.3 10 100 0.05 '[15]' \
  '[{"topic":"backend_infra","affinity":0.9},{"topic":"gaming","affinity":0.2}]' '"dry"' '"DB engineer."' '["benchmarks"]' '["memes"]' '[]' '["p2"]' '"m"'
call set_twin_job_status '"run1"' '"2"' '"bob"' '"skipped"' "$(s '"@bob: 1 posts, need 3"')"
must_fail set_twin_job_status '"run1"' '"2"' '"bob"' '"skipped"' "$(s '"again"')"   # finished jobs are final
must_fail set_twin_job_status '"run1"' '"1"' '"alice"' '"failed"' "$N"                 # ready can't become failed
call complete_twin_build_run '"run1"' '"partial"'
expect "$(sql "SELECT status, ready, failed, skipped FROM twin_build_run WHERE run_id = 'run1'")" 'partial.*| *1 *| *0 *| *1'
expect "$(sql "SELECT status FROM twin_build_job WHERE job_id = 'run1:1'")" 'ready'
expect "$(sql "SELECT niche, affinity FROM twin_niche WHERE twin_niche_id = '1:backend_infra'")" '"backend_infra".*0.9'
expect "$(sql "SELECT COUNT(*) AS n FROM twin_niche WHERE user_id = '1'")" ' 2'
must_fail publish_twin '"run1"' '"4"' '"d"' '"100"' 1 0 0 0 0 0 0 '[]' '[{"topic":"not_a_niche","affinity":0.5}]' \
  '"t"' '"s"' '[]' '[]' '[]' '[]' '"m"'
expect "$(sql "SELECT brand_user_id, user_id FROM twin_audience WHERE twin_audience_id = '100:1'")" '"100".*"1"'

call ask_twin '"1"' '"Our DB is 10x faster"' '""'
call claim_twin_question 1
must_fail claim_twin_question 1
call answer_twin_question 1 '"reply"' 0.7 '"Show me the benchmark."' '["p2"]'
expect "$(sql "SELECT status, action FROM twin_question WHERE question_id = 1")" 'answered.*reply'
must_fail ask_twin '"nobody"' '"x"' '""'
must_fail ask_twin '"1"' '"   "' '""'
must_fail publish_twin '"run1"' '"3"' '"c"' '"100"' 1 0 0 0 0 0 0 '[]' '[{"topic":"x","affinity":2}]' \
  '"t"' '"s"' '[]' '[]' '[]' '[]' '"m"'
must_fail answer_twin_question 1 '"reply"' 0.5 '"again"' '[]'   # already answered
# Per-sender cap counts questions being answered, not just pending ones (questions 2..4 below).
call ask_twin '"1"' '"draft two"' '""'
call ask_twin '"1"' '"draft three"' '""'
call ask_twin '"1"' '"draft four"' '""'
call claim_twin_question 2
must_fail ask_twin '"1"' '"draft five"' '""'

echo "deleting scratch db $DB..."
spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || echo "note: delete $DB manually"
echo "smoke-twins OK"
