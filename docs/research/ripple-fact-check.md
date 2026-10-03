# Ripple — fact-check of the idea

Researched 2026-09-30. Each claim below was checked against sources. "Unverified" means I could not confirm it.

> **Decision 2026-10-03:** Bluesky is **dropped for now**. Ripple uses **X via the xAI console key (Grok `x_search`)** only. The Bluesky rows below are kept as research; they are not the plan. Without a follower graph from X, the audience graph comes from reply, quote and mention edges. See [ripple-winning-plan.md §0](ripple-winning-plan.md).

**Bottom line (updated 2026-10-03):** the idea is feasible on **X via the xAI console key (Grok `x_search`)**, which returns real posts and engagement counts but no follower graph. The audience graph is built from reply, quote and mention edges. The originality claim is defensible only in a narrower form. The backtest is the make-or-break part and needs real baselines.

## 1. Data access

| Platform                                         | Follower graph + who reposted/liked                                                                                                                                                                                                                                            | Verdict for a hackathon                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **X / Twitter**                                  | Pay-per-use only since Feb 2026: about $0.01 per follower record, so about $1,000 for one account with 100k followers ([pricing mirror](https://x-preview.mintlify.app/x-api/getting-started/pricing)). Full archive and streaming are Enterprise only.                        | ❌ Too expensive, and ToS problems (see §4).                                                                                                       |
| **X via xAI Grok `x_search`** (added 2026-10-01) | No follower graph and no "who reposted" data. It returns Grok-synthesized search over X posts, users and threads, with citations. Costs $5 per 1,000 calls plus tokens ([docs](https://docs.x.ai/developers/tools/x-search), [pricing](https://docs.x.ai/developers/pricing)). | ✅ For **aggregate narrative signal only**. Not a graph source, and never used to profile individuals. See [probe-analysis.md](probe-analysis.md). |
| Threads / Instagram                              | APIs cover only the authenticated user's own content.                                                                                                                                                                                                                          | ❌                                                                                                                                                 |

**Calibration data:** historical posts from the chosen X page (via Grok `x_search` with date ranges), with their real engagement counts as backtest targets.

## 2. Prior art and originality

- **Independent Cascade / Linear Threshold** ([Kempe, Kleinberg, Tardos 2003](https://www.cs.cornell.edu/home/kleinber/kdd03-inf.pdf)) are the formal basis of Ripple's diffusion engine. Cite them.
- **Cheng et al. 2014, "Can cascades be predicted?"** ([arXiv](https://arxiv.org/abs/1403.4608)):
  - Predicting whether a cascade will _double_ is feasible once early spread is observed.
  - Timing and network-structure features dominate; content and author features matter less.
- **LLM social simulators:**
  - [OASIS](https://github.com/camel-ai/oasis) (CAMEL-AI) runs up to 1M LLM agents on simulated X and Reddit. Its agents are synthetic personas, not twins of real accounts.
  - S3, HiSim, [Y Social](https://sage.cnpereading.com/doi/10.1177/20539517261431576) and Stanford Generative Agents are similar.
- **[PopSim](https://arxiv.org/html/2512.02533)** is the closest prior art: an LLM-agent sandbox that predicts post popularity, reporting a +2.9% Spearman improvement over the best baseline.
- **Commercial:**
  - Aaru ($1B headline valuation), Electric Twin ($14M) and Artificial Societies (YC) all exist.
  - They simulate surveys and personas, not cascades through twins of specific real accounts.
- **Verdict:** "few" is fair, "first" is not. The defensible novelty is the _combination_ of three things:
  - per-account twins fitted to observed behavior,
  - a **distilled small model** instead of an LLM call per agent,
  - a **leakage-free backtest** against real cascades.

## 3. Feasibility

- **Predicting before posting is hard.** Most published accuracy comes from watching the early cascade, which Ripple won't have.
  - Same-content cascades vary widely in size, which is irreducible randomness.
  - So output **distributions and relative rankings (B > A > C)**, never point estimates.
- **The small-model choice is supported.** Zero-shot LLM agents predicting likes scored MCC 0.29 versus 0.36 for a TF-IDF classifier ([source](https://www.alphaxiv.org/abs/2604.19787)).
- **Social proof:**
  - Centola's complex-contagion evidence ([Science 2010](https://www.science.org/doi/10.1126/science.1185231)) comes from a controlled health-behavior experiment.
  - Treat "peers engaged → higher repost probability" as a **hypothesis to fit from data**, not a known law.
- **❌ Correction:** "We can't reconstruct X's algorithm" is inaccurate as stated.
  - X open-sourced its ranking stack in 2023 ([twitter/the-algorithm](https://github.com/twitter/the-algorithm)).
  - In 2026 it released [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm). It includes a Grok-based model (Phoenix) that predicts **per-action probabilities**, which is close to Ripple's P(action).
  - **Accurate wording:** "Production weights and live signals aren't public, so we model relative propagation, not X's feed."
  - Cite Phoenix as precedent.

## 4. Ethics and terms of service

- **X:**
  - The developer terms prohibit individual profiling, psychographic segmentation, and training ML models on X data (except for Grok) ([mirror](https://generaltranslation.mintlify.app/developer-terms/restricted-use-cases)).
  - Per-account "author twins" from X data are a direct conflict.
- **Mitigations to say out loud in the pitch:**
  - Model _observable behavior_, never private traits.
  - Infer no sensitive attributes.
  - Show aggregate distributions.
  - Don't publish per-person profiles.
  - Allow users to twin their _own_ audience.

## 5. What must be true for Ripple to be credible

1. Run a backtest with **baselines**: follower count, the author's median engagement, and a text-only classifier. If the simulation doesn't beat them, say so.
2. Use metrics such as pairwise A-vs-B accuracy, reach-rank correlation, and community-penetration error, measured honestly.
3. Use no data from after a post's timestamp when simulating it.
