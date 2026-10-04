# Campaign generation plan: audience-guided ad creatives with Grok Imagine

**Status:** research and plan only (2026-10-03). Nothing here is built yet.
**Scope:** the step *before* simulation. Ripple generates the first photo ads for a campaign from the audience data and personas already in SpacetimeDB. The user then iterates on them in a Melius-style loop and hands the approved ones to the Simulation agent.
**Hard constraints:** images come only from xAI Grok Imagine. The flow is hackathon-sized and only needs to work reliably a few times on stage. Ripple uses synthetic personas, never clones: it never targets sensitive traits and never puts a follower's likeness or handle in an ad.

---

## 1. What we have in the database today

Live database: `ripple-mhacks` on maincloud (module: `x-followers-db/src/index.ts`). Counts were read with read-only SQL on 2026-10-03.

### 1.1 Audiences

| Brand | Source | `brand_user_id` | Twins | Notes |
|---|---|---|---|---|
| `@raycast.com` | **Bluesky** (`ingest_bsky.py`) | `did:plc:w2wcqqbevx536r4vau7f2pae` | ~999 | This is the demo audience (README). The brand profile is stored. **The brand's own posts are not stored (0 rows).** |
| `@spacetimedb` | X API v2 (`ingest_x.py`) | `1532160930284417024` | ~95 | 22 of the brand's own posts are stored. |

Bluesky rows live in the `x_*` tables: the names are historical and the shapes are shared. Bluesky DIDs appear as `user_id`, and `at://` URIs appear as `post_id`.

### 1.2 Table inventory and how each one drives generation

| Table | Rows | Layer | Useful for generation | How |
|---|---|---|---|---|
| `twin` | 1,094 | AI-inferred (Claude Haiku 4.5) | ★★★ | `topics[]` (niche plus affinity 0–1), `tone`, `hot_buttons[]` (what makes them reply or repost), `ignores[]` (what they scroll past, our best proxy for skepticism triggers), `format_prefs[]`, `evidence_post_ids[]`, plus stats (`engagement_rate`, `active_hours_utc`, `reply_share`, …) |
| `twin_niche` | 4,437 | AI-inferred | ★★★ | Segment membership. The main niche is the arg-max affinity, the same rule `ripple_agents/audience.py` already uses. |
| `niche` | 21 | Catalog | ★★ | Segment labels and descriptions (`twins/niches.py`) |
| `twin_audience` | ~1,094 | Link | ★ | Twin ↔ brand |
| `x_user` | 1,097 | Raw | ★★ | The brand row's `description`/`name` seed the brand kit. Follower bios are **not** used in prompts. |
| `x_post` | 27,907 | Raw | ★★ | Engagement-weighted examples of what each segment responds to. The brand's own posts are the voice reference (spacetimedb only). |
| `x_post_entity` | 18,182 | Raw | ★★ | Top hashtags and link domains per segment. Mentions are never used in prompts. |
| `x_context_annotation` | 2,151 | Raw (X only) | ★ | X's own topic entities per segment. There are none for the Bluesky audience. |
| `x_post_media` | 6,611 | Raw | ★★ | Format mix per segment (photo, video, gif share), `alt_text` keywords, and URLs for optional vision analysis |
| `twin_question` | — | AI-inferred | — | Ask-the-twin queue. **The pattern to copy** for the generation job queue (public request reducer → admin worker claims → admin answers). |
| `x_ingestion_run`, `twin_build_*` | — | Ops | — | Run bookkeeping |

A real twin row (Bluesky, abridged) shows the shape we can aggregate:

```text
tone:         "Pragmatic builder sharing candid insights from shipping indie products…"
hot_buttons:  ["AI coding agents and their capabilities/limitations", "Productivity and focus work optimization", …]
ignores:      ["Generic tech industry hot-takes", "Long-form thinkpieces unrelated to building", "Politics…"]
format_prefs: ["Ship-and-tell narratives", "Tool comparisons and honest reviews", "Numbers and metrics…"]
topics:       [startups_product .35, ai_agents_tools .30, dev_tools .20, software_craft .15]
```

### 1.3 Gaps (what we'd need but don't have)

| Gap | Impact | Hackathon fix |
|---|---|---|
| **No brand kit** (logo, palette, fonts, product shots, value props, banned claims) | The ads will look generic and off-brand. | Add a `brand_kit` table and fill it by hand for Raycast (5 minutes). Optionally upload 1–3 product screenshots as edit references. |
| **Raycast's own posts aren't ingested** | No brand-voice reference | One `getAuthorFeed` call on `raycast.com` through the existing `ingest_bsky.py` path. This is P1 and cheap. |
| **No per-inference confidence on twins** (only topic affinity) | The plan asks for evidence-backed, scored inferences. | The brief computes **support** = the share of a segment's twins whose `hot_buttons`/`ignores` fall into each theme. Support is the confidence. It is deterministic and auditable. |
| **No explicit "skepticism" field** | — | Use `ignores[]`. Optionally add `skeptical_of[]` to the twin schema later; don't rebuild twins now. |
| **No visual-style analysis** of segment media | Visual cues come from text only. | Stretch: run Grok vision (`grok-4.3` image understanding) on the top-engaged ~20 media per segment and cache the result in `segment_visual_profile`. |
| **No persisted segments** | — | Compute them at brief time (main niche). Persist only the brief that cites them. |
| **No context annotations for Bluesky** | Weaker entity signal for Raycast | Hashtags plus Grok's theme clustering are enough. |
| `persona_summary` has personal details (e.g. "15-year-old", names) | Ethics risk | **Never** send `persona_summary`, `username`, bios, mentions or avatars to the brief or image prompts (see §9). |
| The `politics_society` niche exists in the catalog. | Political affiliation is a banned targeting trait. | Never create a segment brief for `politics_society`. Strip political themes from briefs. |

---

## 2. Grok Imagine API: what's confirmed

Sources: [Imagine overview](https://docs.x.ai/developers/model-capabilities/imagine), [Image generation](https://docs.x.ai/developers/model-capabilities/images/generation), [Image editing](https://docs.x.ai/developers/model-capabilities/images/editing), [Multi-image editing](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing), [REST reference: Images](https://docs.x.ai/developers/rest-api-reference/inference/images), [Persisting output](https://docs.x.ai/developers/model-capabilities/imagine/files/outputs), [Pricing](https://docs.x.ai/developers/pricing), [Rate limits](https://docs.x.ai/developers/rate-limits), [Quality-model retirement](https://docs.x.ai/developers/migration/imagine-image-quality-nov-2), [Structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs).

| Capability | Supported? | Details |
|---|---|---|
| Text → image | ✅ | `POST https://api.x.ai/v1/images/generations` (JSON) |
| **Native image editing (image → image)** | ✅ | `POST /v1/images/edits` takes `image: {url \| file_id}`, either a public URL or a `data:` URI. **Chained "multi-turn" edits are officially supported.** |
| Multi-reference editing | ✅ | `images: [...]`, up to **5** sources, referenced in the prompt as `<IMAGE_0>`, `<IMAGE_1>`, … The output ratio follows the first image unless `aspect_ratio` is set. This is how we "use the brand's product screenshot plus this style" in one shot. |
| Variants per call | ✅ | `n` from 1 to 10 (same prompt). Use `asyncio.gather` for different prompts. |
| Aspect ratio | ✅ | `1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9, 9:20, 20:9, 1:2, 2:1, 21:9, 5:2, auto` |
| Resolution | ✅ | `1k` (default), `1.5k`, `2k` |
| Quality | ✅ (`grok-imagine-image-2.0` only) | `low`, `medium`, `auto`. Auto currently means low for generation and medium for edits. **Pin `low` to keep cost predictable.** |
| Response format | ✅ | `url` (default; **temporary** `imgen.x.ai` URL) or `b64_json` |
| Persistent hosting | ✅ | `storage_options: {filename, public_url: true}` returns `data[i].file_output.public_url` on `files-cdn.x.ai` (permanent unless `expires_after` is set). **Store this URL in SpacetimeDB.** |
| Moderation flag | ✅ (xAI SDK) | `response.respect_moderation` |
| Masked inpainting | ❌ | Not documented. Edits are prompt-driven over the whole image. |
| Seed / determinism | ❌ | Not documented. A "regenerate" gives a new take. |
| Negative prompt | ❌ | Not a parameter. Put "avoid" phrasing in the prompt. |
| Video | ✅ (out of scope) | `grok-imagine-video-1.5` and others: async `POST /v1/videos/generations` plus polling; image-to-video, ≤15s, $0.02–0.08 per second. Stretch only: "animate the winner". |
| OpenAI SDK | Partial | `images.generate` works with `base_url=https://api.x.ai/v1`. **`images.edit()` does NOT work** (multipart vs JSON). Use `requests` or the `xai_sdk` for edits. |
| Prompt rewriting | Note | The service runs an "upsampler" LLM over your prompt (visible in `usage.output_tokens_details.text_tokens`). Prompts get embellished, so be explicit about what to keep. |

**Models available to our key** (`GET /v1/models` and `/v1/image-generation-models`): `grok-imagine-image-2.0` (max prompt 64k chars), `grok-imagine-image` (1.0), `grok-imagine-image-quality` (**retires 2026-11-02**, redirects to 2.0/low), plus text models `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`, and `grok-4.20-*`.

**Pricing** (`grok-imagine-image-2.0`, from `/v1/image-generation-models`): low/1k **$0.04**, low/1.5k $0.05, low/2k $0.06, medium/1k $0.06, medium/1.5k $0.07, medium/2k $0.08. Edits bill input plus output; we measured **$0.05** for a low/1k edit. `grok-imagine-image` 1.0 costs $0.02. Moderation violations are still charged.

**Rate limits:** Imagine image models get **6 RPS at tier 0** (12, 25, 50, 100 at higher tiers). Our response headers showed `x-ratelimit-limit-requests: 300`. Imagine limits don't rise with spend tiers (contact sales). A 429 means back off. **This is not a constraint for a demo**: 4 briefs × 4 variants = 16 images, or 4 requests if `n=4`.

**Verified with 2 live calls on 2026-10-03** (`quality: low`, `1:1`):

| Call | Latency | Response shape | Cost |
|---|---|---|---|
| `POST /images/generations` (n=1) | 15.7 s | `{data: [{url, mime_type}], usage: {cost_in_usd_ticks: 400000000}}` | $0.04 |
| `POST /images/edits` (input = the temp URL from the call above) | 6.4 s | Same shape | $0.05 |

Takeaways:
1. **Chaining an edit off the previous output's temporary URL works**, so lineage-by-edit is viable.
2. Downloading the temporary `imgen.x.ai` URL with Python's default `urllib` returned **403**, most likely because of User-Agent filtering. **Use `storage_options.public_url` or `response_format: "b64_json"`; don't fetch temp URLs server-side.**
3. Budget about 15 s per generate and about 6–10 s per edit, so the UI needs live "generating…" states. SpacetimeDB subscriptions give us that for free.

---

## 3. Melius AI: what to copy

[Melius](https://www.melius.com/) calls itself "the AI-native operating system for creatives." Its core pieces ([canvas](https://www.melius.com/product/canvas), [marketers](https://www.melius.com/personas/marketers), [templates](https://www.melius.com/product/templates), [asset manager](https://www.melius.com/product/digital-asset-manager), [style-reference guide](https://www.melius.com/blog/static-ad-from-style-reference)) are:

- **An infinite node canvas.** Each node is one generation (image, video, text or audio) on a chosen model. Outputs wire into the next prompt.
- **"Ask Mel" agent.** You brief the whole job in one instruction. The agent picks models, writes prompts, creates and connects the nodes, and **shows every prompt** so you can steer. Melius says the first pass gets you 85–95% of the way, and "the last mile is prompt tweaks on individual nodes."
- **Ask-permission vs auto-run.** The agent asks about ratio, audience and tone before spending, or just builds.
- **Built-in tools:** edit, inpaint, upscale, crop and resize-for-every-placement on the canvas.
- **Version history per node** ("every node keeps its takes"), plus comments on the exact variant and approval queues.
- **Brand anchor / brand check**, templates, and a digital asset manager that links each asset back to the canvas that made it.
- **Marketer pitch:** "the hero shot in minutes, the thousand-variant cascade in an afternoon."

**MVP features to copy (ranked):**
1. The **brief → N variants grid**, with every prompt visible and editable on each card (Melius's "shows you every prompt").
2. **Per-variant actions:** *Tweak prompt*, *Make it more…* (chips), *Regenerate*, *Branch* (edit from this image), *Resize* (re-run at another aspect ratio), *Approve*.
3. **Takes/lineage** for each variant: a small tree or breadcrumb so the winner is "one step back."
4. **A brand anchor** that every prompt inherits: the `brand_kit` and an optional reference image.
5. **The agent writes the brief and prompts; the human finishes the last mile.**

**Skip:** the free-form infinite canvas (use a grid plus a lineage strip), multi-model routing (Grok only), real-time multi-cursor, comments, inpainting masks, video, and the template marketplace.

---

## 4. Data → creative brief mapping

### 4.1 Segments

The **segment** is the main niche of each twin in the brand's audience: arg-max `twin_niche.affinity`, the same rule as `audience_profile()`. Take the top 3–4 segments by share. Drop `other` and `politics_society`, and drop segments with fewer than 15 twins. For Raycast this will be niches like `dev_tools`, `ai_agents_tools`, `startups_product` and `design_creative`. The user can also pick segments by hand.

### 4.2 Deterministic aggregation (Python, no LLM)

For each segment *S* with twins *T(S)*:

| Brief input | Computed from | Notes |
|---|---|---|
| `share` | \(|T(S)| / |T(\text{brand})|\) | Shown in the UI |
| `secondary_interests` | Mean `twin_niche.affinity` over *T(S)* for the other niches, top 3 | e.g. dev_tools people also like ai_agents_tools |
| `hot_button_pool` | All `hot_buttons` strings from *T(S)*, with twin ids | Usually 50–300 short strings |
| `ignore_pool` | All `ignores` strings from *T(S)*, with twin ids | The skepticism and avoid source |
| `format_pool` | All `format_prefs` from *T(S)* | → layout and visual cues |
| `tone_samples` | 15 `tone` strings sampled from *T(S)* | → copy tone |
| `top_hashtags` | `x_post_entity` (hashtag) on posts by *T(S)*, by count | Vocabulary only, never copied into the ad |
| `media_mix` | `x_post_media.type` share on *T(S)* posts, plus top alt-text keywords | e.g. "62% photo, 30% video, mostly screenshots" |
| `exemplar_posts` | The 5 highest-engagement `x_post.text` items from *T(S)*, **text only, no authors** | Optional; only for the LLM's understanding, never quoted |
| `brand` | `brand_kit` plus brand `x_user.description` plus brand posts if ingested | Value props, palette, product |

### 4.3 LLM synthesis (Grok text, structured output)

Use `grok-4.3` ($1.25 / $2.50 per million tokens) with `response_format: json_schema` (or `xai_sdk` `chat.parse(PydanticModel)`). It clusters the pools into themes and writes the brief. Every theme must cite the twin ids it came from, and Python computes **support = |cited ids ∩ T(S)| / |T(S)|**. Python sets that number; the LLM never does. Themes with support under 0.08 are dropped.

```python
class Theme(BaseModel):
    text: Text(80)                     # "Honest tool comparisons with real numbers"
    twin_ids: list[str]                # evidence: which twins this theme came from
    support: float = 0                 # filled in by Python, not the LLM

class CreativeBrief(BaseModel):
    segment: str                       # niche slug
    audience_label: Text(60)           # "Indie builders shipping with AI tools"
    key_interests: Items(Theme, 5)     # from hot_button_pool
    avoid: Items(Theme, 5)             # from ignore_pool: skepticism and avoid triggers
    tone: Text(120)                    # "Candid, specific, a little wry. No hype words."
    value_props: Items(str, 3)         # brand_kit value props ranked for this segment
    message_angle: Text(160)           # one-sentence angle for this segment
    headline_options: Items(Text(60), 3)
    cta: Text(30)
    visual_cues: Items(str, 5)         # "real product UI on screen", "dark mode", "keyboard close-up"
    visual_avoid: Items(str, 4)        # "stock-photo smiling people", "neon crypto aesthetic"
    format: Literal["product_ui", "lifestyle", "typographic", "illustration", "meme"]
```

The brief is stored as structured columns (§5) plus `evidence_json`, so the UI can show "why" on hover: "**Honest tool comparisons**: 34% of this segment (cites 41 personas)."

### 4.4 Brief → image prompt (template)

The Creative Director agent (Grok text) turns one brief into **N distinct image prompts**. Each prompt is a different concept, not a copy, because diversity comes from the concept, not from `n`. The prompts are built from this template:

```text
{format_style_line}.
Subject: {concept_subject}. Setting: {setting}.
Brand: {brand.name}. Palette: {brand.palette_hex_names}. Mood: {tone_as_visual}.
Show: {visual_cues joined}.
Composition: {aspect_ratio} social ad, clear focal point, leave clean negative space in the {top|bottom} third for a headline overlay.
Avoid: {visual_avoid joined}, {global_avoid}.
Do not render any text, logos, watermarks, or real people's faces.   # copy goes on as an HTML overlay
```

`global_avoid` is always added: *"no real or recognizable people, no celebrity likeness, no political, religious, medical or demographic symbolism, no text."*

**Headline and CTA are an HTML/CSS overlay in the UI, not baked into the pixels.** That makes copy edits instant and free, avoids image-model typos, and lets the simulation score copy and image separately. A "Bake text" toggle is a stretch: `/images/edits` with "add the headline '…' in the top third in bold sans-serif."

### 4.5 Edit instructions → edit prompt

| UI action | API | Prompt construction |
|---|---|---|
| **Tweak prompt** (user edits the text) | `/images/generations` (new root take) | The user's edited prompt, with the brand and global-avoid suffix appended |
| **Make it more X** (chips: *bolder*, *warmer*, *more minimal*, *more product-focused*, *more playful*, *darker*) or free text | `/images/edits`, `image.url = parent.public_url` | `"Keep the composition, subject and brand palette. Change only: {instruction}. {global_avoid}"` |
| **Regenerate** | Same endpoint and prompt as the parent | Identical; a new take (no seed control) |
| **Branch with reference** | `/images/edits` with `images: [parent, brand_ref]` | `"Use <IMAGE_1>'s product UI inside <IMAGE_0>'s scene…"` |
| **Resize** | `/images/edits`, same image, new `aspect_ratio` | `"Recompose this exact ad for {ratio}; keep everything else."` |
| **Retarget to segment B** | `/images/edits` | Grok text rewrites the instruction from brief B's visual cues |

---

## 5. New SpacetimeDB tables (creative layer)

Add these to `x-followers-db/src/index.ts` in a new block after the twins block:

```ts
// ---------- Creative: campaign generation, written by backend/creative (Grok). Raw X tables and twins stay untouched. ----------
```

The rules match the existing module: raw tables (`x_*`) are untouched, persona inferences (`twin*`) are untouched, and creative rows only **reference** them by id. Everything is public to read. Writes from the browser go only through **request reducers** that validate and rate-limit, like `askTwin`. Results are written only by admin reducers from the worker.

```ts
const BriefTheme = t.object('BriefTheme', { text: t.string(), support: t.f64(), twinIds: t.array(t.string()) });

const brandKit = table({ name: 'brand_kit', public: true }, {
  brandUserId: t.string().primaryKey(),
  displayName: t.string(),
  productDescription: t.string(),
  valueProps: t.array(t.string()),
  palette: t.array(t.string()),            // hex codes
  visualStyle: t.string(),                 // "dark UI, crisp, minimal, keyboard-first"
  bannedClaims: t.array(t.string()),       // "fastest", "free forever", …
  referenceImageUrls: t.array(t.string()), // product screenshots (public URLs), ≤ 4
  updatedAt: t.timestamp(),
});

const campaign = table({ name: 'campaign', public: true }, {
  campaignId: t.string().primaryKey(),     // uuid from the client
  brandUserId: t.string().index('btree'),
  name: t.string(),
  goal: t.string(),                        // "Launch Raycast AI extensions"
  offer: t.option(t.string()),
  channel: t.string(),                     // bluesky | x | instagram
  aspectRatio: t.string(),                 // default for the campaign: "1:1"
  segments: t.array(t.string()),           // niche slugs chosen
  variantsPerBrief: t.u8(),                // 2..4
  status: t.string(),                      // draft | briefing | generating | reviewing | handed_off
  createdBy: t.identity(),
  createdAt: t.timestamp(),
});

const creativeBrief = table({ name: 'creative_brief', public: true }, {
  briefId: t.string().primaryKey(),        // `${campaignId}:${segment}:${version}`
  campaignId: t.string().index('btree'),
  segment: t.string(),
  version: t.u32(),                        // a user edit makes a new version; old ones stay
  audienceLabel: t.string(),
  share: t.f64(), twinCount: t.u32(),
  keyInterests: t.array(BriefTheme),
  avoid: t.array(BriefTheme),
  tone: t.string(), messageAngle: t.string(),
  valueProps: t.array(t.string()),
  headlineOptions: t.array(t.string()), cta: t.string(),
  visualCues: t.array(t.string()), visualAvoid: t.array(t.string()),
  format: t.string(),
  editedByUser: t.bool(),
  model: t.string(),                       // grok-4.3
  createdAt: t.timestamp(),
});

const adVariant = table({ name: 'ad_variant', public: true }, {
  variantId: t.string().primaryKey(),
  campaignId: t.string().index('btree'),
  briefId: t.string().index('btree'),
  parentVariantId: t.option(t.string()),   // lineage; none = root take
  rootVariantId: t.string(),
  depth: t.u8(),
  operation: t.string(),                   // generate | regenerate | edit | branch | resize | retarget
  instruction: t.option(t.string()),       // user's "make it warmer"
  imagePrompt: t.string(),                 // the exact prompt sent (shown to the user)
  headline: t.string(), cta: t.string(),   // overlay copy (editable without re-render)
  aspectRatio: t.string(),
  model: t.string(), quality: t.string(),
  status: t.string().index('btree'),       // queued | generating | ready | failed | filtered
  imageUrl: t.option(t.string()),          // files-cdn.x.ai public_url
  xaiFileId: t.option(t.string()),
  costUsdTicks: t.u64(),
  error: t.option(t.string()),
  starred: t.bool(),
  approved: t.bool(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

// Work queue, same shape as twin_question: the browser asks, the worker claims and fulfils.
const creativeJob = table({ name: 'creative_job', public: true }, {
  jobId: t.u64().primaryKey().autoInc(),
  campaignId: t.string().index('btree'),
  kind: t.string(),                        // brief | generate | edit | regenerate | resize
  targetId: t.string(),                    // briefId or parent variantId
  instruction: t.option(t.string()),
  aspectRatio: t.option(t.string()),
  status: t.string().index('btree'),       // pending | running | done | failed
  requestedBy: t.identity(),
  error: t.option(t.string()),
  createdAt: t.timestamp(),
  finishedAt: t.option(t.timestamp()),
});
```

**Reducers.** Public ones validate and enforce per-sender caps, like `askTwin`. Admin ones go through `requireAdmin`.

| Reducer | Who | Purpose |
|---|---|---|
| `create_campaign(campaignId, brandUserId, name, goal, offer?, channel, aspectRatio, segments[], variantsPerBrief)` | public | Validates that the brand has twins, that segments are in `niche`, and that none is `politics_society`; ≤ 4 segments, ≤ 4 variants. Enqueues `brief` jobs. |
| `request_creative(campaignId, kind, targetId, instruction?, aspectRatio?)` | public | Enqueues a generate, edit, regenerate or resize job. Caps instructions at 300 characters, **≤ 3 open jobs per sender**, and **≤ 60 variants per campaign** (budget guard ≈ $3). |
| `edit_brief(briefId, …fields)` | public | Writes a new version with `editedByUser = true`. |
| `set_variant_copy(variantId, headline, cta)` | public | Overlay copy edits (no image call) |
| `star_variant`, `approve_variant(variantId, approved)` | public | Review state |
| `handoff_campaign(campaignId)` | public | Sets `status = handed_off`. The simulation worker picks up approved variants. |
| `upsert_brand_kit(...)` | admin | Seed the brand kit |
| `claim_creative_job`, `finish_creative_job`, `fail_creative_job` | admin | Job lifecycle (mirrors the twin-question reducers) |
| `publish_brief(...)`, `upsert_variant(...)` | admin | Worker writes results. A variant row is inserted as `generating` first so the UI shows a skeleton card immediately. |

Later, owned by the Simulation agent, not part of this plan: `variant_score(variantId, segment, attention, relevance, credibility, clickInterest, shareInterest, sentiment, n, reasoningSample)`.

**Why not store image bytes in SpacetimeDB?** A 1k JPEG is about 200–500 KB, or 270–670 KB as base64. With dozens of variants streamed to every subscriber, that bloats subscriptions. `x_user.profileImage` does store data URLs, but those are 400×400 avatars. The persistent `files-cdn.x.ai` URL from `storage_options.public_url` is a single string. Fallback: if storage fails (`storage_error`), request `b64_json`, write the file to `frontend/public/generated/{variantId}.jpg` (served by Vite in dev), and store that relative path.

---

## 6. The iterative loop (Melius-like)

```text
             ┌──────────── campaign (goal, offer, channel, ratio, segments) ────────────┐
             ▼                                                                           │
  [Brief job] Python aggregates segment → Grok text → creative_brief v1 (with evidence)  │
             │   user can edit any field → creative_brief v2 (editedByUser)              │
             ▼                                                                           │
  [Generate job] Creative Director: brief → N concept prompts → Image Gen: N× /generations
             ▼                                                                           │
  Grid: N cards per segment. Each card shows the image, overlay headline/CTA, the exact prompt, and "why" (themes).
             │
   ┌─────────┼───────────────┬──────────────┬─────────────┬──────────────┐
   ▼         ▼               ▼              ▼             ▼              ▼
 Tweak    Make it more…   Regenerate     Branch +      Resize        Edit copy
 prompt   (/edits on      (same prompt)  brand ref     (/edits new   (no image call)
 (/gen)   parent)                        (/edits ×2)    ratio)
   └─────────┴───────────────┴──────────────┴─────────────┴──→ new ad_variant(parentVariantId = card)
             ▼
  Lineage strip: root → take 2 → take 3 (click any take to restore or branch)
             ▼
  ★ Approve (1–3 per segment) → "Send to simulation" → handoff_campaign
```

Every action is one `request_creative` call. The worker creates the child `ad_variant` row as `generating`, then fills it in. The UI re-renders from the subscription, with no polling and no request/response plumbing in the browser. This is the same reason SpacetimeDB was chosen for the shared state.

---

## 7. Agent design (Fetch.ai uAgents)

The core logic lives in plain Python functions in a new `backend/creative/` package, alongside `backend/twins/`:

```text
backend/creative/
  config.py      # XAI_API_KEY loader (never printed), model names, budget caps
  grok.py        # thin HTTP client: chat_json(), generate_images(), edit_image(); retry/backoff
  segments.py    # deterministic aggregation (§4.2) via StdbClient.sql
  brief.py       # build_brief(stdb, campaign, segment) -> CreativeBrief (+ support math)
  prompts.py     # brief -> concept prompts; instruction -> edit prompt; guardrail suffix + filters
  worker.py      # poll creative_job (pending) → claim → run → publish; also `--once` for demos
  cli.py         # `python -m creative brief|generate|edit ...` for testing without UI
```

There are two ways to drive it, and both call the same functions:

1. **Web UI path (primary for the demo):** browser → reducer → `creative_job` → `creative.worker` → reducers → subscription → browser. No agents are in the hot path, so there's less to break on stage.
2. **Agent path (for Fetch.ai/ASI:One prize credibility):** two new specialists sit behind the existing `ripple` orchestrator, the same way `ripple-audience` wraps `audience_profile()`.

| Agent | Role | Wraps |
|---|---|---|
| `ripple-creative-director` | Segment aggregation → brief → concept prompts; also turns "make it more X" into edit prompts | `creative.brief`, `creative.prompts` (Grok text) |
| `ripple-image-gen` | Calls Grok Imagine generate/edit, persists URLs, writes `ad_variant` | `creative.grok` |
| `ripple` (existing orchestrator) | New `asi1.plan_campaign` action **`create`**: "Make 3 ads for @raycast.com's dev-tools crowd about Raycast AI" → Director → ImageGen → reply with image links, then optionally chain into the existing `ReactRequest` for scoring | — |

Message shapes go in `ripple_agents/messages.py`, following the existing convention that failures travel in `error`:

```python
class BriefRequest(Model):
    brand: str
    campaign_id: str
    goal: str
    segments: list[str] = []        # niche slugs; empty = top 3 by share
    offer: str = ""

class BriefResult(Model):
    campaign_id: str
    brief_ids: list[str] = []
    error: str = ""

class GenerateRequest(Model):
    campaign_id: str
    brief_id: str
    n: int = 3
    aspect_ratio: str = "1:1"

class EditRequest(Model):
    campaign_id: str
    parent_variant_id: str
    operation: str                  # edit | regenerate | resize | branch
    instruction: str = ""
    aspect_ratio: str = ""

class VariantsResult(Model):
    campaign_id: str
    variant_ids: list[str] = []
    image_urls: list[str] = []
    error: str = ""

# Handoff into the existing simulation path (already exists): ReactRequest(drafts=[headline + " — " + image description])
```

Bulky data (briefs, images) is **not** sent in messages. Agents pass ids, and the state lives in SpacetimeDB, which keeps uAgents messages small and makes everything visible in the dashboard live.

---

## 8. Minimal frontend (fits the existing stack)

The stack is Vite + React 19 + TypeScript, with Clerk auth, lucide icons, Radix/base-ui, and `dashboard.css`. The existing `DashboardPage.tsx` has views `overview | discover | drafts | audience | runs`, but it uses **sample data and has no SpacetimeDB client**. The older `ripple-app/` has generated bindings for a different module.

1. **Add live data:** `npm i spacetimedb` in `frontend/`, then `spacetime generate --lang typescript --out-dir frontend/src/module_bindings --module-path x-followers-db`. Connect to `wss://maincloud.spacetimedb.com`, database `ripple-mhacks`, and subscribe to `SELECT * FROM campaign`, `creative_brief`, `ad_variant` and `creative_job` (filtered by `campaign_id`), plus `niche`. Read-only subscriptions are fine because the tables are public.
2. **New view `studio`** ("Campaign studio", `Sparkles` icon) in the `views` array:
   - **Left rail (setup):** a brand selector (`raycast.com` / `spacetimedb`), goal, offer, channel, aspect-ratio pills, segment checkboxes showing share% (from `twin_niche`), and variants-per-segment (2–4). **Generate briefs** sits at the bottom.
   - **Brief cards (one row per segment):** editable fields, themes shown as chips with support % and a tooltip "cites N personas", and red "Avoid" chips. **Generate ads →**.
   - **Variant grid:** a card shows the image with the overlay headline/CTA (CSS absolute, editable inline), a status skeleton while generating, and a collapsible prompt. Card actions: *Make it more…* (chips plus free text), *Regenerate*, *Tweak prompt*, *Resize*, *★ Approve*. Cost so far (sum of `costUsdTicks`) shows in the header.
   - **Lineage strip** under a selected card: thumbnails root → takes. Click one to select it, or branch from it.
   - **Footer:** "Send N approved to simulation →" calls `handoff_campaign` and switches to `overview`/`drafts` with the approved headlines prefilled.
3. **Fallback if bindings fight us:** read via `POST https://maincloud.spacetimedb.com/v1/database/ripple-mhacks/sql` every 2 s, and call reducers via `POST …/call/<reducer>` (the same HTTP surface `twins/stdb.py` uses).

---

## 9. Ethics guardrails (enforced in code, not just in prompts)

- **Input allow-list for LLM and image prompts:** only aggregated `hot_buttons`, `ignores`, `format_prefs`, `tone`, niche affinities, hashtags, media-type mix, and brand-kit fields. **Never** `persona_summary`, `username`, `name`, bios, `location`, avatars/`profileImage`, mentions, or post authors. Evidence ids stay in SpacetimeDB for the "why" tooltip and are **never** sent to Grok Imagine.
- **No sensitive-trait targeting:** segments come only from the niche catalog. `politics_society` is excluded at `create_campaign`. A post-LLM filter drops any theme or cue that matches a sensitive-term list (race/ethnicity, religion, health/medical, sexuality, politics/party, income/wealth, age/minor). The brief prompt also tells Grok: *"Describe interests and content preferences only. Never infer or mention demographics or protected traits."*
- **No real likenesses:** the global-avoid suffix covers "no real or recognizable people… no text/logos." No follower image is ever passed as an edit reference; only `brand_kit.referenceImageUrls` (brand-owned product shots) are allowed, and the worker enforces this.
- **Minimum segment size of 15** twins, so a brief can't describe one person.
- **Moderation:** if xAI filters an output (moderation flag or error), set the variant to `filtered`, show "This take was filtered," and never retry the same prompt automatically. Violations are still billed.
- **Label everything** in the UI: "Synthetic audience personas · AI-generated creative."
- `bannedClaims` from the brand kit are stripped from headlines and listed as avoid terms.

---

## 10. API call examples

```python
# backend/creative/grok.py (sketch)
import os, time, requests
BASE = "https://api.x.ai/v1"
IMAGE_MODEL, TEXT_MODEL = "grok-imagine-image-2.0", "grok-4.3"

def _post(path, body, timeout=120):
    for attempt in range(4):
        r = requests.post(f"{BASE}/{path}", json=body, timeout=timeout,
                          headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"})
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** attempt + 0.5); continue
        raise GrokError(f"{path} -> {r.status_code}: {r.text[:200]}")   # 400 = bad prompt or moderation; don't retry
    raise GrokError(f"{path}: gave up after retries")

def _store(variant_id):
    return {"filename": f"ripple-{variant_id}.jpg", "public_url": True}

def generate(prompt, variant_id, aspect="1:1", quality="low"):
    d = _post("images/generations", {"model": IMAGE_MODEL, "prompt": prompt, "n": 1,
              "aspect_ratio": aspect, "quality": quality, "resolution": "1k",
              "storage_options": _store(variant_id)})
    img = d["data"][0]
    url = (img.get("file_output") or {}).get("public_url") or img["url"]   # temp url only as a last resort
    return url, (img.get("file_output") or {}).get("file_id"), d["usage"]["cost_in_usd_ticks"]

def edit(prompt, variant_id, sources: list[str], aspect=None, quality="low"):
    body = {"model": IMAGE_MODEL, "prompt": prompt, "quality": quality,
            "storage_options": _store(variant_id)}
    body |= {"image": {"url": sources[0], "type": "image_url"}} if len(sources) == 1 else \
            {"images": [{"url": u, "type": "image_url"} for u in sources[:5]]}
    if aspect: body["aspect_ratio"] = aspect
    d = _post("images/edits", body)
    ...

def chat_json(system, user, schema_model):
    d = _post("chat/completions", {"model": TEXT_MODEL, "messages": [
        {"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": schema_model.__name__, "schema": schema_model.model_json_schema(), "strict": True}}})
    return schema_model.model_validate_json(d["choices"][0]["message"]["content"])
```

Use separate `generate` calls (one per concept prompt), concurrently through a thread pool of 4. Use `n>1` only for "4 more takes of this exact prompt." Note that `requests` and `pydantic` are already in `backend/pyproject.toml`, so no new dependency is needed. `xai_sdk` is optional.

**Brief system prompt (abridged):**

```text
You are a creative strategist. You get anonymised, aggregated signals about ONE audience segment of a brand's
followers (interest phrases, things they ignore, format preferences, tone samples) plus the brand kit.
Cluster the phrases into ≤5 interest themes and ≤5 avoid themes. For each theme list the twin_ids whose
phrases support it. Then write the brief fields. Rules: describe interests and content preferences only; never
infer or mention demographics, politics, religion, health, sexuality, income or age; never mention any person
or handle; no claims the brand kit doesn't support; avoid every bannedClaim.
```

**Concept prompt request:** "Write {n} *different* ad concepts for this brief (vary format, setting and metaphor). Return `[{concept_name, image_prompt, headline, cta}]` and fill `image_prompt` using this template: {§4.4}."

**Error handling summary:**

| Failure | Handling |
|---|---|
| 429 / 5xx | Exponential backoff up to 4 tries (1.5 s, 2.5 s, 4.5 s, 8.5 s). Max 4 concurrent image calls. |
| 400 or moderation | Variant becomes `filtered`/`failed` with the message. No auto-retry. The UI offers "Tweak prompt." |
| `storage_error` / `public_url_error` | Fall back to re-requesting as `b64_json` and saving to `frontend/public/generated/`. |
| Temp URL 403 | Never fetch temp URLs server-side. An edit with a temp URL as input works but expires, so always chain from `public_url`. |
| LLM JSON invalid | Use the existing `Text`/`Items` pydantic helpers (clip, coerce), retry once, then fall back to a template brief built from the top-3 raw phrases by frequency. |
| Worker crash mid-job | A job stuck in `running` for more than 3 minutes is reset to `pending` on worker start. |
| Budget | `request_creative` rejects once the campaign has ≥ 60 variants. The worker logs a running `cost_in_usd_ticks` total. |

---

## 11. Build order (hackathon, about 11 hours with one person, or about 6 with two in parallel)

| # | Task | Est. | Done when |
|---|---|---|---|
| 0 | Ingest Raycast's own posts (1 bsky call) and seed `brand_kit` for Raycast and SpacetimeDB by hand | 0.5 h | Rows are visible in SQL |
| 1 | Module: add creative tables and reducers, a `smoke-creative.sh` against a scratch DB, then publish to `ripple-mhacks` (additive only; no migration of existing tables) | 1.5 h | Smoke test passes; live schema shows the tables |
| 2 | `creative/grok.py` + `cli.py generate "prompt"`: one image to `public_url` | 0.75 h | URL opens in the browser |
| 3 | `creative/segments.py` + `brief.py` + support math + guardrail filter; `cli.py brief raycast.com dev_tools` | 1.5 h | Sensible brief JSON with support % |
| 4 | `prompts.py` (concepts, edit instructions) + `worker.py` job loop | 1.5 h | A `create_campaign` from the CLI yields briefs and 3 variants per segment |
| 5 | Frontend: bindings + subscription + Studio setup + brief cards + grid with overlay | 2.5 h | End to end in the browser |
| 6 | Iteration actions (make-it-more chips, regenerate, resize, tweak) + lineage strip | 1.5 h | A 3-deep take chain renders |
| 7 | Approve + handoff into the existing `ReactRequest` simulation (headline + concept text as the draft) | 0.75 h | Approved ads get reaction scores |
| 8 | Fetch.ai: `ripple-creative-director` and `ripple-image-gen` agents + orchestrator `create` action | 1 h | ASI:One "make ads for…" returns image links |
| 9 | Demo hardening: pre-generate one full campaign as a fixture; record the fallback | 0.5 h | Demo works offline from fixtures |

**Critical path for a demo:** 0 → 1 → 2 → 3 → 4 → 5 → 6. Steps 7 and 8 are what tie it into the Ripple story and the Fetch.ai prize, so do them if there's time.

---

## 12. Risks and cuts

| Risk | Mitigation or cut |
|---|---|
| Images look generic or off-brand | Use a brand kit with hex palette plus 1–2 product screenshots through multi-image edit ("put <IMAGE_1>'s UI on the laptop in <IMAGE_0>"). Keep text out of pixels. |
| Grok Imagine renders fake UI or gibberish text | The prompt says "no text." Overlay copy in HTML. For product shots, use branch-with-reference. |
| Latency (15 s per image) feels slow on stage | Run variants concurrently, show skeleton cards via subscription, and pre-generate a fixture campaign. |
| Briefs are vague or repetitive across segments | Diff segments: pass the other segments' top themes to the LLM as "what makes this segment different." |
| Wiring bindings into the existing frontend eats time | Cut to the HTTP SQL polling fallback (§8.3). |
| Module publish breaks existing tables | Only add tables and reducers (additive). Smoke-test on a scratch DB first, like `smoke-twins.sh`. |
| Cost runaway | Use `quality: low`, `1k`, the 60-variant cap per campaign, and 3 open jobs per sender. A full demo campaign (4 segments × 3 variants + ~15 edits) costs about **$1.30**. |
| Moderation false positives on ad prompts | Avoid people/brand-name-heavy prompts. Surface `filtered` clearly. |
| **Cut list (in order):** video, Fetch.ai agent path (keep the CLI/worker), resize, branch-with-reference, lineage tree (keep a linear "takes" list), brief editing (keep regenerate-brief), Grok vision visual profile | — |

---

## 13. How this plugs into simulate → optimize

1. **Handoff:** approved `ad_variant` rows (image URL, headline, CTA, `briefId`, `segment`) become the simulation input. Today that means calling the existing `ReactRequest(drafts=[f"{headline} — [image: {concept description}]"], niches=[segment])`. Later, the Simulation agent will pass the **image URL to a vision-capable model** (Grok `grok-4.3` image understanding) per persona and score the rubric: attention, relevance, credibility, click interest, share interest, sentiment and reasoning, into `variant_score`.
2. **Compare:** variant × segment heatmaps in the Studio (rows: approved variants; columns: segments; cell: mean score), plus cross-segment spillover (does the dev-tools ad also land with startups?).
3. **Optimize loop (later):** an Optimizer agent reads the low-scoring rubric dimensions and the personas' `reasoning`, and emits **edit instructions** ("credibility low: personas want real numbers → add a metric callout area; less glossy"). Those are fed back through exactly the same `request_creative(kind='edit', parent=winner)` path, so **generate → simulate → analyze → optimize** reuses this plan's tables, lineage and worker unchanged. Each optimization round is a new depth in the lineage tree, so the demo can show "take 1 → take 4: +18% click interest in dev-tools."
4. **Learning signal:** store which instruction chips improved which rubric dimensions per segment (`edit_effect` table, later). That becomes the "brand memory" that makes later briefs better.
