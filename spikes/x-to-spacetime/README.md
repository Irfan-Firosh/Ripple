# Spike: X data → SpacetimeDB (throwaway)

Run on 2026-10-03. This answers three questions:

1. Can our key pull X data?
2. Can Python write it into SpacetimeDB?
3. Do subscribers get pushed updates live?

**Answer: yes to all three, with one big caveat (see Findings).** This code is throwaway. Don't build on it directly.

## What's here

| File                                 | Purpose                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch_x.py`                         | Calls the xAI Responses API (`grok-4.3` + `x_search`, last 7 days) for ~15 posts on a topic as JSON. Reads `X_API_KEY` from the repo-root `.env` and never prints it.                                         |
| `load_to_spacetime.py`               | Upserts the posts via SpacetimeDB's **HTTP reducer API**: `POST /v1/database/<db>/call/upsert_post`. Options are SATS-JSON `{"some": v}` / `{"none": []}`. Auth is the CLI token from `~/.config/spacetime/cli.toml`. |
| `ripple-spike/spacetimedb/src/index.ts` | TypeScript module: public table `x_post` (PK `post_id`) + reducer `upsertPost` (wire name `upsert_post`).                                                                                                     |

## Run it

```sh
spacetime start                                     # local server on :3000
cd ripple-spike && spacetime publish ripple-spike --server local --yes --module-path ./spacetimedb && cd ..
python3 fetch_x.py "AI agents for small business" /tmp/x_sample.json
python3 load_to_spacetime.py /tmp/x_sample.json
spacetime sql ripple-spike "SELECT author_handle, likes, reposts FROM x_post" --server local
spacetime subscribe ripple-spike "SELECT * FROM x_post" --server local --timeout 30   # watch live pushes
```

## Findings

- **The key is an xAI (Grok) key, not an X API key.** X data therefore comes through Grok `x_search`.
- **What came back:** 15/15 posts with url, author, text, created_at, and likes / reposts / replies / quotes / views.
- **The posts are real.** All 15 URLs were confirmed via Twitter's public oEmbed endpoint.
- **The engagement counts are Grok-reported** and were not independently verified.
- **Cost:** about $0.14 for one call (20.5k tokens, 4 server-side tool calls).
- **Big caveat: no graph.** `x_search` gives posts and counts. It gives **no follower graph and no "who reposted"**. X can't be the source for the audience graph or the twins; that remains **Bluesky**. X data fits:
  - content and narrative signal,
  - backtest *targets* (how much real engagement a post got),
  - and aggregate checks.
- **Python → SpacetimeDB works over plain HTTP.** No SDK needed. Reducer calls returned 200, and the rows queried back correctly.
- **Real-time works.** A `spacetime subscribe` client received the update (delete + insert) the moment the reducer committed, with no polling.
- **Ethics:** this stores public posts with author handles, which is fine for a spike. The product rule still holds: never build per-person profiles from X.
