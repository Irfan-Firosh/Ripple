#!/usr/bin/env bash
# Writes one fake brand -> follower -> post chain through every reducer, checks it, then deletes it.
set -euo pipefail

DB="${DB:-ripple-mhacks}"
SERVER="${SERVER:-maincloud}"
N='{"none":[]}'
s() { printf '{"some":%s}' "$1"; }
call() { spacetime call -s "$SERVER" "$DB" "$@" >/dev/null 2>&1 || { echo "FAIL: $1"; exit 1; }; }
sql() { spacetime sql -s "$SERVER" "$DB" "$1" 2>/dev/null; }

echo "writing test rows..."
call start_ingestion_run '"smoke-run"' '"smoke_brand"' 1

call upsert_x_user '"smoke-brand"' '"smoke_brand"' '"Smoke Brand"' "$N" "$N" "$(s '"2020-01-01T00:00:00.000Z"')" \
  "$N" "$N" "$(s false)" "$(s true)" "$(s '"business"')" "$(s 1000)" "$(s 10)" "$(s 5)" "$(s 200)" "$N" "$(s 30)"
call upsert_x_user '"smoke-follower"' '"smoke_follower"' '"Smoke Follower"' "$(s '"building consumer apps | photographer"')" \
  "$(s '"Detroit"')" "$(s '"2019-05-01T00:00:00.000Z"')" "$N" "$N" "$(s false)" "$(s false)" "$N" \
  "$(s 150)" "$(s 300)" "$(s 2)" "$(s 900)" "$(s 4000)" "$(s 12)"
call upsert_audience_membership '"smoke-brand"' '"smoke-follower"' '"smoke-run"' '"follower"'

post() {  # $1 = impression count
  call upsert_x_post '"smoke-post"' '"smoke-follower"' '"@smoke_brand AI agents are getting way too complicated #ai"' \
    '"2026-10-01T12:00:00.000Z"' "$(s '"en"')" "$(s '"smoke-brand"')" true false \
    "$(s "$1")" "$(s 12)" "$(s 3)" "$(s 0)" "$(s 1)" "$(s 2)"
}
post 500
call upsert_post_reference '"smoke-post"' '"smoke-parent"' '"replied_to"'
call upsert_post_entity '"smoke-post"' '"mention"' '"smoke_brand"' 0 12 "$(s '"smoke-brand"')" "$N" "$N"
call upsert_post_entity '"smoke-post"' '"hashtag"' '"ai"' 55 58 "$N" "$N" "$N"
call upsert_context_annotation '"smoke-post"' '"131"' '"Unified Twitter Taxonomy"' '"smoke-ai"' \
  '"Artificial intelligence"' "$N"
call upsert_post_media '"smoke-post"' '"3_smoke"' '"photo"' "$(s '"https://pbs.twimg.com/media/smoke.jpg"')" \
  "$(s '"a screenshot"')" "$N"

# Same post again should update, not duplicate.
post 600

call update_ingestion_run '"smoke-run"' "$(s '"smoke-brand"')" 1 1 1 0 0 1 "$(s '"smoke-follower"')" "$N"
call complete_ingestion_run '"smoke-run"' '"completed"' "$N"

if spacetime call -s "$SERVER" --anonymous "$DB" upsert_post_reference '"x"' '"y"' '"quoted"' >/dev/null 2>&1; then
  echo "FAIL: anonymous caller was allowed to write"; exit 1
fi

echo "checking..."
check() {
  local out; out=$(sql "$2")
  if grep -q -- "$3" <<<"$out"; then echo "ok   $1"; else echo "FAIL $1"; echo "$out"; exit 1; fi
}
check "follower linked to brand" \
  "SELECT u.* FROM x_user u JOIN audience_membership m ON u.user_id = m.follower_user_id WHERE m.brand_user_id = 'smoke-brand'" \
  '"smoke_follower"'
check "post updated, not duplicated" "SELECT COUNT(*) AS n FROM x_post WHERE post_id = 'smoke-post'" ' 1'
check "post has new metrics" "SELECT impression_count FROM x_post WHERE post_id = 'smoke-post'" '600'
check "post reference" "SELECT reference_type FROM x_post_reference WHERE post_id = 'smoke-post'" 'replied_to'
check "post entities" "SELECT COUNT(*) AS n FROM x_post_entity WHERE post_id = 'smoke-post'" ' 2'
check "context annotation" "SELECT entity_name FROM x_context_annotation WHERE post_id = 'smoke-post'" 'Artificial intelligence'
check "media" "SELECT type FROM x_post_media WHERE post_id = 'smoke-post'" 'photo'
check "run completed" "SELECT status FROM x_ingestion_run WHERE ingestion_run_id = 'smoke-run'" 'completed'

echo "cleaning up..."
sql "DELETE FROM x_post_media WHERE post_id = 'smoke-post'" >/dev/null
sql "DELETE FROM x_context_annotation WHERE post_id = 'smoke-post'" >/dev/null
sql "DELETE FROM x_post_entity WHERE post_id = 'smoke-post'" >/dev/null
sql "DELETE FROM x_post_reference WHERE post_id = 'smoke-post'" >/dev/null
sql "DELETE FROM x_post WHERE post_id = 'smoke-post'" >/dev/null
sql "DELETE FROM audience_membership WHERE brand_user_id = 'smoke-brand'" >/dev/null
sql "DELETE FROM x_user WHERE user_id = 'smoke-brand'" >/dev/null
sql "DELETE FROM x_user WHERE user_id = 'smoke-follower'" >/dev/null
sql "DELETE FROM x_ingestion_run WHERE ingestion_run_id = 'smoke-run'" >/dev/null
echo "all good"
