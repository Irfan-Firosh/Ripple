#!/usr/bin/env bash
# Lab reducers on a scratch Maincloud DB, then deletes it. Never the live DB.
set -euo pipefail
DB="${1:-ripple-lab-smoke}"; SERVER="${SERVER:-maincloud}"
[ "$DB" = "ripple-mhacks" ] && { echo "refusing to smoke-test the live DB"; exit 1; }
call() { spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1 || { echo "FAIL: $1 $2"; exit 1; }; }
must_fail() { if spacetime call --no-config -s "$SERVER" "$DB" "$@" >/dev/null 2>&1; then echo "FAIL: $1 should have been rejected"; exit 1; fi; }
sql() { spacetime sql --no-config -s "$SERVER" "$DB" "$1" 2>/dev/null; }
expect() { echo "$1" | grep -q "$2" || { echo "FAIL: expected '$2' in:"; echo "$1"; exit 1; }; }

spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || true
spacetime publish --no-config "$DB" -s "$SERVER" --module-path . -y >/dev/null

# Calibration validation
must_fail set_sim_calibration '"default"' 0 0.6 1 1 1 1 '"anchor"' '""'          # feedReach must be > 0
must_fail set_sim_calibration '"default"' 0.3 0.6 11 1 1 1 '"anchor"' '""'        # scale > 10
call set_sim_calibration '"default"' 1.0 1.0 1 1 1 1 '"test"' '"deterministic"'

# Per-signal cascade: u1 always likes, u2 always reposts, u3 (neighbour of u2) always quotes, u4 never acts.
call replace_audience_edges '"b"' '[{"a":"u2","b":"u3","kind":"niche_hub"}]'
call create_sim_run '"r1"' '"b"' '"Ship it"' 4
call set_sim_probs '"r1"' '[{"user_id":"u1","p_engage":1,"action":"like","reason":"x"},{"user_id":"u2","p_engage":1,"action":"repost","reason":"x"},{"user_id":"u3","p_engage":1,"action":"quote","reason":"x"},{"user_id":"u4","p_engage":0,"action":"ignore","reason":"x"}]'
must_fail set_sim_signal_probs '"r1"' '[{"user_id":"u1","p_like":2,"p_repost":0,"p_reply":0,"p_quote":0}]'
call set_sim_signal_probs '"r1"' '[{"user_id":"u1","p_like":1,"p_repost":0,"p_reply":0,"p_quote":0},{"user_id":"u2","p_like":0,"p_repost":1,"p_reply":0,"p_quote":0},{"user_id":"u3","p_like":0,"p_repost":0,"p_reply":0,"p_quote":1},{"user_id":"u4","p_like":0,"p_repost":0,"p_reply":0,"p_quote":0}]'
call start_cascade '"r1"' 50
expect "$(sql "SELECT p_50 FROM sim_signal WHERE sim_signal_id = 'r1:like'")" ' 1'
expect "$(sql "SELECT p_50 FROM sim_signal WHERE sim_signal_id = 'r1:repost'")" ' 1'
expect "$(sql "SELECT p_50 FROM sim_signal WHERE sim_signal_id = 'r1:quote'")" ' 1'
expect "$(sql "SELECT p_50 FROM sim_signal WHERE sim_signal_id = 'r1:reply'")" ' 0'
expect "$(sql "SELECT COUNT(*) AS n FROM sim_event WHERE run_id = 'r1'")" ' 3'
expect "$(sql "SELECT like_share FROM sim_node_signal WHERE sim_node_signal_id = 'r1:u1'")" ' 1'

# Lab queue: brand "brandx" (user 100) with one twin (alice), set up exactly like smoke-twins.sh
must_fail request_lab_experiment '"nobody"' '"t"' '"a"' '"b"'                        # unknown brand
call upsert_x_user '"100"' '"brandx"' '"Brand X"' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}' '{"none":[]}'
must_fail request_lab_experiment '"brandx"' '"t"' '"a"' '"b"'                        # brand has no twins yet
call upsert_niche '"backend_infra"' '"Backend, databases & cloud"' '"Servers and databases"'
call start_twin_build_run '"run1"' '"100"' 1
call publish_twin '"run1"' '"1"' '"alice"' '"100"' 3 0.3 0.1 0.3 10 100 0.05 '[15]' \
  '[{"topic":"backend_infra","affinity":0.9}]' '"dry"' '"DB engineer."' '["benchmarks"]' '["memes"]' '[]' '["p2"]' '"m"'
must_fail request_lab_experiment '"brandx"' '"t"' '""' '"b"'                          # empty draft
must_fail request_lab_experiment '"brandx"' '"t"' '"a"' "\"$(printf 'x%.0s' $(seq 1 1001))\""   # draft over 1000 chars
call request_lab_experiment '"brandx"' '"Launch copy"' '"Draft A"' '"Draft B"'
expect "$(sql "SELECT status FROM lab_experiment WHERE brand = 'brandx'")" 'queued'
call claim_lab_experiment 1
must_fail claim_lab_experiment 1                                                      # already claimed
call attach_lab_runs 1 '"r1"' '"r2"'
call finish_lab_experiment 1 '"B"' 0.42
expect "$(sql "SELECT status, winner FROM lab_experiment WHERE experiment_id = 1")" 'done.*B'
call set_backtest_result '"raycast"' '"pairwise_accuracy_likes"' 0.68 0.5 40 '"test split"'
expect "$(sql "SELECT value FROM backtest_result WHERE backtest_result_id = 'raycast:pairwise_accuracy_likes'")" '0.68'

spacetime delete --no-config -s "$SERVER" "$DB" -y >/dev/null 2>&1 || echo "note: delete $DB manually"
echo "smoke-lab OK"
