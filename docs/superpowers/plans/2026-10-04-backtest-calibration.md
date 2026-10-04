# Raycast Backtest + Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how well Lab predicts real engagement, and calibrate it with real data:
- **Data:** Raycast's real Bluesky posts, plus exactly which of our 999 twinned followers liked, reposted, replied to or quoted each one.
- **Fit:** the cascade parameters, fitted on older posts.
- **Score:** prediction quality on newer, held-out posts, against honest baselines.
- **Publish:** the calibration and a headline metric that the Lab card shows.

**This is the project's last step.** Run it after the Lab demo works (`2026-10-04-lab-signals.md`).

**Architecture:**
- **Ground truth (`twins.backtest.data`):** fetched once from the public Bluesky API with `twins.bsky` (Lab plan Task 5) and cached as JSON in the repo.
- **Claude scores (`twins.backtest.scores`):** computed once per post with `score_signals`, scoring two posts per call, and cached on disk, keyed by a content hash of (post text, model, prompt).
- **Fitting and evaluation:** run locally on a vectorised NumPy mirror of the SpacetimeDB cascade (`twins.cascade`), so a parameter grid costs no Claude calls.
- **Publishing:** the fitted parameters go to `sim_calibration` (`source = backtest`), the metrics to `backtest_result`, and the full write-up to `docs/research/backtest-raycast.md`.

**Tech Stack:** Python 3.12 (`backend/`), `numpy` (new dependency), `requests`, `anthropic`, pytest; SpacetimeDB tables from the Lab plan.

**Spec:**
- the measurement design agreed in chat on 2026-10-04 (below);
- `docs/superpowers/plans/2026-10-04-lab-signals.md` (the signals, cascade semantics, `sim_calibration` and `backtest_result`).

## Measurement design (agreed 2026-10-04)

- **Population:** the 999 Raycast followers with twins. Ground truth for a post is the set of those followers who liked, reposted, replied to or quoted it. Everyone else on Bluesky is ignored, because the simulation only models these people.
- **Posts:**
  - Raycast's original posts (no replies, no reposts) from the **last 12 months**, which is 114 as of 2026-10-03;
  - excluding the last 2 days, so the counts have settled;
  - older posts are dropped, because today's followers mostly weren't following then.
- **Split:** chronological. The oldest 60% are **train** (used for calibration); the newest 40% are **test**, touched once at the end.
- **Metrics on test:**
  1. **Pairwise accuracy (headline):** across all pairs of test posts whose real follower-like counts differ, the share where the simulation's mean likes order them correctly. A coin flip scores 0.5. This is exactly the question Lab answers ("is draft B better than draft A?").
  2. **Spearman ρ:** predicted against real follower likes, and against total engagements.
  3. **Count error:** mean absolute error per signal, and coverage (the share of posts whose real count falls inside the simulated p10–p90; the target is about 0.8).
  4. **Who engages:** per-post AUC of each follower's predicted any-signal share against whether they actually engaged, plus precision@10.
- **Baselines (Lab must beat them to be worth showing):**
  - **constant (train mean):** pairwise accuracy 0.5 by construction;
  - **past engagers:** for "who", rank followers by how often they engaged with train posts;
  - **Claude-direct:** one Claude call per post asking "how many of these followers will like this?". It has no twins, and it tests whether the twins add anything.
- **Uncertainty:** 95% bootstrap confidence interval over test posts (1,000 resamples) for every headline metric.
- **Leakage audit:**
  - Twins were built from followers' own recent posts, which might include their replies to or quotes of Raycast posts.
  - Count them, and report the metrics both with and without those followers. The difference must appear in the report.
- **X (@spacetimedb):**
  - It cannot be backtested, because X likers are a paid API.
  - It uses the `default` calibration (Raycast's); the report states this as an untested transfer.

## Global Constraints

- **Claude model:** `claude-haiku-4-5-20251001` through `twins.policy.score_signals`. Never print or commit secrets.
- **Test split:** evaluated **once**, after the parameters are frozen. Never tune on test. `twins.backtest.split` enforces this, and the evaluate step refuses to run if the train fit file is missing.
- **Costs:**
  - Claude scoring is cached on disk (`backend/data/backtest/scores/`, gitignored), so a rerun costs nothing.
  - The ground-truth JSON (`backend/data/backtest/raycast-truth.json`) is public data and is committed.
- **SpacetimeDB:** additive only, no new tables (`sim_calibration` and `backtest_result` already exist from the Lab plan); reducers `set_sim_calibration` and `set_backtest_result`.
- **Reporting:** the report gives the numbers as they come out. A metric that doesn't beat its baseline is reported as such and is not shown on the Lab card.

## Review Focus

1. **The NumPy cascade disagrees with the SpacetimeDB reducer.** Calibration fitted on the mirror would then be wrong live. Covered in Task 3 (`test_mirror_matches_reference_trial_logic`) and Task 3 Step 5 (a live parity check on a scratch DB).
2. **Train/test leakage through re-tuning.** `evaluate` refuses to run without a frozen `fit.json`, and writes a hash of the fit into the report. Covered in Task 5 (`test_evaluate_requires_frozen_fit`).
3. **A post with zero follower engagement.** Pairwise pairs with equal real counts are skipped (no division by zero); AUC is skipped for posts with no engagers or all engagers. Covered in Task 5 (`test_metrics_handle_ties_and_empty_posts`).
4. **The Bluesky API rate-limits or returns partial pages mid-fetch.** The fetch retries with backoff and the cache is written per post, so a rerun resumes. Covered in Task 1 (`test_fetch_resumes_from_cache`).
5. **The calibration pushes a scale to the clamp bounds (0.001 or 10).** The report flags it and the publish step refuses scales at a bound unless `--allow-bound` is passed. Covered in Task 6 (`test_publish_refuses_bound_scales`).

---

## File Structure

```
backend/
  pyproject.toml                  # + numpy
  twins/cascade.py        (new)   # vectorised mirror of start_cascade (per-signal, Bluesky spread rules)
  twins/backtest/__init__.py (new)
  twins/backtest/data.py  (new)   # posts + ground-truth engagers → data/backtest/raycast-truth.json
  twins/backtest/scores.py (new)  # cached Claude signal scores per post (content-hash keyed)
  twins/backtest/split.py (new)   # chronological train/test split
  twins/backtest/fit.py   (new)   # grid + coordinate search on train → data/backtest/fit.json
  twins/backtest/metrics.py (new) # pairwise, spearman, MAE, coverage, AUC, precision@k, bootstrap
  twins/backtest/evaluate.py (new) # test-split evaluation + baselines + report + publish
  twins/cli.py                    # + backtest {fetch,score,fit,evaluate,publish}
  tests/test_cascade.py test_backtest_data.py test_backtest_scores.py test_backtest_fit.py test_backtest_metrics.py test_backtest_evaluate.py
  data/backtest/raycast-truth.json (committed), data/backtest/scores/ (gitignored), data/backtest/fit.json (committed)
docs/research/backtest-raycast.md (generated, committed)
```

---

### Task 1: Ground truth from Bluesky

**Files:** create `backend/twins/backtest/__init__.py` and `backend/twins/backtest/data.py`; test `backend/tests/test_backtest_data.py`.

**Interfaces:**
- Consumes: `twins.bsky.fetch_brand_posts`, `fetch_engagers` (Lab plan Task 5); the `twin_audience` and `x_user` tables.
- Produces:
  - `TruthPost(uri, text, created_at, engaged: dict[str, list[str]])`, where `engaged` maps each signal to the follower DIDs only, sorted;
  - `Truth(brand: str, brand_did: str, followers: list[str], posts: list[TruthPost], fetched_at: str)`;
  - `build_truth(stdb, brand, *, months=12, settle_days=2, cache_path, fetch_posts=..., fetch_people=..., sleep=time.sleep) -> Truth`, which resumes from the cache and saves after every post;
  - `load_truth(path) -> Truth`.

- [ ] **Step 1: Failing tests**

```python
import json

from twins.backtest.data import build_truth, load_truth
from twins.bsky import BrandPost
from conftest import FakeStdb


def bp(uri, when):
    return BrandPost(uri=uri, cid="c", text=f"text {uri}", created_at=when, like_count=3, repost_count=0, reply_count=0, quote_count=0)


def stdb():
    return FakeStdb({"x_user": [{"user_id": "did:brand", "username": "raycast.com"}],
                     "twin_audience": [{"brand_user_id": "did:brand", "user_id": u} for u in ("f1", "f2")]})


def test_truth_keeps_only_twinned_followers_and_settled_recent_posts(tmp_path):
    posts = [bp("new", "2099-01-01T00:00:00Z"), bp("p1", "2026-09-01T00:00:00Z"), bp("old", "2020-01-01T00:00:00Z")]
    people = {"like": {"f1", "stranger"}, "repost": {"f2"}, "reply": set(), "quote": set()}
    truth = build_truth(stdb(), "raycast.com", cache_path=tmp_path / "t.json", now="2026-10-03T00:00:00Z",
                        fetch_posts=lambda *a, **k: posts, fetch_people=lambda uri, **k: people)
    assert [p.uri for p in truth.posts] == ["p1"]                     # not unsettled, not older than 12 months
    assert truth.posts[0].engaged == {"like": ["f1"], "repost": ["f2"], "reply": [], "quote": []}
    assert load_truth(tmp_path / "t.json") == truth


def test_fetch_resumes_from_cache(tmp_path):
    calls = []
    posts = [bp("p1", "2026-09-01T00:00:00Z"), bp("p2", "2026-09-02T00:00:00Z")]
    people = {"like": set(), "repost": set(), "reply": set(), "quote": set()}
    kw = dict(cache_path=tmp_path / "t.json", now="2026-10-03T00:00:00Z", fetch_posts=lambda *a, **k: posts)
    build_truth(stdb(), "raycast.com", fetch_people=lambda uri, **k: calls.append(uri) or people, **kw)
    build_truth(stdb(), "raycast.com", fetch_people=lambda uri, **k: calls.append(uri) or people, **kw)
    assert sorted(calls) == ["p1", "p2"]                               # second run fetched nothing
```

Run: `cd backend && uv run pytest tests/test_backtest_data.py -v`
Expected: FAIL (`ModuleNotFoundError: twins.backtest`).

- [ ] **Step 2: Implement `backend/twins/backtest/data.py`**

```python
"""Ground truth for the Raycast backtest: who among the twinned followers engaged with each real post."""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pydantic import BaseModel

from ..bsky import fetch_brand_posts, fetch_engagers

SIGNALS = ("like", "repost", "reply", "quote")


class TruthPost(BaseModel):
    uri: str
    text: str
    created_at: str
    engaged: dict[str, list[str]]


class Truth(BaseModel):
    brand: str
    brand_did: str
    followers: list[str]
    posts: list[TruthPost]
    fetched_at: str


def load_truth(path) -> Truth:
    return Truth.model_validate_json(Path(path).read_text())


def _save(truth: Truth, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(truth.model_dump_json(indent=1))
    tmp.replace(path)


def build_truth(stdb, brand: str, *, months: int = 12, settle_days: int = 2, cache_path,
                now: str | None = None, fetch_posts=fetch_brand_posts, fetch_people=fetch_engagers,
                sleep=time.sleep) -> Truth:
    path = Path(cache_path)
    handle = brand.lstrip("@")
    brand_row = next(u for u in stdb.sql("SELECT user_id, username FROM x_user") if u["username"].lower() == handle.lower())
    followers = sorted(r["user_id"] for r in stdb.sql("SELECT brand_user_id, user_id FROM twin_audience")
                       if r["brand_user_id"] == brand_row["user_id"])
    t_now = datetime.fromisoformat((now or datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00"))
    since = (t_now - timedelta(days=30 * months)).isoformat()
    settled = (t_now - timedelta(days=settle_days)).isoformat()
    cached = load_truth(path) if path.exists() else None
    done = {p.uri: p for p in (cached.posts if cached else [])}
    wanted = [p for p in fetch_posts(handle) if since <= p.created_at.replace("Z", "+00:00") <= settled]
    fset = set(followers)
    truth = Truth(brand=handle, brand_did=brand_row["user_id"], followers=followers, posts=[], fetched_at=t_now.isoformat())
    for p in wanted:
        if p.uri not in done:
            for attempt in range(4):
                try:
                    people = fetch_people(p.uri)
                    break
                except Exception:  # noqa: BLE001 - rate limits / transient network: back off and retry
                    sleep(2 ** attempt)
            else:
                raise RuntimeError(f"could not fetch engagers for {p.uri}")
            done[p.uri] = TruthPost(uri=p.uri, text=p.text, created_at=p.created_at,
                                    engaged={s: sorted(people[s] & fset) for s in SIGNALS})
            truth.posts = [done[w.uri] for w in wanted if w.uri in done]
            _save(truth, path)
    truth.posts = [done[w.uri] for w in wanted]
    _save(truth, path)
    return truth
```

Comparing `since <= created_at.replace("Z", "+00:00") <= settled` is a string comparison of ISO timestamps. It is valid because both sides are UTC ISO-8601 with the same `+00:00` suffix.

- [ ] **Step 3: Run tests, fetch for real, commit**

```bash
cd backend && uv run pytest tests/test_backtest_data.py -v      # expected: 2 passed
uv run python -m twins backtest fetch --brand raycast.com       # writes data/backtest/raycast-truth.json
```

Expected: about 110 posts, and per post a handful of follower likes (median about 4).

Add the `backtest` CLI group to `twins/cli.py` with subcommands:
- `fetch` (`--brand`, `--out data/backtest/raycast-truth.json`);
- `score`, `fit`, `evaluate`, `publish`, each filled in by its task.

```bash
git add backend/twins/backtest backend/tests/test_backtest_data.py backend/twins/cli.py backend/data/backtest/raycast-truth.json
git commit -m "feat(backtest): Raycast ground truth from public Bluesky engagers"
```

---

### Task 2: Cached Claude scores per post

**Files:** create `backend/twins/backtest/scores.py`; test `backend/tests/test_backtest_scores.py`; add `backend/data/backtest/scores/` to `.gitignore`.

**Interfaces:**
- Consumes: `score_signals`, `SIGNAL_SYSTEM`, `MODEL`, `load_brand_twins`.
- Produces:
  - `score_key(text: str) -> str`: sha256 of `MODEL + SIGNAL_SYSTEM + text`, first 16 hex characters;
  - `score_posts(stdb, client, brand, texts: list[str], *, cache_dir, scorer=score_signals) -> dict[str, dict[str, list[float]]]`, mapping each text to `{user_id: [p_like, p_repost, p_reply, p_quote]}`. It scores two uncached texts per call, and writes one JSON file per text, so it is resumable.

- [ ] **Step 1: Failing tests**

```python
from types import SimpleNamespace

from twins.backtest.scores import score_key, score_posts


def fake_scorer(client, twins, drafts, **kw):
    fake_scorer.calls.append(list(drafts))
    return [[SimpleNamespace(user_id=t.user_id, p_like=0.1 * (k + 1), p_repost=0, p_reply=0, p_quote=0, reason="r")
             for t in twins] for k in range(len(drafts))]


def test_scores_pairs_of_posts_and_caches(tmp_path, monkeypatch):
    fake_scorer.calls = []
    monkeypatch.setattr("twins.backtest.scores.load_brand_twins",
                        lambda stdb, brand: (None, [SimpleNamespace(user_id="f1"), SimpleNamespace(user_id="f2")]))
    out = score_posts(None, None, "raycast.com", ["a", "b", "c"], cache_dir=tmp_path, scorer=fake_scorer)
    assert fake_scorer.calls == [["a", "b"], ["c"]]
    assert out["b"]["f1"] == [0.2, 0, 0, 0]
    score_posts(None, None, "raycast.com", ["a", "b", "c"], cache_dir=tmp_path, scorer=fake_scorer)
    assert len(fake_scorer.calls) == 2                                   # all cached
    assert score_key("a") != score_key("b") and len(score_key("a")) == 16
```

Run: `cd backend && uv run pytest tests/test_backtest_scores.py -v`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

```python
"""Claude signal scores for backtest posts, cached on disk by content hash (model + prompt + text)."""
import hashlib
import json
from pathlib import Path

from ..brand_twins import load_brand_twins
from ..models import MODEL
from ..policy import SIGNAL_SYSTEM, score_signals


def score_key(text: str) -> str:
    return hashlib.sha256(f"{MODEL}\n{SIGNAL_SYSTEM}\n{text}".encode()).hexdigest()[:16]


def score_posts(stdb, client, brand: str, texts: list[str], *, cache_dir, scorer=score_signals) -> dict:
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    _, twins = load_brand_twins(stdb, brand)
    todo = [t for t in dict.fromkeys(texts) if not (cache / f"{score_key(t)}.json").exists()]
    for i in range(0, len(todo), 2):
        pair = todo[i:i + 2]
        for text, scores in zip(pair, scorer(client, twins, pair)):
            row = {s.user_id: [s.p_like, s.p_repost, s.p_reply, s.p_quote] for s in scores}
            (cache / f"{score_key(text)}.json").write_text(json.dumps(row))
    return {t: json.loads((cache / f"{score_key(t)}.json").read_text()) for t in texts}
```

- [ ] **Step 3: Run tests, score for real, commit**

```bash
cd backend && uv run pytest tests/test_backtest_scores.py -v       # expected: 1 passed
uv run python -m twins backtest score --brand raycast.com          # about 55 calls per 10 twins → ~5,600 Haiku calls, ~$10-15
```

The `score` subcommand loads the truth file, calls `score_posts` for every post text, and prints how many texts were cached vs newly scored.

```bash
git add backend/twins/backtest/scores.py backend/tests/test_backtest_scores.py .gitignore backend/twins/cli.py
git commit -m "feat(backtest): cached per-post Claude signal scores"
```

---

### Task 3: NumPy mirror of the SpacetimeDB cascade

**Files:** modify `backend/pyproject.toml` (`uv add numpy`); create `backend/twins/cascade.py`; test `backend/tests/test_cascade.py`.

**Interfaces:**
- Produces:
  - `Calib(feed_reach: float, share_reach: float, scale: tuple[float, float, float, float])`, with scales in like/repost/reply/quote order;
  - `simulate(probs: np.ndarray, adj: np.ndarray, cal: Calib, *, trials: int = 200, seed: int = 0) -> CascadeStats`, where:
    - `probs` is shape `(n, 4)`, the raw Claude probabilities;
    - `adj` is a symmetric `(n, n)` bool matrix built from the `audience_edge` rows;
  - `CascadeStats(counts: np.ndarray (trials, 4), user_any_share: np.ndarray (n,), user_signal_share: np.ndarray (n, 4))`, with `.mean` (4,), `.p10`, `.p50`, `.p90`;
  - `reference_trial(...)`: a plain-Python, line-for-line copy of the TS `signalTrial`, used only by tests.
- Semantics match Lab plan Task 1:
  - exposure at tick 0 with `feed_reach`;
  - each exposed person draws each signal independently with `min(1, p * scale)`;
  - reposts and quotes expose unseen neighbours. Each spreading neighbour independently exposes with `share_reach`, so with k spreading neighbours the chance is `1 − (1 − share_reach)^k`.

- [ ] **Step 1: Failing tests**

```python
import numpy as np

from twins.cascade import Calib, reference_trial, simulate

CAL1 = Calib(feed_reach=1.0, share_reach=1.0, scale=(1, 1, 1, 1))


def line_graph(n):
    adj = np.zeros((n, n), dtype=bool)
    for i in range(n - 1):
        adj[i, i + 1] = adj[i + 1, i] = True
    return adj


def test_deterministic_probabilities_give_exact_counts():
    probs = np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0]], dtype=float)
    st = simulate(probs, line_graph(4), CAL1, trials=20)
    assert st.mean.tolist() == [1, 1, 0, 1]
    assert st.user_any_share.tolist() == [1, 1, 1, 0]


def test_only_reposts_and_quotes_spread():
    n = 50
    cal = Calib(feed_reach=0.5, share_reach=1.0, scale=(1, 1, 1, 1))
    likers = simulate(np.tile([1.0, 0, 0, 0], (n, 1)), line_graph(n), cal, trials=400, seed=1)
    reposters = simulate(np.tile([0, 1.0, 0, 0], (n, 1)), line_graph(n), cal, trials=400, seed=1)
    assert abs(likers.mean[0] - 0.5 * n) < 3           # likes never expose neighbours: only the feed half sees it
    assert reposters.mean[1] > 0.95 * n                # reposts with share_reach 1 reach the whole line


def test_mirror_matches_reference_trial_logic():
    rng = np.random.default_rng(7)
    n = 40
    probs = rng.uniform(0, 0.4, size=(n, 4))
    adj = rng.random((n, n)) < 0.08
    adj = np.triu(adj, 1); adj = adj | adj.T
    cal = Calib(feed_reach=0.35, share_reach=0.6, scale=(0.5, 1.5, 1, 2))
    fast = simulate(probs, adj, cal, trials=3000, seed=3).mean
    import random
    r = random.Random(5)
    slow = np.mean([reference_trial(r.random, probs, adj, cal) for _ in range(3000)], axis=0)
    assert np.allclose(fast, slow, rtol=0.08, atol=0.15)
```

Run: `cd backend && uv run pytest tests/test_cascade.py -v`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `backend/twins/cascade.py`**

```python
"""Vectorised mirror of the SpacetimeDB start_cascade reducer (per-signal, Bluesky spread rules).

Used only offline, for calibration and the backtest: same distribution as the reducer, ~1000x faster than calling it.
"""
from dataclasses import dataclass

import numpy as np

SPREADS = np.array([False, True, False, True])  # like, repost, reply, quote


@dataclass(frozen=True)
class Calib:
    feed_reach: float
    share_reach: float
    scale: tuple[float, float, float, float]


@dataclass(frozen=True)
class CascadeStats:
    counts: np.ndarray            # (trials, 4)
    user_any_share: np.ndarray    # (n,)
    user_signal_share: np.ndarray # (n, 4)

    @property
    def mean(self): return self.counts.mean(axis=0)
    @property
    def p10(self): return np.quantile(self.counts, 0.1, axis=0, method="nearest")
    @property
    def p50(self): return np.quantile(self.counts, 0.5, axis=0, method="nearest")
    @property
    def p90(self): return np.quantile(self.counts, 0.9, axis=0, method="nearest")


def simulate(probs: np.ndarray, adj: np.ndarray, cal: Calib, *, trials: int = 200, seed: int = 0) -> CascadeStats:
    rng = np.random.default_rng(seed)
    n = probs.shape[0]
    p = np.minimum(1.0, probs * np.asarray(cal.scale))
    a = adj.astype(np.int32)
    seen = rng.random((trials, n)) < cal.feed_reach
    acted = np.zeros((trials, n, 4), dtype=bool)
    exposed = seen.copy()
    while exposed.any():
        draws = rng.random((trials, n, 4)) < p[None, :, :]
        new_acts = draws & exposed[:, :, None]
        acted |= new_acts
        spreading = (new_acts & SPREADS).any(axis=2)                      # (trials, n)
        k = spreading.astype(np.int32) @ a                                # spreading neighbours per person
        chance = 1 - (1 - cal.share_reach) ** k
        exposed = (rng.random((trials, n)) < chance) & ~seen & (k > 0)
        seen |= exposed
    return CascadeStats(counts=acted.sum(axis=1), user_any_share=acted.any(axis=2).mean(axis=0),
                        user_signal_share=acted.mean(axis=0))


def reference_trial(rand, probs, adj, cal: Calib) -> list[int]:
    """Line-for-line copy of the TypeScript signalTrial (tests only)."""
    n = len(probs)
    nbrs = [list(np.flatnonzero(adj[i])) for i in range(n)]
    p = [[min(1.0, probs[i][s] * cal.scale[s]) for s in range(4)] for i in range(n)]
    seen, counts = set(), [0, 0, 0, 0]

    def expose(i, chance, nxt):
        if i in seen or rand() >= chance:
            return
        seen.add(i)
        spreads = False
        for s in range(4):
            if rand() < p[i][s]:
                counts[s] += 1
                spreads = spreads or SPREADS[s]
        if spreads:
            nxt.append(i)

    frontier = []
    for i in range(n):
        expose(i, cal.feed_reach, frontier)
    while frontier:
        nxt = []
        for u in frontier:
            for v in nbrs[u]:
                expose(v, cal.share_reach, nxt)
        frontier = nxt
    return counts
```

- [ ] **Step 3: Run tests**

Run: `cd backend && uv run pytest tests/test_cascade.py -v`
Expected: 3 passed.

- [ ] **Step 4: Edges loader**

Add `load_graph(stdb, brand_user_id, user_ids: list[str]) -> np.ndarray` to `cascade.py`. It reads `SELECT * FROM audience_edge WHERE brand_user_id = '…'` and indexes by the position in `user_ids`. Add a test with `FakeStdb`: two edges give a symmetric matrix with 4 True cells.

- [ ] **Step 5: Live parity with the reducer (scratch DB)**

On a scratch DB, run `smoke-lab.sh`'s setup with 30 random users and probabilities, plus `trials=1000`. Compare `sim_signal.mean` with `simulate(..., trials=5000).mean`. Expected: within 10% relative, or within 0.3 absolute.

Put this in `x-followers-db/smoke-parity.sh`. It writes the fixture through the reducers and prints both vectors; the Python side runs in `backend/scripts/parity.py`, reading the same fixture JSON.

```bash
git add backend/pyproject.toml backend/uv.lock backend/twins/cascade.py backend/tests/test_cascade.py x-followers-db/smoke-parity.sh backend/scripts/parity.py
git commit -m "feat(backtest): vectorised cascade mirror with reducer parity checks"
```

---

### Task 4: Split + fit on train

**Files:** create `backend/twins/backtest/split.py` and `backend/twins/backtest/fit.py`; test `backend/tests/test_backtest_fit.py`.

**Interfaces:**
- Produces:
  - `split(truth: Truth, train_share: float = 0.6) -> tuple[list[TruthPost], list[TruthPost]]`: chronological, oldest posts go to train;
  - `Problem(probs: dict[uri, np.ndarray (n,4)], actual: dict[uri, np.ndarray (4,)], adj, followers)`;
  - `poisson_deviance(pred: np.ndarray, actual: np.ndarray) -> float`;
  - `fit(problem, posts, *, trials=200, feed_grid=(0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0), share_grid=(0.2, 0.4, 0.6, 0.8), rounds=2) -> dict` with keys `feed_reach`, `share_reach`, `scale` (list of 4), `train_deviance`, `posts`, `at_bound` (list of signals at the clamps);
  - `save_fit(d, path)`, `load_fit(path)`.
- Method:
  - for each (feed, share) pair, fit the 4 scales by coordinate search: a golden-section search on log10(scale) ∈ [−3, 1], minimising the summed Poisson deviance of mean predicted counts against actual follower counts over the train posts;
  - run 2 rounds, because repost and quote scales feed back into exposure;
  - keep the lowest-deviance configuration.
  - Note: for non-spreading signals, feed reach and the like/reply scales trade off. The report says so, and the tie-break prefers the configuration whose seen counts are closest to the real reach proxy. If there is none, it takes the smallest feed reach within 1% deviance of the best.

- [ ] **Step 1: Failing tests**

```python
import numpy as np

from twins.backtest.data import Truth, TruthPost
from twins.backtest.fit import Problem, fit, poisson_deviance
from twins.backtest.split import split


def tp(uri, when, likes):
    return TruthPost(uri=uri, text=uri, created_at=when, engaged={"like": [f"f{i}" for i in range(likes)], "repost": [], "reply": [], "quote": []})


def test_split_is_chronological():
    truth = Truth(brand="b", brand_did="d", followers=[], fetched_at="", posts=[tp("new", "2026-09-01", 1), tp("old", "2026-01-01", 1),
                                                                                  tp("mid", "2026-05-01", 1)])
    train, test = split(truth, 0.6)
    assert [p.uri for p in train] == ["old", "mid"] and [p.uri for p in test] == ["new"]


def test_poisson_deviance_is_zero_when_exact_and_positive_otherwise():
    assert poisson_deviance(np.array([2.0, 0.0]), np.array([2.0, 0.0])) == 0
    assert poisson_deviance(np.array([1.0, 0.1]), np.array([3.0, 0.0])) > 0


def test_fit_recovers_a_known_like_scale():
    n = 200
    rng = np.random.default_rng(0)
    probs = {f"p{i}": np.column_stack([rng.uniform(0.2, 0.6, n), np.zeros(n), np.zeros(n), np.zeros(n)]) for i in range(6)}
    true_scale = 0.05
    actual = {k: np.array([v[:, 0].sum() * true_scale * 0.35, 0, 0, 0]) for k, v in probs.items()}
    prob = Problem(probs=probs, actual=actual, adj=np.zeros((n, n), dtype=bool), followers=[f"f{i}" for i in range(n)])
    out = fit(prob, list(probs), trials=300, feed_grid=(0.35,), share_grid=(0.6,))
    assert abs(out["scale"][0] - true_scale) / true_scale < 0.15
```

Run: `cd backend && uv run pytest tests/test_backtest_fit.py -v`
Expected: FAIL (modules missing).

- [ ] **Step 2: Implement `split.py` and `fit.py`**

```python
# split.py
"""Chronological train/test split: calibrate on the past, judge on the future."""
from .data import Truth, TruthPost


def split(truth: Truth, train_share: float = 0.6) -> tuple[list[TruthPost], list[TruthPost]]:
    posts = sorted(truth.posts, key=lambda p: p.created_at)
    cut = max(1, min(len(posts) - 1, round(len(posts) * train_share)))
    return posts[:cut], posts[cut:]
```

```python
# fit.py
"""Fit feed/share reach and per-signal scales on the TRAIN posts only (Poisson deviance of mean counts)."""
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..cascade import Calib, simulate

LOG_LO, LOG_HI = -3.0, 1.0      # scales in [0.001, 10]
GOLDEN = (math.sqrt(5) - 1) / 2


@dataclass(frozen=True)
class Problem:
    probs: dict          # uri -> (n, 4) raw Claude probabilities, rows in `followers` order
    actual: dict         # uri -> (4,) real follower counts
    adj: np.ndarray
    followers: list


def poisson_deviance(pred: np.ndarray, actual: np.ndarray) -> float:
    pred = np.maximum(pred, 1e-9)
    term = np.where(actual > 0, actual * np.log(actual / pred), 0.0) - (actual - pred)
    return float(2 * term.sum())


def _loss(problem: Problem, posts, cal: Calib, trials: int) -> float:
    return sum(poisson_deviance(simulate(problem.probs[u], problem.adj, cal, trials=trials, seed=i).mean, problem.actual[u])
               for i, u in enumerate(posts))


def _golden(f, lo=LOG_LO, hi=LOG_HI, iters=18) -> float:
    a, b = lo, hi
    c, d = b - GOLDEN * (b - a), a + GOLDEN * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - GOLDEN * (b - a); fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + GOLDEN * (b - a); fd = f(d)
    return (a + b) / 2


def fit(problem: Problem, posts, *, trials: int = 200, feed_grid=(0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0),
        share_grid=(0.2, 0.4, 0.6, 0.8), rounds: int = 2) -> dict:
    best = None
    for feed in feed_grid:
        for share in share_grid:
            logs = [0.0, 0.0, 0.0, 0.0]
            for _ in range(rounds):
                for s in range(4):
                    def f(x, s=s):
                        trial = list(logs); trial[s] = x
                        return _loss(problem, posts, Calib(feed, share, tuple(10 ** v for v in trial)), trials)
                    logs[s] = _golden(f)
            scale = tuple(round(10 ** v, 5) for v in logs)
            loss = _loss(problem, posts, Calib(feed, share, scale), trials)
            if best is None or loss < best["train_deviance"] * 0.99 or (loss <= best["train_deviance"] * 1.01 and feed < best["feed_reach"]):
                best = {"feed_reach": feed, "share_reach": share, "scale": list(scale), "train_deviance": round(loss, 4)}
    best["posts"] = list(posts)
    best["at_bound"] = [name for name, v in zip(("like", "repost", "reply", "quote"), best["scale"])
                        if v <= 10 ** LOG_LO * 1.05 or v >= 10 ** LOG_HI * 0.95]
    return best


def save_fit(d: dict, path) -> None:
    Path(path).write_text(json.dumps(d, indent=1))


def load_fit(path) -> dict:
    return json.loads(Path(path).read_text())
```

The `fit` CLI subcommand:
- loads the truth file and scores;
- builds `Problem` (each post's probs come from the `score_posts` cache in follower order, with missing twins as zeros; actual counts are the lengths of the `engaged` lists);
- fits on the train split only;
- writes `data/backtest/fit.json`.

For runtime, the full grid is 7 × 4 × 2 rounds × 4 signals × about 20 evaluations × about 65 posts. Run it with `trials=100`. If it takes more than about 30 minutes, shrink the grid to `feed_grid=(0.1, 0.2, 0.35, 0.5)`.

- [ ] **Step 3: Run tests, fit for real, commit**

```bash
cd backend && uv run pytest tests/test_backtest_fit.py -v          # expected: 3 passed
uv run python -m twins backtest fit --brand raycast.com            # writes data/backtest/fit.json
git add backend/twins/backtest/split.py backend/twins/backtest/fit.py backend/tests/test_backtest_fit.py backend/data/backtest/fit.json backend/twins/cli.py
git commit -m "feat(backtest): chronological split and train-only calibration fit"
```

---

### Task 5: Metrics + test-split evaluation + baselines

**Files:** create `backend/twins/backtest/metrics.py` and `backend/twins/backtest/evaluate.py`; tests `backend/tests/test_backtest_metrics.py` and `backend/tests/test_backtest_evaluate.py`.

**Interfaces:**
- `metrics.py` produces:
  - `pairwise_accuracy(pred, actual) -> float | None`, which skips pairs with equal actual counts and returns None when no pairs remain;
  - `spearman(pred, actual) -> float | None`;
  - `mae(pred, actual) -> float`;
  - `coverage(p10, p90, actual) -> float`;
  - `auc(scores, positives) -> float | None`, which returns None when there are no positives or all are positive;
  - `precision_at_k(scores, positives, k=10) -> float | None`;
  - `bootstrap_ci(fn, n_items: int, *, resamples=1000, seed=0) -> tuple[float, float]`, which calls `fn(indices)` on each resample.
- `evaluate.py` produces:
  - `evaluate(problem, test_posts, fit: dict, *, baselines: dict) -> dict` (metrics, baselines and CIs);
  - `require_fit(path)`, which raises `FileNotFoundError("run `backtest fit` first; the test split is evaluated once with frozen parameters")`;
  - `write_report(result, path)`, which writes `docs/research/backtest-raycast.md`.
- Baselines:
  - **constant:** the train mean for every post;
  - **past engagers:** "who" scores are the per-follower engagement frequency on train posts;
  - **Claude-direct:** for each test post, one forced-tool call returns the predicted follower-like count. It is cached like the scores, under the key prefix `direct-`.
- **Leakage audit:** `leaky_followers(stdb, truth) -> set[str]` returns followers whose `x_post` rows reply to Raycast (`in_reply_to_user_id = brand_did`) or quote a backtest post (`x_post_reference`). Every metric is reported twice: all followers, and without the leaky ones.

- [ ] **Step 1: Failing tests**

```python
import numpy as np

from twins.backtest.metrics import auc, coverage, pairwise_accuracy, precision_at_k, spearman


def test_metrics_handle_ties_and_empty_posts():
    assert pairwise_accuracy([1, 2, 3], [5, 5, 5]) is None                 # all real counts tied
    assert pairwise_accuracy([1, 2, 3], [1, 2, 3]) == 1.0
    assert pairwise_accuracy([3, 2, 1], [1, 2, 3]) == 0.0
    assert auc([0.1, 0.9], [False, False]) is None and auc([0.1, 0.9], [True, True]) is None
    assert auc([0.1, 0.9], [False, True]) == 1.0
    assert coverage([0, 0], [2, 1], [1, 5]) == 0.5
    assert precision_at_k([0.9, 0.1, 0.8], [True, False, False], k=2) == 0.5
    assert spearman([1, 2, 3], [10, 20, 30]) == 1.0
```

```python
import pytest

from twins.backtest.evaluate import require_fit


def test_evaluate_requires_frozen_fit(tmp_path):
    with pytest.raises(FileNotFoundError, match="backtest fit"):
        require_fit(tmp_path / "missing.json")
```

Run: `cd backend && uv run pytest tests/test_backtest_metrics.py tests/test_backtest_evaluate.py -v`
Expected: FAIL (modules missing).

- [ ] **Step 2: Implement `metrics.py`**

```python
"""Backtest metrics. Every function tolerates ties / degenerate posts by returning None instead of a fake number."""
from itertools import combinations

import numpy as np


def pairwise_accuracy(pred, actual) -> float | None:
    pairs = [(i, j) for i, j in combinations(range(len(actual)), 2) if actual[i] != actual[j]]
    if not pairs:
        return None
    right = sum((pred[i] - pred[j]) * (actual[i] - actual[j]) > 0 for i, j in pairs)
    ties = sum(pred[i] == pred[j] for i, j in pairs)
    return (right + 0.5 * ties) / len(pairs)


def _ranks(x):
    x = np.asarray(x, dtype=float)
    order = x.argsort()
    ranks = np.empty(len(x)); ranks[order] = np.arange(len(x))
    for v in np.unique(x):
        ranks[x == v] = ranks[x == v].mean()
    return ranks


def spearman(pred, actual) -> float | None:
    a, b = _ranks(pred), _ranks(actual)
    if a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def mae(pred, actual) -> float:
    return float(np.mean(np.abs(np.asarray(pred, float) - np.asarray(actual, float))))


def coverage(p10, p90, actual) -> float:
    a = np.asarray(actual)
    return float(np.mean((np.asarray(p10) <= a) & (a <= np.asarray(p90))))


def auc(scores, positives) -> float | None:
    s, y = np.asarray(scores, float), np.asarray(positives, bool)
    if y.all() or not y.any():
        return None
    r = _ranks(s)
    n1, n0 = y.sum(), (~y).sum()
    return float((r[y].sum() - n1 * (n1 - 1) / 2) / (n1 * n0))


def precision_at_k(scores, positives, k: int = 10) -> float | None:
    y = np.asarray(positives, bool)
    if not y.any():
        return None
    top = np.argsort(-np.asarray(scores, float))[:k]
    return float(y[top].mean())


def bootstrap_ci(fn, n_items: int, *, resamples: int = 1000, seed: int = 0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    vals = [v for v in (fn(rng.integers(0, n_items, n_items)) for _ in range(resamples)) if v is not None]
    return (float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975))) if vals else (float("nan"), float("nan"))
```

- [ ] **Step 3: Implement `evaluate.py`**

It must:
- call `require_fit`;
- for each test post, run `simulate(probs, adj, Calib(**fit), trials=1000, seed=k)`;
- collect mean, p10 and p90 per signal, plus `user_any_share`;
- compute every metric above, overall and for the "no leaky followers" population (rerun with the leaky rows zeroed out of both probs and actual);
- compute the three baselines;
- compute bootstrap CIs for pairwise accuracy, Spearman and mean AUC.

The `write_report` output has these sections:
- **Setup:** posts, split dates, follower count, sha256 of `fit.json`.
- **Calibration:** the fitted values, with the at-bound flags and the feed/scale trade-off note.
- **Headline:** pairwise accuracy (likes) with its CI, against constant 0.5 and Claude-direct.
- **Count accuracy:** MAE per signal and coverage.
- **Who engages:** AUC and precision@10 against past engagers.
- **Leakage:** both populations side by side.
- **Limitations:**
  - the X transfer is untested;
  - followers are today's, not the ones at posting time;
  - a small n.

Use the real numbers. Never write a metric that wasn't computed.

Add `test_evaluate_on_tiny_problem` to `test_backtest_evaluate.py`:
- 4 test posts, 20 followers, zero adjacency;
- probabilities proportional to the actual counts, so pairwise accuracy is 1.0;
- assert that the result has keys `pairwise_accuracy_likes`, `spearman_likes`, `coverage`, `who_auc` and `baselines`, and that pairwise accuracy equals 1.0.

- [ ] **Step 4: Run tests, evaluate once, commit**

```bash
cd backend && uv run pytest -q                                      # expected: all pass
uv run python -m twins backtest evaluate --brand raycast.com        # writes docs/research/backtest-raycast.md
git add backend/twins/backtest/metrics.py backend/twins/backtest/evaluate.py backend/tests/test_backtest_metrics.py backend/tests/test_backtest_evaluate.py docs/research/backtest-raycast.md backend/twins/cli.py
git commit -m "feat(backtest): held-out evaluation with baselines, CIs and leakage audit"
```

---

### Task 6: Publish calibration + headline to SpacetimeDB

**Files:** create `backend/twins/backtest/publish.py`; test `backend/tests/test_backtest_publish.py`.

**Interfaces:**
- Produces: `publish(stdb, brand_did: str, fit: dict, result: dict, *, allow_bound: bool = False) -> None`, which writes:
  - `set_sim_calibration` for `brand_did` and `default`, with `source='backtest'` and a note holding the fit hash and the train-post count;
  - `set_backtest_result(brand_did, metric, value, baseline, n, note)` for `pairwise_accuracy_likes` (baseline 0.5), `spearman_likes` (baseline: Claude-direct's ρ), `coverage_likes` (baseline 0.8, the target) and `who_auc` (baseline: past engagers' AUC).

  The Lab card shows the pairwise headline only when the value's lower CI bound is above 0.5; this rule lives in the Codex prompt.

- [ ] **Step 1: Failing test**

```python
import pytest

from conftest import FakeStdb
from twins.backtest.publish import publish

FIT = {"feed_reach": 0.1, "share_reach": 0.4, "scale": [0.08, 0.5, 0.3, 0.6], "at_bound": [], "posts": ["a"]}
RESULT = {"pairwise_accuracy_likes": 0.66, "pairwise_ci": [0.55, 0.76], "spearman_likes": 0.41, "coverage_likes": 0.78,
          "who_auc": 0.71, "n_test": 45, "baselines": {"direct_spearman": 0.2, "past_engagers_auc": 0.69}}


def test_publish_writes_calibration_and_metrics():
    db = FakeStdb({})
    publish(db, "did:r", FIT, RESULT)
    assert [a[0] for a in db.reducers("set_sim_calibration")] == ["did:r", "default"]
    metrics = {a[1]: (a[2], a[3]) for a in db.reducers("set_backtest_result")}
    assert metrics["pairwise_accuracy_likes"] == (0.66, 0.5) and metrics["who_auc"] == (0.71, 0.69)


def test_publish_refuses_bound_scales():
    with pytest.raises(ValueError, match="at a bound"):
        publish(FakeStdb({}), "did:r", {**FIT, "at_bound": ["quote"]}, RESULT)
```

Run: `cd backend && uv run pytest tests/test_backtest_publish.py -v`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `publish.py`**

```python
"""Push the frozen calibration and the headline backtest metrics to SpacetimeDB (Lab reads both)."""
import hashlib
import json


def publish(stdb, brand_did: str, fit: dict, result: dict, *, allow_bound: bool = False) -> None:
    if fit.get("at_bound") and not allow_bound:
        raise ValueError(f"scales at a bound: {fit['at_bound']} (pass allow_bound=True after reading the report)")
    digest = hashlib.sha256(json.dumps(fit, sort_keys=True).encode()).hexdigest()[:12]
    note = f"backtest fit {digest} on {len(fit['posts'])} train posts"
    like, repost, reply, quote = fit["scale"]
    for scope in (brand_did, "default"):
        stdb.call("set_sim_calibration", scope, fit["feed_reach"], fit["share_reach"], like, repost, reply, quote,
                  "backtest", note)
    n = int(result["n_test"])
    ci = result.get("pairwise_ci", [None, None])
    rows = [
        ("pairwise_accuracy_likes", result["pairwise_accuracy_likes"], 0.5, f"95% CI {ci[0]:.2f}-{ci[1]:.2f}; coin flip = 0.5"),
        ("spearman_likes", result["spearman_likes"], result["baselines"]["direct_spearman"], "baseline: Claude-direct"),
        ("coverage_likes", result["coverage_likes"], 0.8, "share of test posts inside p10-p90; target 0.8"),
        ("who_auc", result["who_auc"], result["baselines"]["past_engagers_auc"], "baseline: past engagers"),
    ]
    for metric, value, baseline, why in rows:
        stdb.call("set_backtest_result", brand_did, metric, float(value), float(baseline), n, why)
```

- [ ] **Step 3: Run tests, publish, verify in Lab, commit**

```bash
cd backend && uv run pytest -q                                      # expected: all pass
uv run python -m twins backtest publish --brand raycast.com
```

Then rerun one Lab experiment. The like p50 for a typical Raycast draft should now sit near the real median, about 4 follower likes.

```bash
git add backend/twins/backtest/publish.py backend/tests/test_backtest_publish.py backend/twins/cli.py
git commit -m "feat(backtest): publish frozen calibration and headline metrics for Lab"
```

---

## Self-review notes

- **Spec coverage:**

  | Requirement | Where |
  |---|---|
  | Follower-only ground truth for all four signals | Task 1 |
  | 12-month window, 2-day settling, chronological 60/40 split | Tasks 1 and 4 |
  | Cached scores | Task 2 |
  | Reducer-faithful cascade | Task 3 |
  | Train-only fit | Task 4 |
  | Metrics, baselines, CIs, leakage audit, single test evaluation | Task 5 |
  | Publishing to `sim_calibration` and `backtest_result` | Task 6 |
  | X transfer stated as untested | Task 5 report |
- **Type consistency:**
  - `Calib.scale` is in like/repost/reply/quote order everywhere;
  - `fit.json["scale"]` maps to `set_sim_calibration(likeScale, repostScale, replyScale, quoteScale)`, in the same order;
  - the `backtest_result` scope is the brand DID, which Lab's `loadBacktestHeadline` reads as `${brandUserId}:pairwise_accuracy_likes`.
- **Cost:** about 5,600 Haiku calls once (cached), plus about 45 Claude-direct calls. Rerunning fit or evaluate costs nothing.
