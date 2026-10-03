# x-followers-db

SpacetimeDB module that stores **raw** public X data for a brand's followers. No AI-inferred fields live here; personas go in a separate system later.

Live database: `ripple-mhacks` on maincloud.

## Tables

| Table | Key | Notes |
|---|---|---|
| `x_user` | `user_id` | public profile + public metrics; indexed on `username` |
| `audience_membership` | `brand_user_id:follower_user_id` | indexed on `(brand_user_id, follower_user_id)` and `follower_user_id` |
| `x_post` | `post_id` | indexed on `author_user_id`, `created_at` |
| `x_post_reference` | `post_id:type:referenced_post_id` | `replied_to` / `quoted` / `retweeted` |
| `x_post_entity` | `post_id:type:start` | hashtag / cashtag / mention / url, as returned by X |
| `x_context_annotation` | `post_id:domain_id:entity_id` | X's own topic annotations |
| `x_post_media` | `post_id:media_key` | metadata + URLs only |
| `x_ingestion_run` | `ingestion_run_id` | counters + checkpoint so an import can resume |
| `twin` | `user_id` | **AI-inferred** persona + stats per person (Claude Haiku 4.5, written by `backend/twins`) |
| `twin_audience` | `brand_user_id:user_id` | which brand audiences each twin belongs to (a person following two brands has one twin, two links) |
| `niche` | `slug` | the fixed niche catalog every twin is rated against (from `backend/twins/niches.py`) |
| `twin_niche` | `user_id:niche` | one row per person per niche with an affinity 0–1; count a niche with `WHERE niche = '…'` |
| `twin_build_run` | `run_id` | live counters for a twin build (ready / failed / skipped) |
| `twin_build_job` | `run_id:user_id` | per-account build status: queued → building → ready / failed / skipped |
| `twin_question` | `question_id` | Ask-the-twin queue: anyone calls `ask_twin`; the backend worker claims and answers |

All upsert reducers are idempotent. Tables are publicly readable; only the publishing identity can write (add more with `add_admin`).

## Importing followers from X

Needs `X_BEARER_TOKEN` in the repo-root `.env` and credits on the X developer account. Raw responses are cached in `data/x_raw/<username>/` (gitignored). Rerunning only calls X for anything that isn't cached yet.

The import makes 1 followers call (the N most recent followers, $0.010 each), then 1 timeline call per public follower (at most `--posts` posts, $0.005 each). The worst case is `N * (0.01 + 0.005 * posts)`, so 95 followers x 25 posts is about $13.90.

```bash
cd ingest
../../.venv-x/bin/python ingest_x.py --followers 95 --posts 25   # real run (costs credits)
../../.venv-x/bin/python ingest_x.py --followers 1 --offline     # reload cached data only, never calls X
../../.venv-x/bin/python check_fill.py                           # per-column fill report
```

## Commands

```bash
npm install
spacetime build
spacetime publish ripple-mhacks -s maincloud --module-path .   # update the live DB
./smoke-test.sh                                                        # write, verify, delete a fake row chain
./smoke-twins.sh                                                       # twin reducers against a scratch DB (never the live one)
spacetime sql -s maincloud ripple-mhacks "SELECT * FROM x_user"
```
