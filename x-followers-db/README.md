# x-followers-db

SpacetimeDB module that stores **raw** public X data for a brand's followers. No AI-inferred fields live here; personas go in a separate system later.

Live database: `spacetime-x-followers` on maincloud.

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

All upsert reducers are idempotent. Tables are publicly readable; only the publishing identity can write (add more with `add_admin`).

## Commands

```bash
npm install
spacetime build
spacetime publish spacetime-x-followers -s maincloud --module-path .   # update the live DB
./smoke-test.sh                                                        # write, verify, delete a fake row chain
spacetime sql -s maincloud spacetime-x-followers "SELECT * FROM x_user"
```
