#!/usr/bin/env bash
# Exercises the simulation reducers on a scratch Maincloud DB, then deletes it. Never the live DB.
set -euo pipefail
DB="${1:-ripple-sim-smoke}"; SERVER="${SERVER:-maincloud}"
[ "$DB" = "ripple-mhacks" ] && { echo "refusing to smoke-test the live DB"; exit 1; }
call() { spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1 || { echo "FAIL: $1"; exit 1; }; }
must_fail() { if spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1; then echo "FAIL: $1 should have been rejected"; exit 1; fi; }
sql() { spacetime sql --no-config -s "$SERVER" "$DB" "$1" 2>/dev/null; }
expect() { echo "$1" | grep -q "$2" || { echo "FAIL: expected '$2' in:"; echo "$1"; exit 1; }; }

spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || true
spacetime publish --no-config "$DB" -s "$SERVER" --module-path . -y >/dev/null

call replace_audience_edges '"b"' '[{"a":"u1","b":"u2","kind":"niche_hub"},{"a":"u2","b":"u3","kind":"niche_ring"}]'
expect "$(sql "SELECT COUNT(*) AS n FROM audience_edge WHERE brand_user_id = 'b'")" ' 2'
call replace_audience_edges '"b"' '[{"a":"u1","b":"u3","kind":"reply"}]'                  # replaces, not appends
expect "$(sql "SELECT COUNT(*) AS n FROM audience_edge WHERE brand_user_id = 'b'")" ' 1'

call create_sim_run '"r1"' '"b"' '"Ship it"' 3
must_fail start_cascade '"r1"' 50                                                            # no probabilities yet
must_fail set_sim_probs '"r1"' '[{"user_id":"u1","p_engage":1.5,"action":"like","reason":"x"}]'  # p out of range
call set_sim_probs '"r1"' '[{"user_id":"u1","p_engage":1.0,"action":"repost","reason":"fan"},{"user_id":"u2","p_engage":1.0,"action":"reply","reason":"fan"},{"user_id":"u3","p_engage":0.0,"action":"ignore","reason":"no"}]'
call start_cascade '"r1"' 200
must_fail start_cascade '"r1"' 200                                                           # once per run
expect "$(sql "SELECT status FROM sim_run WHERE run_id = 'r1'")" 'replaying\|done'
expect "$(sql "SELECT reach_p_90 FROM sim_run WHERE run_id = 'r1'")" ' [12]'                  # u3 never engages
expect "$(sql "SELECT COUNT(*) AS n FROM sim_node WHERE run_id = 'r1'")" ' 3'
expect "$(sql "SELECT engaged_share FROM sim_node WHERE sim_node_id = 'r1:u3'")" ' 0'
sleep 4
expect "$(sql "SELECT status FROM sim_run WHERE run_id = 'r1'")" 'done'                      # replay finished
call create_sim_run '"r2"' '"b"' '"x"' 1
call fail_sim_run '"r2"' '"scoring failed"'
expect "$(sql "SELECT status, error FROM sim_run WHERE run_id = 'r2'")" 'failed.*scoring failed'

spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || echo "note: delete $DB manually"
echo "smoke-sim OK"
