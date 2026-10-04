// Raw X API data only. Persona/AI-inferred data belongs in separate tables.
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

const str = () => t.option(t.string());
const u64 = () => t.option(t.u64());
const bool = () => t.option(t.bool());

const xUserFields = {
  userId: t.string(),
  username: t.string(),
  name: t.string(),
  description: str(),
  location: str(),
  createdAt: str(),
  url: str(),
  profileImageUrl: str(),
  protected: bool(),
  verified: bool(),
  verifiedType: str(),
  followersCount: u64(),
  followingCount: u64(),
  listedCount: u64(),
  postCount: u64(),
  likeCount: u64(),
  mediaCount: u64(),
};

const xPostFields = {
  postId: t.string(),
  authorUserId: t.string(),
  text: t.string(),
  createdAt: t.string(),
  lang: str(),
  inReplyToUserId: str(),
  isReply: t.bool(),
  isQuote: t.bool(),
  impressionCount: u64(),
  likeCount: u64(),
  replyCount: u64(),
  quoteCount: u64(),
  repostCount: u64(),
  bookmarkCount: u64(),
};

const postReferenceFields = {
  postId: t.string(),
  referencedPostId: t.string(),
  referenceType: t.string(), // replied_to | quoted, as returned by X (retweets are excluded)
};

const postEntityFields = {
  postId: t.string(),
  entityType: t.string(), // hashtag | cashtag | mention | url
  value: t.string(), // tag, @username, or expanded URL
  startOffset: t.u32(),
  endOffset: t.u32(),
  mentionedUserId: str(),
  title: str(), // url entities: linked page title/description when X has them
  description: str(),
};

const contextAnnotationFields = {
  postId: t.string(),
  domainId: t.string(),
  domainName: t.string(),
  entityIdFromX: t.string(),
  entityName: t.string(),
  entityDescription: str(),
};

const postMediaFields = {
  postId: t.string(),
  mediaKey: t.string(),
  type: t.string(), // photo | video | animated_gif
  url: str(), // photo url, or preview image for video/gif
  altText: str(),
  viewCount: u64(),
};

const runCounterFields = {
  followersRequested: t.u32(),
  followersDiscovered: t.u32(),
  followersProfilesSaved: t.u32(),
  followersSkippedProtected: t.u32(),
  followersFailed: t.u32(),
  postsSaved: t.u32(),
  lastProcessedUserId: str(),
  errorSummary: str(),
};

const admin = table({ name: 'admin' }, { identity: t.identity().primaryKey() });

const xUser = table(
  { name: 'x_user', public: true },
  {
    ...xUserFields,
    userId: t.string().primaryKey(),
    username: t.string().index('btree'),
    ingestedAt: t.timestamp(),
    updatedAt: t.timestamp(),
    profileImage: t.option(t.string()).default(undefined), // data: URL of the 400x400 avatar, set by fetch_profile_images.py
  }
);

const audienceMembership = table(
  {
    name: 'audience_membership',
    public: true,
    indexes: [
      { accessor: 'by_brand_follower', algorithm: 'btree', columns: ['brandUserId', 'followerUserId'] },
    ],
  },
  {
    membershipId: t.string().primaryKey(), // `${brandUserId}:${followerUserId}`
    brandUserId: t.string(),
    followerUserId: t.string().index('btree'),
    discoveredAt: t.timestamp(),
    ingestionRunId: t.string(),
    source: t.string().default('follower'), // follower | liked:<post_id> | reposted:<post_id>
  }
);

const xPost = table(
  { name: 'x_post', public: true },
  {
    ...xPostFields,
    postId: t.string().primaryKey(),
    authorUserId: t.string().index('btree'),
    createdAt: t.string().index('btree'),
    ingestedAt: t.timestamp(),
  }
);

const xPostReference = table(
  { name: 'x_post_reference', public: true },
  {
    id: t.string().primaryKey(), // `${postId}:${referenceType}:${referencedPostId}`
    ...postReferenceFields,
    postId: t.string().index('btree'),
  }
);

const xPostEntity = table(
  { name: 'x_post_entity', public: true },
  {
    entityId: t.string().primaryKey(), // `${postId}:${entityType}:${startOffset}`
    ...postEntityFields,
    postId: t.string().index('btree'),
  }
);

const xContextAnnotation = table(
  { name: 'x_context_annotation', public: true },
  {
    annotationId: t.string().primaryKey(), // `${postId}:${domainId}:${entityIdFromX}`
    ...contextAnnotationFields,
    postId: t.string().index('btree'),
  }
);

const xPostMedia = table(
  { name: 'x_post_media', public: true },
  {
    id: t.string().primaryKey(), // `${postId}:${mediaKey}`
    ...postMediaFields,
    postId: t.string().index('btree'),
  }
);

const xIngestionRun = table(
  { name: 'x_ingestion_run', public: true },
  {
    ingestionRunId: t.string().primaryKey(),
    targetUsername: t.string(),
    targetUserId: str(),
    startedAt: t.timestamp(),
    completedAt: t.option(t.timestamp()),
    status: t.string(), // pending | running | completed | partial | failed
    ...runCounterFields,
  }
);

// ---------- Twins: AI-inferred personas, written by backend/twins (Claude). Raw X tables above stay untouched. ----------
const TwinTopic = t.object('TwinTopic', { topic: t.string(), affinity: t.f64() });

const twinFields = {
  userId: t.string(),
  username: t.string(),
  brandUserId: t.string(),
  postCount: t.u32(),
  replyShare: t.f64(),
  quoteShare: t.f64(),
  mentionRate: t.f64(),
  avgLikes: t.f64(),
  avgImpressions: t.f64(),
  engagementRate: t.f64(),
  activeHoursUtc: t.array(t.u8()),
  topics: t.array(TwinTopic),
  tone: t.string(),
  personaSummary: t.string(),
  hotButtons: t.array(t.string()),
  ignores: t.array(t.string()),
  formatPrefs: t.array(t.string()),
  evidencePostIds: t.array(t.string()),
  model: t.string(),
};

const twin = table(
  { name: 'twin', public: true },
  {
    ...twinFields,
    userId: t.string().primaryKey(),
    username: t.string().index('btree'),
    brandUserId: t.string().index('btree'),
    buildRunId: t.string(),
    updatedAt: t.timestamp(),
  }
);

// Fixed niche catalog (owned by backend/twins/niches.py) and one row per person per niche, so niche
// membership is a plain indexed query: SELECT * FROM twin_niche WHERE niche = 'game_dev'.
const niche = table(
  { name: 'niche', public: true },
  {
    slug: t.string().primaryKey(),
    label: t.string(),
    description: t.string(),
  }
);

const twinNiche = table(
  { name: 'twin_niche', public: true },
  {
    twinNicheId: t.string().primaryKey(), // `${userId}:${niche}`
    userId: t.string().index('btree'),
    niche: t.string().index('btree'),
    affinity: t.f64(),
  }
);

const twinAudience = table(
  { name: 'twin_audience', public: true },
  {
    twinAudienceId: t.string().primaryKey(), // `${brandUserId}:${userId}`
    brandUserId: t.string().index('btree'),
    userId: t.string().index('btree'),
    lastBuildRunId: t.string(),
    updatedAt: t.timestamp(),
  }
);

const twinBuildRun = table(
  { name: 'twin_build_run', public: true },
  {
    runId: t.string().primaryKey(),
    brandUserId: t.string(),
    status: t.string(), // running | completed | partial | failed
    requested: t.u32(),
    ready: t.u32(),
    failed: t.u32(),
    skipped: t.u32(),
    startedAt: t.timestamp(),
    completedAt: t.option(t.timestamp()),
  }
);

const twinBuildJob = table(
  { name: 'twin_build_job', public: true },
  {
    jobId: t.string().primaryKey(), // `${runId}:${userId}`
    runId: t.string().index('btree'),
    userId: t.string(),
    username: t.string(),
    status: t.string(), // queued | building | ready | failed | skipped
    error: str(),
    updatedAt: t.timestamp(),
  }
);

const twinQuestion = table(
  { name: 'twin_question', public: true },
  {
    questionId: t.u64().primaryKey().autoInc(),
    userId: t.string().index('btree'),
    draft: t.string(),
    question: t.string(),
    askedBy: t.identity(),
    status: t.string().index('btree'), // pending | answering | answered | failed
    action: str(),
    confidence: t.option(t.f64()),
    answer: str(),
    citedPostIds: t.array(t.string()),
    error: str(),
    createdAt: t.timestamp(),
    answeredAt: t.option(t.timestamp()),
  }
);

// ---------- Simulation: graph edges, runs, per-person probabilities and results ----------
const EdgeInput = t.object('EdgeInput', { a: t.string(), b: t.string(), kind: t.string() });
const SimProbInput = t.object('SimProbInput', { userId: t.string(), pEngage: t.f64(), action: t.string(), reason: t.string() });

const audienceEdge = table(
  { name: 'audience_edge', public: true },
  {
    edgeId: t.string().primaryKey(), // `${brandUserId}:${a}:${b}`
    brandUserId: t.string().index('btree'),
    a: t.string(),
    b: t.string(),
    kind: t.string(), // niche_hub | niche_ring | reply | mention
  }
);

const simRun = table(
  { name: 'sim_run', public: true },
  {
    runId: t.string().primaryKey(),
    brandUserId: t.string().index('btree'),
    draft: t.string(),
    status: t.string(), // scoring | replaying | done | failed
    people: t.u32(),
    trials: t.u32(),
    reachP10: t.u32(),
    reachP50: t.u32(),
    reachP90: t.u32(),
    seenP50: t.u32(),
    replayTick: t.u32(),
    replayMaxTick: t.u32(),
    error: str(),
    createdAt: t.timestamp(),
    completedAt: t.option(t.timestamp()),
  }
);

const simProb = table(
  { name: 'sim_prob', public: true },
  {
    simProbId: t.string().primaryKey(), // `${runId}:${userId}`
    runId: t.string().index('btree'),
    userId: t.string(),
    pEngage: t.f64(),
    action: t.string(),
    reason: t.string(),
  }
);

const simNode = table(
  { name: 'sim_node', public: true },
  {
    simNodeId: t.string().primaryKey(), // `${runId}:${userId}`
    runId: t.string().index('btree'),
    userId: t.string(),
    engagedShare: t.f64(), // share of trials in which this person engaged
    seenShare: t.f64(),
    replaySeenTick: t.option(t.u32()), // trial 0, replayed live by cascade_tick
    replayEngagedTick: t.option(t.u32()),
  }
);

const cascadeReplay = table(
  { name: 'cascade_replay' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    runId: t.string(),
  }
);

// ---------- Lab: per-signal simulation, calibration, experiments ----------
const SignalProbInput = t.object('SignalProbInput', {
  userId: t.string(), pLike: t.f64(), pRepost: t.f64(), pReply: t.f64(), pQuote: t.f64(),
});

const simSignalProb = table(
  { name: 'sim_signal_prob', public: true },
  {
    simSignalProbId: t.string().primaryKey(), // `${runId}:${userId}`
    runId: t.string().index('btree'),
    userId: t.string(),
    pLike: t.f64(), pRepost: t.f64(), pReply: t.f64(), pQuote: t.f64(),
  }
);

const simSignal = table(
  { name: 'sim_signal', public: true },
  {
    simSignalId: t.string().primaryKey(), // `${runId}:${signal}`
    runId: t.string().index('btree'),
    signal: t.string(), // like | repost | reply | quote
    p10: t.u32(), p50: t.u32(), p90: t.u32(),
    mean: t.f64(),
  }
);

const simNodeSignal = table(
  { name: 'sim_node_signal', public: true },
  {
    simNodeSignalId: t.string().primaryKey(), // `${runId}:${userId}`
    runId: t.string().index('btree'),
    userId: t.string(),
    likeShare: t.f64(), repostShare: t.f64(), replyShare: t.f64(), quoteShare: t.f64(),
  }
);

const simEvent = table(
  { name: 'sim_event', public: true },
  {
    simEventId: t.string().primaryKey(), // `${runId}:${userId}:${signal}` — trial 0 only, replayed live
    runId: t.string().index('btree'),
    userId: t.string(),
    signal: t.string(),
    tick: t.u32(),
  }
);

const simCalibration = table(
  { name: 'sim_calibration', public: true },
  {
    scope: t.string().primaryKey(), // brand user id, or 'default'
    feedReach: t.f64(), shareReach: t.f64(),
    likeScale: t.f64(), repostScale: t.f64(), replyScale: t.f64(), quoteScale: t.f64(),
    source: t.string(), // default | anchor | backtest | test
    note: t.string(),
    updatedAt: t.timestamp(),
  }
);

const labExperiment = table(
  { name: 'lab_experiment', public: true },
  {
    experimentId: t.u64().primaryKey().autoInc(),
    brandUserId: t.string().index('btree'),
    brand: t.string(),
    title: t.string(),
    draftA: t.string(),
    draftB: t.string(),
    status: t.string().index('btree'), // queued | running | done | failed
    runA: t.string(),
    runB: t.string(),
    winner: t.string(), // '' | A | B | tie
    lift: t.f64(),
    error: str(),
    requestedBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

const backtestResult = table(
  { name: 'backtest_result', public: true },
  {
    backtestResultId: t.string().primaryKey(), // `${scope}:${metric}`
    scope: t.string(),
    metric: t.string(),
    value: t.f64(),
    baseline: t.f64(),
    n: t.u32(),
    note: t.string(),
    updatedAt: t.timestamp(),
  }
);

// Outside-the-audience engagement: per run+signal split, the replayed trial's outside counts per tick, and comments.
const simSignalSource = table(
  { name: 'sim_signal_source', public: true },
  {
    simSignalSourceId: t.string().primaryKey(), // `${runId}:${signal}:${source}` source = followers | outside
    runId: t.string().index('btree'),
    signal: t.string(), // like | repost | reply | quote | view
    source: t.string(),
    mean: t.f64(),
  }
);

const simOutsideTick = table(
  { name: 'sim_outside_tick', public: true },
  {
    simOutsideTickId: t.string().primaryKey(), // `${runId}:${tick}`
    runId: t.string().index('btree'),
    tick: t.u32(),
    views: t.u32(), likes: t.u32(), reposts: t.u32(), replies: t.u32(), quotes: t.u32(),
  }
);

const CommentInput = t.object('CommentInput', { userId: t.string(), kind: t.string(), text: t.string(), tick: t.u32() });

const simComment = table(
  { name: 'sim_comment', public: true },
  {
    simCommentId: t.string().primaryKey(), // `${runId}:${userId}:${kind}`
    runId: t.string().index('btree'),
    userId: t.string(),
    kind: t.string(), // reply | quote
    text: t.string(),
    tick: t.u32(),
  }
);

// Onboarding: a browser enters its brand's X handle; the backend worker scrapes followers (Scweet), builds twins and
// the audience graph, advancing `status` so the form can show live progress. The brief fields are the user's answers.
const onboarding = table(
  { name: 'onboarding', public: true },
  {
    onboardingId: t.u64().primaryKey().autoInc(),
    handle: t.string(),
    brandUserId: t.string(), // '' until the brand profile is scraped
    status: t.string().index('btree'), // queued | scraping | twins | graph | ready | failed
    ingestionRunId: t.string(), // x_ingestion_run row with live follower/post counters
    twinRunId: t.string(), // twin_build_run row with live ready/failed counters
    ownerName: t.string(),
    role: t.string(),
    campaignName: t.string(),
    campaignNews: t.string(),
    goal: t.string(), // '' | reposts | likes | replies | views
    error: str(),
    requestedBy: t.identity().index('btree'),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);
// ---------- Creative: campaign generation, written by backend/creative (Grok). ----------
const BriefTheme = t.object('BriefTheme', {
  text: t.string(), support: t.f64(), twinIds: t.array(t.string()),
});
const brandKitFields = {
  brandUserId: t.string(), displayName: t.string(), productDescription: t.string(),
  valueProps: t.array(t.string()), palette: t.array(t.string()), visualStyle: t.string(),
  bannedClaims: t.array(t.string()), referenceImageUrls: t.array(t.string()),
};
const brandKit = table({ name: 'brand_kit', public: true }, {
  ...brandKitFields, brandUserId: t.string().primaryKey(), updatedAt: t.timestamp(),
});
const campaign = table({ name: 'campaign', public: true }, {
  campaignId: t.string().primaryKey(), brandUserId: t.string().index('btree'),
  name: t.string(), goal: t.string(), offer: str(), channel: t.string(), aspectRatio: t.string(),
  segments: t.array(t.string()), variantsPerBrief: t.u8(), status: t.string(),
  createdBy: t.identity(), createdAt: t.timestamp(),
});
const creativeBriefFields = {
  briefId: t.string(), campaignId: t.string(), segment: t.string(), version: t.u32(),
  audienceLabel: t.string(), share: t.f64(), twinCount: t.u32(),
  keyInterests: t.array(BriefTheme), avoid: t.array(BriefTheme),
  tone: t.string(), messageAngle: t.string(), valueProps: t.array(t.string()),
  headlineOptions: t.array(t.string()), cta: t.string(), visualCues: t.array(t.string()),
  visualAvoid: t.array(t.string()), format: t.string(), model: t.string(), evidenceJson: str(),
};
const creativeBrief = table({ name: 'creative_brief', public: true }, {
  ...creativeBriefFields, briefId: t.string().primaryKey(), campaignId: t.string().index('btree'),
  editedByUser: t.bool(), createdAt: t.timestamp(),
});
const adVariantFields = {
  jobId: t.u64(), variantId: t.string(), campaignId: t.string(), briefId: t.string(),
  parentVariantId: str(), rootVariantId: t.string(), depth: t.u8(), operation: t.string(),
  instruction: str(), imagePrompt: t.string(), headline: t.string(), cta: t.string(),
  aspectRatio: t.string(), model: t.string(), quality: t.string(), status: t.string(),
  imageUrl: str(), xaiFileId: str(), costUsdTicks: t.u64(), error: str(),
};
const adVariant = table({ name: 'ad_variant', public: true }, {
  ...adVariantFields, variantId: t.string().primaryKey(), campaignId: t.string().index('btree'),
  briefId: t.string().index('btree'), jobId: t.u64().index('btree'), status: t.string().index('btree'),
  starred: t.bool(), approved: t.bool(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});
const creativeJob = table({ name: 'creative_job', public: true }, {
  jobId: t.u64().primaryKey().autoInc(), campaignId: t.string().index('btree'),
  kind: t.string(), targetId: t.string(), instruction: str(), aspectRatio: str(),
  status: t.string().index('btree'), requestedBy: t.identity(), error: str(),
  reservedVariants: t.u8(), claimedBy: t.option(t.identity()), claimedAt: t.option(t.timestamp()),
  createdAt: t.timestamp(), finishedAt: t.option(t.timestamp()),
});

// Immutable audience versions survive replacement of active imported data.
const audienceSnapshot = table({ name: 'audience_snapshot', public: true }, {
  snapshotId: t.string().primaryKey(), brand: t.string().index('btree'), brandUserId: t.string(),
  title: t.string(), sourceRunId: t.string(), people: t.u32(), niches: t.u32(),
  payload: t.string(), createdAt: t.u64(), archivedAt: t.timestamp(),
});
const archivedProfile = table({ name: 'archived_profile', public: true }, {
  userId: t.string().primaryKey(), username: t.string(), name: t.string(),
  profileImageUrl: t.string(), verified: t.bool(),
});

// ---------- Campaign videos: Opus 5.5 writes a seek(t) film, rendered by backend/video ----------
const campaignVideo = table({ name: 'campaign_video', public: true }, {
  videoId: t.string().primaryKey(),
  brand: t.string().index('btree'),
  campaignId: t.string(), // '' when made outside a campaign
  news: t.string(), goal: t.string(),
  status: t.string().index('btree'), // queued | research | brief | voice | film | stills | revise | render | thumbnail | done | failed
  progress: t.f64(), // 0..1
  title: t.string(), videoUrl: t.string(), thumbnailUrl: t.string(),
  durationS: t.f64(), scriptJson: t.string(), reviewJson: t.string(),
  error: str(), requestedBy: t.identity(), createdAt: t.timestamp(), updatedAt: t.timestamp(),
});

// A video attached to one draft of a Lab experiment: the Lab tweet shows it as the post's media.
const labDraftMedia = table({ name: 'lab_draft_media', public: true }, {
  mediaId: t.string().primaryKey(), // `${experimentId}:${draft}`
  experimentId: t.u64().index('btree'),
  draft: t.string(), // A | B
  videoId: t.string(),
  createdAt: t.timestamp(),
});

// One row per campaign that follows the app flow: concepts -> testing (Lab) -> approved -> shipped (posted to X).
const campaignFlow = table({ name: 'campaign_flow', public: true }, {
  campaignId: t.string().primaryKey(), // creative campaign id, or `import-...` for imported drafts
  brand: t.string().index('btree'),
  source: t.string(), // generate | import
  stage: t.string(), // concepts | testing | approved | shipped
  draftA: t.string(), draftB: t.string(), // imported drafts (generated concepts live in ad_variant)
  experimentId: t.u64(), // 0 until tested in the Lab
  videoId: t.string(), winnerText: t.string(),
  requestedBy: t.identity().index('btree'),
  createdAt: t.timestamp(), updatedAt: t.timestamp(), shippedAt: t.option(t.timestamp()),
});

// Each draft (A/B) of a campaign gets its own video; edits make new versions and move the draft's link.
const campaignDraftVideo = table({ name: 'campaign_draft_video', public: true }, {
  linkId: t.string().primaryKey(), // `${campaignId}:${draft}`
  campaignId: t.string().index('btree'),
  draft: t.string(), // A | B
  videoId: t.string(),
  updatedAt: t.timestamp(),
});

const videoEdit = table({ name: 'video_edit', public: true }, {
  videoId: t.string().primaryKey(), // the new version (a campaign_video row)
  parentId: t.string(),
  instruction: t.string(),
  beatsJson: t.string(), // [{on_screen, voiceover}] edited by the user ('' = unchanged)
  createdAt: t.timestamp(),
});

// Real engagement anchor per brand: medians of its own recent posts and the scale from twin counts to real counts
// (scale = real median / what the twins give the brand's typical post). Applied at the end of every cascade.
const brandBaseline = table({ name: 'brand_baseline', public: true }, {
  brandUserId: t.string().primaryKey(),
  posts: t.u32(), // how many recent posts the medians come from
  likes: t.f64(), reposts: t.f64(), replies: t.f64(), quotes: t.f64(), views: t.f64(), // real medians
  likeScale: t.f64(), repostScale: t.f64(), replyScale: t.f64(), quoteScale: t.f64(), viewScale: t.f64(),
  baselineRunId: t.string(), note: t.string(), updatedAt: t.timestamp(),
});

// A segment needs this many twins to brief (small but real; partly built audiences can still generate).
const MIN_SEGMENT_TWINS = 1; // any niche with someone in it can be briefed (small niches must never block generation)

// The actual tweet for each draft, written in the brand's voice from a concept headline + the company's recent facts.
const draftCopy = table({ name: 'draft_copy', public: true }, {
  copyId: t.string().primaryKey(), // `${campaignId}:${draft}`
  campaignId: t.string().index('btree'),
  draft: t.string(), // A | B
  headline: t.string(), // the concept it expands
  text: t.string(), // '' until written
  status: t.string().index('btree'), // queued | writing | done | failed
  error: str(),
  requestedBy: t.identity(),
  updatedAt: t.timestamp(),
});

// ---------- Ops (hidden /ops page) ----------
// Identities allowed to change simulation settings from the browser (added by the publisher).
const opsAdmin = table({ name: 'ops_admin', public: true }, {
  identity: t.identity().primaryKey(),
  note: t.string(),
  addedAt: t.timestamp(),
});

// One row ('global'). scaleMode: 'linear' = counts x (brand followers / people simulated);
// 'anchored' = brand_baseline scales (the brand's real median engagement). No row = anchored.
const simSettings = table({ name: 'sim_settings', public: true }, {
  key: t.string().primaryKey(),
  twinsPerBrand: t.u32(), // twins the onboarding builds
  followersScraped: t.u32(), // followers the onboarding scrapes
  simTwins: t.u32(), // at most this many twins per simulation (0 = all)
  scaleMode: t.string(),
  fillReplies: t.u32(), // extra Claude-written replies from real non-twin followers per run (0 = off)
  updatedAt: t.timestamp(),
});

// Expected range for one video's post: each trial's likes / reposts land inside it (max 0 = no override).
const videoExpectation = table({ name: 'video_expectation', public: true }, {
  videoId: t.string().primaryKey(),
  likeMin: t.u32(), likeMax: t.u32(),
  repostMin: t.u32(), repostMax: t.u32(),
  updatedAt: t.timestamp(),
});

// How a run's counts were projected onto the real audience (written by start_cascade).
const simProjection = table({ name: 'sim_projection', public: true }, {
  runId: t.string().primaryKey(),
  mode: t.string(), // linear | anchored | none
  audience: t.u64(), // the brand's real follower count
  simulated: t.u32(),
  factor: t.f64(), // linear multiplier (1 when anchored)
  videoId: t.string(), // '' unless a video expectation applied
});

// Ops switches: paused = workers stop and in-flight jobs fail; hidden = the app hides campaigns, Lab and audience maps.
const opsState = table({ name: 'ops_state', public: true }, {
  key: t.string().primaryKey(),
  paused: t.bool(),
  hidden: t.bool(),
  updatedAt: t.timestamp(),
});

// Hide = a clean slate from this moment: the app drops campaigns, experiments and brand audiences created before `since`
// (anything created after it shows normally). The row exists only while hidden.
const opsHidden = table({ name: 'ops_hidden', public: true }, {
  key: t.string().primaryKey(),
  since: t.timestamp(),
});

// Campaign video settings from /ops: max film length (the script, voiceover and cut follow it) and the ElevenLabs voice.
const videoSettings = table({ name: 'video_settings', public: true }, {
  key: t.string().primaryKey(),
  maxSeconds: t.u32(),
  voiceId: t.string(),
  updatedAt: t.timestamp(),
});

// Campaign video mode from /ops: generate (default), off (no videos), or reuse existing videos for every new draft
// (reuseA for draft A, reuseB for draft B; an empty reuseB reuses A's video for both) - for demoing one product.
const videoMode = table({ name: 'video_mode', public: true }, {
  key: t.string().primaryKey(),
  mode: t.string(),
  reuseA: t.string(),
  reuseB: t.string(),
  updatedAt: t.timestamp(),
});

// "Build N more twins for @brand" requests from /ops; the onboarding worker serves them.
const twinTopup = table({ name: 'twin_topup', public: true }, {
  topupId: t.u64().primaryKey().autoInc(),
  brand: t.string(),
  count: t.u32(),
  status: t.string().index('btree'), // queued | running | done | failed
  error: str(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

const spacetimedb = schema({
  audienceSnapshot,
  archivedProfile,
  admin,
  xUser,
  audienceMembership,
  xPost,
  xPostReference,
  xPostEntity,
  xContextAnnotation,
  xPostMedia,
  xIngestionRun,
  twin,
  twinBuildRun,
  twinBuildJob,
  twinQuestion,
  twinAudience,
  niche,
  twinNiche,
  audienceEdge,
  simRun,
  simProb,
  simNode,
  cascadeReplay,
  simSignalProb,
  simSignal,
  simNodeSignal,
  simEvent,
  simCalibration,
  labExperiment,
  backtestResult,
  simSignalSource,
  simOutsideTick,
  simComment,
  onboarding,
  brandKit,
  campaign,
  creativeBrief,
  adVariant,
  creativeJob,
  campaignVideo,
  labDraftMedia,
  campaignFlow,
  campaignDraftVideo,
  videoEdit,
  brandBaseline,
  draftCopy,
  opsAdmin,
  simSettings,
  videoExpectation,
  simProjection,
  twinTopup,
  opsState,
  opsHidden,
  videoSettings,
  videoMode,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
// Reducer args mark option fields as `?:`; table rows want them present (possibly undefined).
type Row<K extends keyof Ctx['db']> = Ctx['db'][K] extends { insert(row: infer R): unknown } ? R : never;

// Tables are public to read; only the publisher (and identities it adds) can write.
function requireAdmin(ctx: Ctx) {
  if (!ctx.db.admin.identity.find(ctx.sender)) throw new SenderError('not authorized');
}

export const archiveAudience = spacetimedb.reducer({ snapshotId: t.string(), brand: t.string(), brandUserId: t.string(),
  title: t.string(), sourceRunId: t.string(), people: t.u32(), niches: t.u32(), payload: t.string(), createdAt: t.u64() }, (ctx, a) => {
  requireAdmin(ctx);
  if (a.payload.length > 20_000_000) throw new SenderError('audience snapshot is too large');
  const data = JSON.parse(a.payload);
  if (data.brand?.userId !== a.brandUserId || data.members?.length !== a.people) throw new SenderError('invalid audience snapshot');
  if (!ctx.db.audienceSnapshot.snapshotId.find(a.snapshotId)) ctx.db.audienceSnapshot.insert({ ...a, archivedAt: ctx.timestamp });
});

export const archiveProfiles = spacetimedb.reducer({}, ctx => {
  requireAdmin(ctx);
  for (const u of ctx.db.xUser.iter()) {
    const row = { userId: u.userId, username: u.username, name: u.name, profileImageUrl: u.profileImageUrl ?? '', verified: u.verified ?? false };
    if (!ctx.db.archivedProfile.userId.find(u.userId)) ctx.db.archivedProfile.insert(row);
  }
});

// One atomic reset, guarded against dropping unarchived data or active worker inputs.
export const resetImportedAudiences = spacetimedb.reducer({}, ctx => {
  requireAdmin(ctx);
  if ([...ctx.db.labExperiment.iter()].some(r => ['queued', 'running'].includes(r.status))
    || [...ctx.db.onboarding.iter()].some(r => !['ready', 'failed'].includes(r.status))
    || [...ctx.db.twinBuildRun.iter()].some(r => ['pending', 'running'].includes(r.status))
    || [...ctx.db.xIngestionRun.iter()].some(r => ['pending', 'running'].includes(r.status))) {
    throw new SenderError('wait for active audience builds and Lab experiments to finish before resetting imports');
  }
  const brands = new Set([...ctx.db.twinAudience.iter(), ...ctx.db.audienceMembership.iter()].map(r => r.brandUserId));
  const archived = new Set([...ctx.db.audienceSnapshot.iter()].map(r => r.brandUserId));
  if ([...brands].some(id => !archived.has(id))) throw new SenderError('archive every audience before resetting imports');
  if ([...ctx.db.xUser.iter()].some(u => !ctx.db.archivedProfile.userId.find(u.userId))) throw new SenderError('archive profiles before resetting imports');
  // Restart the X brands that Scweet was already scraping, keeping their campaign briefs.
  const refresh = new Map<string, Row<'onboarding'>>();
  for (const r of ctx.db.onboarding.iter()) {
    if (!brands.has(r.brandUserId) || !/^[a-z0-9_]{1,15}$/.test(r.handle)) continue;
    const previous = refresh.get(r.handle);
    if (!previous || previous.onboardingId < r.onboardingId) refresh.set(r.handle, r);
  }
  for (const r of [...ctx.db.audienceMembership.iter()]) ctx.db.audienceMembership.membershipId.delete(r.membershipId);
  for (const r of [...ctx.db.twinAudience.iter()]) ctx.db.twinAudience.twinAudienceId.delete(r.twinAudienceId);
  for (const r of [...ctx.db.twinNiche.iter()]) ctx.db.twinNiche.twinNicheId.delete(r.twinNicheId);
  for (const r of [...ctx.db.audienceEdge.iter()]) ctx.db.audienceEdge.edgeId.delete(r.edgeId);
  for (const r of [...ctx.db.twin.iter()]) ctx.db.twin.userId.delete(r.userId);
  for (const r of [...ctx.db.xPostReference.iter()]) ctx.db.xPostReference.id.delete(r.id);
  for (const r of [...ctx.db.xPostEntity.iter()]) ctx.db.xPostEntity.entityId.delete(r.entityId);
  for (const r of [...ctx.db.xContextAnnotation.iter()]) ctx.db.xContextAnnotation.annotationId.delete(r.annotationId);
  for (const r of [...ctx.db.xPostMedia.iter()]) ctx.db.xPostMedia.id.delete(r.id);
  for (const r of [...ctx.db.xPost.iter()]) ctx.db.xPost.postId.delete(r.postId);
  for (const r of [...ctx.db.xUser.iter()]) ctx.db.xUser.userId.delete(r.userId);
  for (const r of [...ctx.db.xIngestionRun.iter()]) ctx.db.xIngestionRun.ingestionRunId.delete(r.ingestionRunId);
  for (const r of [...ctx.db.backtestResult.iter()]) ctx.db.backtestResult.backtestResultId.delete(r.backtestResultId);
  for (const r of [...ctx.db.twinBuildJob.iter()]) ctx.db.twinBuildJob.jobId.delete(r.jobId);
  for (const r of [...ctx.db.twinBuildRun.iter()]) ctx.db.twinBuildRun.runId.delete(r.runId);
  for (const r of refresh.values()) ctx.db.onboarding.insert({ ...r, onboardingId: 0n, brandUserId: '', status: 'queued',
    ingestionRunId: '', twinRunId: '', error: undefined, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
});

const RUN_STATUSES = ['pending', 'running', 'completed', 'partial', 'failed'];

// Remove stale, archived twin links without disturbing Scweet's new live imports.
export const retireArchivedAudience = spacetimedb.reducer({ brand: t.string() }, (ctx, { brand }) => {
  requireAdmin(ctx);
  const user = [...ctx.db.xUser.iter()].find(r => r.username === brand);
  if (!user) throw new SenderError('unknown brand');
  if (![...ctx.db.audienceSnapshot.iter()].some(r => r.brandUserId === user.userId)) throw new SenderError('archive the audience first');
  if ([...ctx.db.audienceMembership.iter()].some(r => r.brandUserId === user.userId)
    || [...ctx.db.labExperiment.iter()].some(r => r.brand === brand && ['queued', 'running'].includes(r.status))) {
    throw new SenderError('cannot retire a live audience or active experiment');
  }
  const links = [...ctx.db.twinAudience.iter()].filter(r => r.brandUserId === user.userId);
  const ids = new Set([user.userId, ...links.map(r => r.userId)]);
  if ([...ids].some(id => !ctx.db.archivedProfile.userId.find(id))) throw new SenderError('archive every profile first');
  if ([...ctx.db.xPost.iter()].some(r => ids.has(r.authorUserId))) throw new SenderError('use the full archive and reset for audiences with source posts');
  for (const r of links) ctx.db.twinAudience.twinAudienceId.delete(r.twinAudienceId);
  for (const r of [...ctx.db.audienceEdge.iter()].filter(r => r.brandUserId === user.userId)) ctx.db.audienceEdge.edgeId.delete(r.edgeId);
  for (const id of ids) {
    if ([...ctx.db.twinAudience.iter()].some(r => r.userId === id)
      || [...ctx.db.audienceMembership.iter()].some(r => r.followerUserId === id || r.brandUserId === id)) continue;
    for (const r of [...ctx.db.twinNiche.iter()].filter(r => r.userId === id)) ctx.db.twinNiche.twinNicheId.delete(r.twinNicheId);
    ctx.db.twin.userId.delete(id);
    ctx.db.xUser.userId.delete(id);
  }
});

export const init = spacetimedb.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender });
});

export const addAdmin = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  requireAdmin(ctx);
  if (!ctx.db.admin.identity.find(identity)) ctx.db.admin.insert({ identity });
});

export const startIngestionRun = spacetimedb.reducer(
  { ingestionRunId: t.string(), targetUsername: t.string(), followersRequested: t.u32() },
  (ctx, { ingestionRunId, targetUsername, followersRequested }) => {
    requireAdmin(ctx);
    const existing = ctx.db.xIngestionRun.ingestionRunId.find(ingestionRunId);
    if (existing) {
      // Resuming: keep counters and checkpoint, just mark it running again.
      ctx.db.xIngestionRun.ingestionRunId.update({ ...existing, status: 'running', completedAt: undefined });
      return;
    }
    ctx.db.xIngestionRun.insert({
      ingestionRunId,
      targetUsername,
      targetUserId: undefined,
      startedAt: ctx.timestamp,
      completedAt: undefined,
      status: 'running',
      followersRequested,
      followersDiscovered: 0,
      followersProfilesSaved: 0,
      followersSkippedProtected: 0,
      followersFailed: 0,
      postsSaved: 0,
      lastProcessedUserId: undefined,
      errorSummary: undefined,
    });
  }
);

export const updateIngestionRun = spacetimedb.reducer(
  { ingestionRunId: t.string(), targetUserId: str(), ...runCounterFields },
  (ctx, { ingestionRunId, ...fields }) => {
    requireAdmin(ctx);
    const run = ctx.db.xIngestionRun.ingestionRunId.find(ingestionRunId);
    if (!run) throw new SenderError(`unknown ingestion run ${ingestionRunId}`);
    ctx.db.xIngestionRun.ingestionRunId.update({
      ...run,
      ...fields,
      targetUserId: fields.targetUserId ?? run.targetUserId,
    });
  }
);

export const completeIngestionRun = spacetimedb.reducer(
  { ingestionRunId: t.string(), status: t.string(), errorSummary: str() },
  (ctx, { ingestionRunId, status, errorSummary }) => {
    requireAdmin(ctx);
    if (!RUN_STATUSES.includes(status)) throw new SenderError(`invalid status ${status}`);
    const run = ctx.db.xIngestionRun.ingestionRunId.find(ingestionRunId);
    if (!run) throw new SenderError(`unknown ingestion run ${ingestionRunId}`);
    ctx.db.xIngestionRun.ingestionRunId.update({
      ...run,
      status,
      errorSummary: errorSummary ?? run.errorSummary,
      completedAt: ctx.timestamp,
    });
  }
);

export const upsertXUser = spacetimedb.reducer(xUserFields, (ctx, user) => {
  requireAdmin(ctx);
  const existing = ctx.db.xUser.userId.find(user.userId);
  if (existing) {
    ctx.db.xUser.userId.update({
      ...user, ingestedAt: existing.ingestedAt, updatedAt: ctx.timestamp, profileImage: existing.profileImage,
    } as Row<'xUser'>);
  } else {
    ctx.db.xUser.insert({ ...user, ingestedAt: ctx.timestamp, updatedAt: ctx.timestamp, profileImage: undefined } as Row<'xUser'>);
  }
});

export const setXUserProfileImage = spacetimedb.reducer(
  { userId: t.string(), profileImage: t.string() },
  (ctx, { userId, profileImage }) => {
    requireAdmin(ctx);
    const user = ctx.db.xUser.userId.find(userId);
    if (!user) throw new SenderError(`unknown user ${userId}`);
    ctx.db.xUser.userId.update({ ...user, profileImage });
  }
);

export const upsertAudienceMembership = spacetimedb.reducer(
  { brandUserId: t.string(), followerUserId: t.string(), ingestionRunId: t.string(), source: t.string() },
  (ctx, { brandUserId, followerUserId, ingestionRunId, source }) => {
    requireAdmin(ctx);
    const membershipId = `${brandUserId}:${followerUserId}`;
    // First discovery wins; reruns don't move discoveredAt.
    if (ctx.db.audienceMembership.membershipId.find(membershipId)) return;
    ctx.db.audienceMembership.insert({
      membershipId,
      brandUserId,
      followerUserId,
      discoveredAt: ctx.timestamp,
      ingestionRunId,
      source,
    });
  }
);

export const upsertXPost = spacetimedb.reducer(xPostFields, (ctx, post) => {
  requireAdmin(ctx);
  const existing = ctx.db.xPost.postId.find(post.postId);
  if (existing) {
    ctx.db.xPost.postId.update({ ...post, ingestedAt: existing.ingestedAt } as Row<'xPost'>);
  } else {
    ctx.db.xPost.insert({ ...post, ingestedAt: ctx.timestamp } as Row<'xPost'>);
  }
});

export const upsertPostReference = spacetimedb.reducer(postReferenceFields, (ctx, ref) => {
  requireAdmin(ctx);
  const id = `${ref.postId}:${ref.referenceType}:${ref.referencedPostId}`;
  if (!ctx.db.xPostReference.id.find(id)) ctx.db.xPostReference.insert({ id, ...ref });
});

export const upsertPostEntity = spacetimedb.reducer(postEntityFields, (ctx, entity) => {
  requireAdmin(ctx);
  const row = { entityId: `${entity.postId}:${entity.entityType}:${entity.startOffset}`, ...entity } as Row<'xPostEntity'>;
  if (ctx.db.xPostEntity.entityId.find(row.entityId)) ctx.db.xPostEntity.entityId.update(row);
  else ctx.db.xPostEntity.insert(row);
});

export const upsertContextAnnotation = spacetimedb.reducer(contextAnnotationFields, (ctx, ann) => {
  requireAdmin(ctx);
  const row = { annotationId: `${ann.postId}:${ann.domainId}:${ann.entityIdFromX}`, ...ann } as Row<'xContextAnnotation'>;
  if (ctx.db.xContextAnnotation.annotationId.find(row.annotationId)) {
    ctx.db.xContextAnnotation.annotationId.update(row);
  } else {
    ctx.db.xContextAnnotation.insert(row);
  }
});

export const upsertPostMedia = spacetimedb.reducer(postMediaFields, (ctx, media) => {
  requireAdmin(ctx);
  const row = { id: `${media.postId}:${media.mediaKey}`, ...media } as Row<'xPostMedia'>;
  if (ctx.db.xPostMedia.id.find(row.id)) ctx.db.xPostMedia.id.update(row);
  else ctx.db.xPostMedia.insert(row);
});

// ---------- Twins reducers ----------
const TWIN_JOB_STATUSES = ['queued', 'building', 'ready', 'failed', 'skipped'];
const TWIN_TERMINAL = ['ready', 'failed', 'skipped'];
const TWIN_RUN_END = ['completed', 'partial', 'failed'];
const TWIN_ACTIONS = ['reply', 'quote', 'repost', 'like', 'ignore'];
const MAX_DRAFT = 1000;
const MAX_QUESTION = 300;
const MAX_OPEN_PER_SENDER = 3; // pending + answering

function setTwinJob(ctx: Ctx, runId: string, userId: string, username: string, status: string, error: string | undefined) {
  if (!TWIN_JOB_STATUSES.includes(status)) throw new SenderError(`invalid twin job status ${status}`);
  const run = ctx.db.twinBuildRun.runId.find(runId);
  if (!run) throw new SenderError(`unknown twin build run ${runId}`);
  const jobId = `${runId}:${userId}`;
  const prev = ctx.db.twinBuildJob.jobId.find(jobId);
  if (prev && TWIN_TERMINAL.includes(prev.status)) {
    throw new SenderError(`twin job ${jobId} already finished as ${prev.status}`);
  }
  const row = { jobId, runId, userId, username, status, error, updatedAt: ctx.timestamp } as Row<'twinBuildJob'>;
  if (prev) ctx.db.twinBuildJob.jobId.update(row);
  else ctx.db.twinBuildJob.insert(row);
  // Finished jobs are final (checked above), so each job is counted exactly once.
  if (TWIN_TERMINAL.includes(status)) {
    ctx.db.twinBuildRun.runId.update({
      ...run,
      ready: run.ready + (status === 'ready' ? 1 : 0),
      failed: run.failed + (status === 'failed' ? 1 : 0),
      skipped: run.skipped + (status === 'skipped' ? 1 : 0),
    });
  }
}

export const startTwinBuildRun = spacetimedb.reducer(
  { runId: t.string(), brandUserId: t.string(), requested: t.u32() },
  (ctx, { runId, brandUserId, requested }) => {
    requireAdmin(ctx);
    const existing = ctx.db.twinBuildRun.runId.find(runId);
    if (existing) {
      // A retry after a lost HTTP reply is fine; reusing the id for a different build is not.
      if (existing.brandUserId === brandUserId && existing.requested === requested) return;
      throw new SenderError(`twin build run ${runId} already exists`);
    }
    ctx.db.twinBuildRun.insert({
      runId, brandUserId, status: 'running', requested, ready: 0, failed: 0, skipped: 0,
      startedAt: ctx.timestamp, completedAt: undefined,
    });
  }
);

export const setTwinJobStatus = spacetimedb.reducer(
  { runId: t.string(), userId: t.string(), username: t.string(), status: t.string(), error: str() },
  (ctx, { runId, userId, username, status, error }) => {
    requireAdmin(ctx);
    setTwinJob(ctx, runId, userId, username, status, error);
  }
);

export const publishTwin = spacetimedb.reducer({ runId: t.string(), ...twinFields }, (ctx, { runId, ...fields }) => {
  requireAdmin(ctx);
  if (fields.topics.some(tp => tp.affinity < 0 || tp.affinity > 1)) throw new SenderError('topic affinity must be 0..1');
  const unknown = fields.topics.find(tp => !ctx.db.niche.slug.find(tp.topic));
  if (unknown) throw new SenderError(`unknown niche ${unknown.topic}; upsert_niche it first`);
  if (fields.activeHoursUtc.some(h => h > 23)) throw new SenderError('active hour must be 0..23');
  const row = { ...fields, buildRunId: runId, updatedAt: ctx.timestamp } as Row<'twin'>;
  if (ctx.db.twin.userId.find(fields.userId)) ctx.db.twin.userId.update(row);
  else ctx.db.twin.insert(row);
  const link = {
    twinAudienceId: `${fields.brandUserId}:${fields.userId}`,
    brandUserId: fields.brandUserId,
    userId: fields.userId,
    lastBuildRunId: runId,
    updatedAt: ctx.timestamp,
  };
  if (ctx.db.twinAudience.twinAudienceId.find(link.twinAudienceId)) ctx.db.twinAudience.twinAudienceId.update(link);
  else ctx.db.twinAudience.insert(link);
  // Replace this person's niche rows with the new rating.
  for (const old of [...ctx.db.twinNiche.userId.filter(fields.userId)]) ctx.db.twinNiche.twinNicheId.delete(old.twinNicheId);
  for (const tp of fields.topics) {
    ctx.db.twinNiche.insert({ twinNicheId: `${fields.userId}:${tp.topic}`, userId: fields.userId, niche: tp.topic, affinity: tp.affinity });
  }
  setTwinJob(ctx, runId, fields.userId, fields.username, 'ready', undefined);
});

export const upsertNiche = spacetimedb.reducer(
  { slug: t.string(), label: t.string(), description: t.string() },
  (ctx, row) => {
    requireAdmin(ctx);
    if (ctx.db.niche.slug.find(row.slug)) ctx.db.niche.slug.update(row);
    else ctx.db.niche.insert(row);
  }
);

export const completeTwinBuildRun = spacetimedb.reducer(
  { runId: t.string(), status: t.string() },
  (ctx, { runId, status }) => {
    requireAdmin(ctx);
    if (!TWIN_RUN_END.includes(status)) throw new SenderError(`invalid run status ${status}`);
    const run = ctx.db.twinBuildRun.runId.find(runId);
    if (!run) throw new SenderError(`unknown twin build run ${runId}`);
    ctx.db.twinBuildRun.runId.update({ ...run, status, completedAt: ctx.timestamp });
  }
);

export const askTwin = spacetimedb.reducer(
  { userId: t.string(), draft: t.string(), question: t.string() },
  (ctx, { userId, draft, question }) => {
    if (!ctx.db.twin.userId.find(userId)) throw new SenderError('no twin for that user');
    if (draft.trim().length === 0 || draft.length > MAX_DRAFT) throw new SenderError(`draft must be 1..${MAX_DRAFT} chars`);
    if (question.length > MAX_QUESTION) throw new SenderError(`question must be at most ${MAX_QUESTION} chars`);
    const open = [...ctx.db.twinQuestion.status.filter('pending'), ...ctx.db.twinQuestion.status.filter('answering')];
    if (open.filter(q => q.askedBy.equals(ctx.sender)).length >= MAX_OPEN_PER_SENDER) {
      throw new SenderError('too many open questions');
    }
    ctx.db.twinQuestion.insert({
      questionId: 0n, userId, draft, question, askedBy: ctx.sender, status: 'pending',
      action: undefined, confidence: undefined, answer: undefined, citedPostIds: [], error: undefined,
      createdAt: ctx.timestamp, answeredAt: undefined,
    } as Row<'twinQuestion'>);
  }
);

function questionIn(ctx: Ctx, questionId: bigint, status: string) {
  const q = ctx.db.twinQuestion.questionId.find(questionId);
  if (!q) throw new SenderError(`unknown question ${questionId}`);
  if (q.status !== status) throw new SenderError(status === 'pending' ? 'already claimed' : `question is ${q.status}`);
  return q;
}

export const claimTwinQuestion = spacetimedb.reducer({ questionId: t.u64() }, (ctx, { questionId }) => {
  requireAdmin(ctx);
  const q = questionIn(ctx, questionId, 'pending');
  ctx.db.twinQuestion.questionId.update({ ...q, status: 'answering' });
});

export const answerTwinQuestion = spacetimedb.reducer(
  { questionId: t.u64(), action: t.string(), confidence: t.f64(), answer: t.string(), citedPostIds: t.array(t.string()) },
  (ctx, { questionId, action, confidence, answer, citedPostIds }) => {
    requireAdmin(ctx);
    if (!TWIN_ACTIONS.includes(action)) throw new SenderError(`invalid action ${action}`);
    if (confidence < 0 || confidence > 1) throw new SenderError('confidence must be 0..1');
    const q = questionIn(ctx, questionId, 'answering');
    ctx.db.twinQuestion.questionId.update({
      ...q, status: 'answered', action, confidence, answer, citedPostIds, answeredAt: ctx.timestamp,
    });
  }
);

export const failTwinQuestion = spacetimedb.reducer(
  { questionId: t.u64(), error: t.string() },
  (ctx, { questionId, error }) => {
    requireAdmin(ctx);
    const q = questionIn(ctx, questionId, 'answering');
    ctx.db.twinQuestion.questionId.update({ ...q, status: 'failed', error, answeredAt: ctx.timestamp });
  }
);

// ---------- Simulation reducers ----------
const FEED_REACH = 0.35; // chance a follower sees the brand's post in their feed
const SHARE_REACH = 0.6; // chance a neighbour sees it after someone they follow engages
const REPLAY_STEP_MICROS = 700_000n;
const MAX_TRIALS = 1000;
const MAX_DRAFT_SIM = 2000;

type Rng = () => number;

const SIGNALS = ['like', 'repost', 'reply', 'quote'] as const;
type Signal = (typeof SIGNALS)[number];
type SignalP = Record<Signal, number>;

// Everyone in the audience sees the post. Each person draws each signal independently (Claude's probabilities).
// A follower's repost/quote (a) gives their audience neighbours who haven't acted another chance (social proof) and
// (b) reaches their own followers outside the audience: REPOST_VIEW_RATE of them see it and act at OUT_OF_NETWORK x the
// audience's average rate; outside reposts compound generation by generation until nobody new reposts.
// Add `extra` outside engagement for one signal to the replay ticks, in proportion to each tick's views, so the live
// counters climb to the anchored total instead of jumping at the end.
function spreadExtra(ticks: OutsideTick[], s: Signal | 'view', extra: number, lastTick: number) {
  if (extra <= 0) return;
  if (!ticks.length) ticks.push({ tick: Math.max(1, lastTick), views: 0, counts: { like: 0, repost: 0, reply: 0, quote: 0 } });
  const weights = ticks.map(t => t.views + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  let left = extra;
  ticks.forEach((t, i) => {
    const add = i === ticks.length - 1 ? left : Math.min(left, Math.round(extra * weights[i] / sum));
    left -= add;
    if (s === 'view') t.views += add; else t.counts[s] += add;
  });
}

const REPOST_VIEW_RATE = 0.1;
const OUT_OF_NETWORK = 0.5;
const MAX_GENERATIONS = 20;

type TrialEvent = { userId: string; signal: Signal; tick: number };
type OutsideTick = { tick: number; views: number; counts: SignalP };
type Audience = { ids: string[]; p: Map<string, SignalP>; adj: Map<string, string[]>; followers: Map<string, number>;
                  medianFollowers: number; pOut: SignalP };

// Binomial draw: exact for small n, Poisson for rare events, normal approximation otherwise.
function binom(rand: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 60) { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k += 1; return k; }
  const mean = n * p;
  if (mean < 30) {
    const limit = Math.exp(-mean); let k = 0, prod = rand();
    while (prod > limit) { k += 1; prod *= rand(); }
    return Math.min(n, k);
  }
  const u = Math.max(rand(), 1e-12), v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.min(n, Math.round(mean + z * Math.sqrt(mean * (1 - p)))));
}

function signalTrial(rand: Rng, a: Audience, record?: { seen: Map<string, number>; events: TrialEvent[]; outside: OutsideTick[] }) {
  const acted = new Map<string, Set<Signal>>();
  const followerCounts: SignalP = { like: 0, repost: 0, reply: 0, quote: 0 };
  const outsideCounts: SignalP = { like: 0, repost: 0, reply: 0, quote: 0 };
  let outsideViews = 0;
  let tick = 0;
  const act = (id: string, next: string[]) => {
    const pr = a.p.get(id);
    if (!pr || acted.has(id)) return;
    let spreads = false;
    const mine = new Set<Signal>();
    for (const s of SIGNALS) {
      if (rand() >= pr[s]) continue;
      mine.add(s); followerCounts[s] += 1;
      record?.events.push({ userId: id, signal: s, tick });
      if (s === 'repost' || s === 'quote') spreads = true;
    }
    if (mine.size) acted.set(id, mine);
    if (spreads) next.push(id);
  };
  let frontier: string[] = [];
  for (const id of a.ids) { record?.seen.set(id, 0); act(id, frontier); }
  let outsideSpreaders = 0;
  while ((frontier.length || outsideSpreaders) && tick < MAX_GENERATIONS) {
    tick += 1;
    const next: string[] = [];
    let reach = 0;
    for (const u of frontier) {
      for (const v of a.adj.get(u) ?? []) act(v, next);          // second chance inside the audience
      reach += a.followers.get(u) ?? a.medianFollowers;          // the reposter's own followers
    }
    reach += outsideSpreaders * a.medianFollowers;
    const views = binom(rand, reach, REPOST_VIEW_RATE);
    const counts: SignalP = { like: 0, repost: 0, reply: 0, quote: 0 };
    for (const s of SIGNALS) counts[s] = binom(rand, views, a.pOut[s]);
    for (const s of SIGNALS) outsideCounts[s] += counts[s];
    outsideViews += views;
    outsideSpreaders = counts.repost + counts.quote;
    if (record && (views || counts.like || counts.repost || counts.reply || counts.quote)) record.outside.push({ tick, views, counts });
    frontier = next;
  }
  return { acted, followerCounts, outsideCounts, outsideViews, lastTick: tick };
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];
}

function scheduleReplay(ctx: Ctx, runId: string) {
  ctx.db.cascadeReplay.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + REPLAY_STEP_MICROS),
    runId,
  });
}

export const replaceAudienceEdges = spacetimedb.reducer(
  { brandUserId: t.string(), edges: t.array(EdgeInput) },
  (ctx, { brandUserId, edges }) => {
    requireAdmin(ctx);
    for (const old of [...ctx.db.audienceEdge.brandUserId.filter(brandUserId)]) ctx.db.audienceEdge.edgeId.delete(old.edgeId);
    for (const e of edges) {
      const edgeId = `${brandUserId}:${e.a}:${e.b}`;
      if (e.a === e.b || ctx.db.audienceEdge.edgeId.find(edgeId)) continue;
      ctx.db.audienceEdge.insert({ edgeId, brandUserId, a: e.a, b: e.b, kind: e.kind });
    }
  }
);

export const createSimRun = spacetimedb.reducer(
  { runId: t.string(), brandUserId: t.string(), draft: t.string(), people: t.u32() },
  (ctx, { runId, brandUserId, draft, people }) => {
    requireAdmin(ctx);
    notPaused(ctx);
    if (ctx.db.simRun.runId.find(runId)) throw new SenderError(`sim run ${runId} already exists`);
    if (!draft.trim() || draft.length > MAX_DRAFT_SIM) throw new SenderError(`draft must be 1..${MAX_DRAFT_SIM} chars`);
    ctx.db.simRun.insert({
      runId, brandUserId, draft, status: 'scoring', people, trials: 0,
      reachP10: 0, reachP50: 0, reachP90: 0, seenP50: 0, replayTick: 0, replayMaxTick: 0,
      error: undefined, createdAt: ctx.timestamp, completedAt: undefined,
    } as Row<'simRun'>);
  }
);

export const setSimProbs = spacetimedb.reducer(
  { runId: t.string(), probs: t.array(SimProbInput) },
  (ctx, { runId, probs }) => {
    requireAdmin(ctx);
    const run = ctx.db.simRun.runId.find(runId);
    if (!run) throw new SenderError(`unknown sim run ${runId}`);
    if (run.status !== 'scoring') throw new SenderError(`sim run ${runId} is ${run.status}`);
    for (const pr of probs) {
      if (!(pr.pEngage >= 0 && pr.pEngage <= 1)) throw new SenderError(`p_engage must be 0..1 for ${pr.userId}`);
      const row = { simProbId: `${runId}:${pr.userId}`, runId, userId: pr.userId, pEngage: pr.pEngage, action: pr.action, reason: pr.reason };
      if (ctx.db.simProb.simProbId.find(row.simProbId)) ctx.db.simProb.simProbId.update(row);
      else ctx.db.simProb.insert(row);
    }
  }
);

type Range = { min: number; max: number } | null;
type Floors = { likeRate: number; ratio: Record<Signal, number> };
type Projection = { scale: Record<Signal | 'view', number>; expected: Record<Signal, Range>; seeRate: number; viewsPerEngagement: number;
                    floors: Floors | null };
// Linear floors: a real post never gets 0 replies or reposts at scale. Likes are a share of views (the brand's real
// likes/views, else DEFAULT_LIKE_RATE); replies / reposts / quotes follow likes at the brand's real ratios (else these),
// all weighted by how strongly the twins responded to this draft, with per-trial noise.
const DEFAULT_LIKE_RATE = 0.01;
const DEFAULT_RATIO: Record<Signal, number> = { like: 1, reply: 0.1, repost: 0.08, quote: 0.03 };
const TYPICAL_P: Record<Signal, number> = { like: 0.08, repost: 0.02, reply: 0.02, quote: 0.005 };
const QUALITY_MIN = 0.4, QUALITY_MAX = 2.5;

function draftQuality(p: Map<string, SignalP>): Record<Signal, number> {
  const out = { like: 1, repost: 1, reply: 1, quote: 1 };
  if (!p.size) return out;
  for (const s of SIGNALS) {
    const mean = [...p.values()].reduce((a, x) => a + x[s], 0) / p.size;
    out[s] = Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, mean / TYPICAL_P[s]));
  }
  return out;
}

function engagementFloors(rand: Rng, views: number, f: Floors, q: Record<Signal, number>): Record<Signal, number> {
  const noise = () => 0.6 + 0.8 * rand();
  const likes = Math.max(1, Math.round(views * f.likeRate * q.like * noise()));
  return {
    like: likes,
    reply: Math.max(1, Math.round(likes * f.ratio.reply * (q.reply / q.like) * noise())),
    repost: Math.max(1, Math.round(likes * f.ratio.repost * (q.repost / q.like) * noise())),
    quote: Math.round(likes * f.ratio.quote * (q.quote / q.like) * noise()),
  };
}
// Linear views: a follower sees the post at the brand's real reach rate (median views / followers, else DEFAULT_SEE_RATE),
// and every engagement pushes the post to a few more timelines (X ranks engaged posts higher).
const DEFAULT_SEE_RATE = 0.3;
const VIEWS_PER_ENGAGEMENT = 10;

// Linear: counts x (brand followers / people simulated). Anchored: the brand's real median engagement (brand_baseline).
// A video attached to this run's Lab draft may pin its likes / reposts to an expected range.
function projectionFor(ctx: Ctx, run: Row<'simRun'>, runId: string, simulated: number): Projection {
  const settings = ctx.db.simSettings.key.find('global');
  const audienceSize = Number(ctx.db.xUser.userId.find(run.brandUserId)?.followersCount ?? 0);
  const base = ctx.db.brandBaseline.brandUserId.find(run.brandUserId);
  const ones = { like: 1, repost: 1, reply: 1, quote: 1, view: 1 };
  let mode = 'none', factor = 1, scale: Record<Signal | 'view', number> = ones;
  if (settings?.scaleMode === 'linear' && audienceSize > 0 && simulated > 0) {
    mode = 'linear'; factor = Math.max(1, audienceSize / simulated);
    scale = { like: factor, repost: factor, reply: factor, quote: factor, view: factor };
  } else if (base) {
    mode = 'anchored';
    scale = { like: base.likeScale, repost: base.repostScale, reply: base.replyScale, quote: base.quoteScale, view: base.viewScale };
  }
  const expected: Record<Signal, Range> = { like: null, repost: null, reply: null, quote: null };
  let videoId = '';
  for (const exp of ctx.db.labExperiment.iter()) {
    const draft = exp.runA === runId ? 'A' : exp.runB === runId ? 'B' : '';
    if (!draft) continue;
    const media = ctx.db.labDraftMedia.mediaId.find(`${exp.experimentId}:${draft}`);
    const want = media ? ctx.db.videoExpectation.videoId.find(media.videoId) : undefined;
    if (want) {
      videoId = want.videoId;
      if (want.likeMax > 0) expected.like = { min: want.likeMin, max: want.likeMax };
      if (want.repostMax > 0) expected.repost = { min: want.repostMin, max: want.repostMax };
    }
    break;
  }
  const row = { runId, mode, audience: BigInt(audienceSize), simulated, factor, videoId };
  if (ctx.db.simProjection.runId.find(runId)) ctx.db.simProjection.runId.update(row); else ctx.db.simProjection.insert(row);
  const linear = mode === 'linear';
  const seeRate = !linear ? 1 : Math.min(0.9, Math.max(0.05, base && audienceSize ? base.views / audienceSize : DEFAULT_SEE_RATE));
  const ratio = (median: number) => base && base.likes > 0 ? median / base.likes : 0;
  const floors: Floors | null = !linear ? null : {
    likeRate: base && base.views > 0 && base.likes > 0 ? base.likes / base.views : DEFAULT_LIKE_RATE,
    ratio: base && base.likes > 0
      ? { like: 1, reply: ratio(base.replies) || DEFAULT_RATIO.reply, repost: ratio(base.reposts) || DEFAULT_RATIO.repost,
          quote: ratio(base.quotes) || DEFAULT_RATIO.quote }
      : DEFAULT_RATIO,
  };
  return { scale, expected, seeRate, viewsPerEngagement: linear ? VIEWS_PER_ENGAGEMENT : 0, floors };
}

// A count outside the expected range is redrawn uniformly inside it, so trials keep a realistic spread.
function withinExpected(rand: Rng, value: number, range: Range): number {
  if (!range || (value >= range.min && value <= range.max)) return value;
  return range.min + Math.floor(rand() * (range.max - range.min + 1));
}

export const startCascade = spacetimedb.reducer(
  { runId: t.string(), trials: t.u32() },
  (ctx, { runId, trials }) => {
    requireAdmin(ctx);
    notPaused(ctx);
    const run = ctx.db.simRun.runId.find(runId);
    if (!run) throw new SenderError(`unknown sim run ${runId}`);
    if (run.status !== 'scoring') throw new SenderError(`sim run ${runId} already ${run.status}`);
    const probs = [...ctx.db.simProb.runId.filter(runId)];
    if (!probs.length) throw new SenderError('set_sim_probs before start_cascade');
    const n = Math.max(1, Math.min(MAX_TRIALS, trials));
    const ids = probs.map(pr => pr.userId);
    const inRun = new Set(ids);
    const adj = new Map<string, string[]>();
    const link = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
    for (const e of ctx.db.audienceEdge.brandUserId.filter(run.brandUserId)) {
      if (!inRun.has(e.a) || !inRun.has(e.b)) continue;
      link(e.a, e.b); link(e.b, e.a);
    }
    // Per-signal probabilities when the policy sent them; otherwise the legacy single p_engage acts like a repost.
    const p = new Map<string, SignalP>();
    for (const pr of probs) {
      const sp = ctx.db.simSignalProb.simSignalProbId.find(`${runId}:${pr.userId}`);
      p.set(pr.userId, sp ? { like: sp.pLike, repost: sp.pRepost, reply: sp.pReply, quote: sp.pQuote }
                          : { like: 0, repost: pr.pEngage, reply: 0, quote: 0 });
    }
    const followers = new Map<string, number>();
    for (const id of ids) {
      const fc = ctx.db.xUser.userId.find(id)?.followersCount;
      if (fc !== undefined && fc !== null) followers.set(id, Number(fc));
    }
    const known = [...followers.values()].sort((x, y) => x - y);
    const medianFollowers = known.length ? known[Math.floor(known.length / 2)] : 0;
    const pOut: SignalP = { like: 0, repost: 0, reply: 0, quote: 0 };
    for (const pr of p.values()) for (const s of SIGNALS) pOut[s] += pr[s] / p.size;
    for (const s of SIGNALS) pOut[s] = Math.min(1, pOut[s] * OUT_OF_NETWORK);
    const audience: Audience = { ids, p, adj, followers, medianFollowers, pOut };

    const rand: Rng = () => ctx.random();
    const engagedCount = new Map<string, number>();
    const signalCount = new Map<string, SignalP>();
    const reach: number[] = [], seenTotals: number[] = [];
    const total: Record<Signal | 'view', number[]> = { like: [], repost: [], reply: [], quote: [], view: [] };
    const sums = { followers: { like: 0, repost: 0, reply: 0, quote: 0, view: 0 }, outside: { like: 0, repost: 0, reply: 0, quote: 0, view: 0 } };
    const replay = { seen: new Map<string, number>(), events: [] as TrialEvent[], outside: [] as OutsideTick[] };
    let replayMaxTick = 0;
    // The twins are a sample of the audience: project each trial onto the real audience (see projectionFor).
    const proj = projectionFor(ctx, run, runId, ids.length);
    // How strongly the twins responded to this draft, per signal, relative to a typical post (drives the floors).
    const quality = draftQuality(p);
    const scale = proj.scale;
    for (let trial = 0; trial < n; trial++) {
      const r = signalTrial(rand, audience, trial === 0 ? replay : undefined);
      // Views first: the engagement floors below are a share of the people who actually saw the post.
      // Anchored: the brand's view scale already encodes reach. Linear: this trial's reach varies around the brand's rate
      // (continuous, so a small sample of twins does not snap every draft onto the same few view counts).
      const seen = proj.seeRate < 1 ? Math.round(ids.length * Math.min(1, proj.seeRate * (0.6 + 0.8 * rand())) * 100) / 100 : ids.length;
      const engagedHere = SIGNALS.reduce((a, s) => a + r.followerCounts[s] + r.outsideCounts[s], 0);
      const viewTarget = Math.round((seen + r.outsideViews + proj.viewsPerEngagement * engagedHere) * scale.view);
      const floor = proj.floors ? engagementFloors(rand, viewTarget, proj.floors, quality) : null;
      let outsideEngaged = 0;
      for (const s of SIGNALS) {
        const projected = Math.round((r.followerCounts[s] + r.outsideCounts[s]) * scale[s]);
        const target = withinExpected(rand, floor ? Math.max(projected, floor[s]) : projected, proj.expected[s]);
        const outside = Math.max(0, target - r.followerCounts[s]); // the unsampled audience shows up as outside reach
        total[s].push(r.followerCounts[s] + outside);
        sums.followers[s] += r.followerCounts[s]; sums.outside[s] += outside;
        outsideEngaged += outside;
        if (trial === 0) spreadExtra(replay.outside, s, outside - r.outsideCounts[s], r.lastTick);
      }
      const seenWhole = Math.round(seen);
      const outsideViews = Math.max(0, viewTarget - seenWhole);
      if (trial === 0) spreadExtra(replay.outside, 'view', outsideViews - r.outsideViews, r.lastTick);
      total.view.push(seenWhole + outsideViews);
      sums.followers.view += seenWhole; sums.outside.view += outsideViews;
      reach.push(r.acted.size + outsideEngaged); seenTotals.push(ids.length + r.outsideViews);
      for (const [id, acts] of r.acted) {
        engagedCount.set(id, (engagedCount.get(id) ?? 0) + 1);
        const c = signalCount.get(id) ?? { like: 0, repost: 0, reply: 0, quote: 0 };
        for (const s of acts) c[s] += 1;
        signalCount.set(id, c);
      }
      if (trial === 0) replayMaxTick = r.lastTick;
    }
    reach.sort((x, y) => x - y); seenTotals.sort((x, y) => x - y);
    const firstAct = new Map<string, number>();
    for (const e of replay.events) if (!firstAct.has(e.userId)) firstAct.set(e.userId, e.tick);
    for (const id of ids) {
      const c = signalCount.get(id) ?? { like: 0, repost: 0, reply: 0, quote: 0 };
      ctx.db.simNode.insert({
        simNodeId: `${runId}:${id}`, runId, userId: id,
        engagedShare: (engagedCount.get(id) ?? 0) / n, seenShare: 1,
        replaySeenTick: 0, replayEngagedTick: firstAct.get(id),
      } as Row<'simNode'>);
      ctx.db.simNodeSignal.insert({
        simNodeSignalId: `${runId}:${id}`, runId, userId: id,
        likeShare: c.like / n, repostShare: c.repost / n, replyShare: c.reply / n, quoteShare: c.quote / n,
      });
    }
    for (const s of [...SIGNALS, 'view'] as const) {
      const xs = total[s].sort((x, y) => x - y);
      ctx.db.simSignal.insert({
        simSignalId: `${runId}:${s}`, runId, signal: s,
        p10: percentile(xs, 0.1), p50: percentile(xs, 0.5), p90: percentile(xs, 0.9),
        mean: xs.reduce((x, y) => x + y, 0) / n,
      });
      for (const source of ['followers', 'outside'] as const) {
        ctx.db.simSignalSource.insert({ simSignalSourceId: `${runId}:${s}:${source}`, runId, signal: s, source, mean: sums[source][s] / n });
      }
    }
    for (const e of replay.events) {
      ctx.db.simEvent.insert({ simEventId: `${runId}:${e.userId}:${e.signal}`, runId, userId: e.userId, signal: e.signal, tick: e.tick });
    }
    for (const o of replay.outside) {
      ctx.db.simOutsideTick.insert({ simOutsideTickId: `${runId}:${o.tick}`, runId, tick: o.tick, views: o.views,
        likes: o.counts.like, reposts: o.counts.repost, replies: o.counts.reply, quotes: o.counts.quote });
    }
    ctx.db.simRun.runId.update({
      ...run, status: 'replaying', trials: n,
      reachP10: percentile(reach, 0.1), reachP50: percentile(reach, 0.5), reachP90: percentile(reach, 0.9),
      seenP50: percentile(seenTotals, 0.5), replayTick: 0, replayMaxTick,
    });
    scheduleReplay(ctx, runId);
  }
);

export const cascadeTick = spacetimedb.reducer(
  { onSchedule: cascadeReplay },
  { timer: cascadeReplay.rowType },
  (ctx, { timer }) => {
    const run = ctx.db.simRun.runId.find(timer.runId);
    if (!run || run.status !== 'replaying') return;
    if (run.replayTick >= run.replayMaxTick) {
      ctx.db.simRun.runId.update({ ...run, status: 'done', completedAt: ctx.timestamp });
      return;
    }
    ctx.db.simRun.runId.update({ ...run, replayTick: run.replayTick + 1 });
    scheduleReplay(ctx, run.runId);
  }
);

export const failSimRun = spacetimedb.reducer(
  { runId: t.string(), error: t.string() },
  (ctx, { runId, error }) => {
    requireAdmin(ctx);
    const run = ctx.db.simRun.runId.find(runId);
    if (!run) throw new SenderError(`unknown sim run ${runId}`);
    ctx.db.simRun.runId.update({ ...run, status: 'failed', error: error.slice(0, 300), completedAt: ctx.timestamp });
  }
);

// ---------- Lab reducers ----------
const MAX_LAB_DRAFT = 1000;
const MAX_LAB_TITLE = 80;
const MAX_OPEN_LABS_PER_SENDER = 2;
const MAX_SCALE = 10;

export const setSimSignalProbs = spacetimedb.reducer(
  { runId: t.string(), probs: t.array(SignalProbInput) },
  (ctx, { runId, probs }) => {
    requireAdmin(ctx);
    const run = ctx.db.simRun.runId.find(runId);
    if (!run) throw new SenderError(`unknown sim run ${runId}`);
    if (run.status !== 'scoring') throw new SenderError(`sim run ${runId} is ${run.status}`);
    for (const pr of probs) {
      for (const v of [pr.pLike, pr.pRepost, pr.pReply, pr.pQuote]) {
        if (!(v >= 0 && v <= 1)) throw new SenderError(`signal probabilities must be 0..1 for ${pr.userId}`);
      }
      const row = { simSignalProbId: `${runId}:${pr.userId}`, runId, userId: pr.userId,
                    pLike: pr.pLike, pRepost: pr.pRepost, pReply: pr.pReply, pQuote: pr.pQuote };
      if (ctx.db.simSignalProb.simSignalProbId.find(row.simSignalProbId)) ctx.db.simSignalProb.simSignalProbId.update(row);
      else ctx.db.simSignalProb.insert(row);
    }
  }
);

export const setSimCalibration = spacetimedb.reducer(
  { scope: t.string(), feedReach: t.f64(), shareReach: t.f64(), likeScale: t.f64(), repostScale: t.f64(),
    replyScale: t.f64(), quoteScale: t.f64(), source: t.string(), note: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    for (const v of [a.feedReach, a.shareReach]) if (!(v > 0 && v <= 1)) throw new SenderError('reach must be in (0, 1]');
    for (const v of [a.likeScale, a.repostScale, a.replyScale, a.quoteScale]) {
      if (!(v >= 0 && v <= MAX_SCALE)) throw new SenderError(`scales must be in [0, ${MAX_SCALE}]`);
    }
    const row = { ...a, note: a.note.slice(0, 300), updatedAt: ctx.timestamp };
    if (ctx.db.simCalibration.scope.find(a.scope)) ctx.db.simCalibration.scope.update(row);
    else ctx.db.simCalibration.insert(row);
  }
);

export const requestLabExperiment = spacetimedb.reducer(
  { brand: t.string(), title: t.string(), draftA: t.string(), draftB: t.string() },
  (ctx, { brand, title, draftA, draftB }) => {
    const handle = brand.trim().replace(/^@/, '').toLowerCase();
    const brandUser = [...ctx.db.xUser.username.filter(handle)][0]
      ?? [...ctx.db.xUser.iter()].find(u => u.username.toLowerCase() === handle);
    if (!brandUser) throw new SenderError(`unknown brand @${handle}`);
    if (![...ctx.db.twinAudience.iter()].some(l => l.brandUserId === brandUser.userId)) {
      throw new SenderError(`@${handle} has no twins yet`);
    }
    for (const d of [draftA, draftB]) {
      if (!d.trim() || d.length > MAX_LAB_DRAFT) throw new SenderError(`drafts must be 1..${MAX_LAB_DRAFT} characters`);
    }
    if (title.length > MAX_LAB_TITLE) throw new SenderError(`title must be at most ${MAX_LAB_TITLE} characters`);
    const open = [...ctx.db.labExperiment.status.filter('queued'), ...ctx.db.labExperiment.status.filter('running')];
    if (open.filter(e => e.requestedBy.equals(ctx.sender)).length >= MAX_OPEN_LABS_PER_SENDER) {
      throw new SenderError(`at most ${MAX_OPEN_LABS_PER_SENDER} experiments can run at once`);
    }
    ctx.db.labExperiment.insert({
      experimentId: 0n, brandUserId: brandUser.userId, brand: brandUser.username,
      title: (title.trim() || draftA.trim().slice(0, 60)), draftA, draftB, status: 'queued',
      runA: '', runB: '', winner: '', lift: 0, error: undefined, requestedBy: ctx.sender, createdAt: ctx.timestamp,
    } as Row<'labExperiment'>);
  }
);

function labRow(ctx: Ctx, experimentId: bigint) {
  const row = ctx.db.labExperiment.experimentId.find(experimentId);
  if (!row) throw new SenderError(`unknown experiment ${experimentId}`);
  return row;
}

export const claimLabExperiment = spacetimedb.reducer({ experimentId: t.u64() }, (ctx, { experimentId }) => {
  requireAdmin(ctx);
  notPaused(ctx);
  const row = labRow(ctx, experimentId);
  if (row.status !== 'queued') throw new SenderError(`experiment ${experimentId} already claimed`);
  ctx.db.labExperiment.experimentId.update({ ...row, status: 'running' });
});

export const attachLabRuns = spacetimedb.reducer(
  { experimentId: t.u64(), runA: t.string(), runB: t.string() },
  (ctx, { experimentId, runA, runB }) => {
    requireAdmin(ctx);
    ctx.db.labExperiment.experimentId.update({ ...labRow(ctx, experimentId), runA, runB });
  }
);

export const finishLabExperiment = spacetimedb.reducer(
  { experimentId: t.u64(), winner: t.string(), lift: t.f64() },
  (ctx, { experimentId, winner, lift }) => {
    requireAdmin(ctx);
    notPaused(ctx);
    if (!['A', 'B', 'tie'].includes(winner)) throw new SenderError('winner must be A, B or tie');
    ctx.db.labExperiment.experimentId.update({ ...labRow(ctx, experimentId), status: 'done', winner, lift });
  }
);

export const failLabExperiment = spacetimedb.reducer(
  { experimentId: t.u64(), error: t.string() },
  (ctx, { experimentId, error }) => {
    requireAdmin(ctx);
    ctx.db.labExperiment.experimentId.update({ ...labRow(ctx, experimentId), status: 'failed', error: error.slice(0, 300) });
  }
);

export const setBacktestResult = spacetimedb.reducer(
  { scope: t.string(), metric: t.string(), value: t.f64(), baseline: t.f64(), n: t.u32(), note: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    const row = { backtestResultId: `${a.scope}:${a.metric}`, ...a, note: a.note.slice(0, 300), updatedAt: ctx.timestamp };
    if (ctx.db.backtestResult.backtestResultId.find(row.backtestResultId)) ctx.db.backtestResult.backtestResultId.update(row);
    else ctx.db.backtestResult.insert(row);
  }
);

// Comments (replies / quotes) written by the backend in each replying person's voice, shown under the Lab tweet.
const MAX_COMMENT = 280;
export const addSimComments = spacetimedb.reducer(
  { runId: t.string(), comments: t.array(CommentInput) },
  (ctx, { runId, comments }) => {
    requireAdmin(ctx);
    if (!ctx.db.simRun.runId.find(runId)) throw new SenderError(`unknown sim run ${runId}`);
    for (const c of comments) {
      if (c.kind !== 'reply' && c.kind !== 'quote') throw new SenderError('kind must be reply or quote');
      const row = { simCommentId: `${runId}:${c.userId}:${c.kind}`, runId, userId: c.userId, kind: c.kind,
                    text: c.text.slice(0, MAX_COMMENT), tick: c.tick };
      if (ctx.db.simComment.simCommentId.find(row.simCommentId)) ctx.db.simComment.simCommentId.update(row);
      else ctx.db.simComment.insert(row);
    }
  }
);

// ---------- Onboarding reducers ----------
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ONBOARDING_GOALS = ['', 'reposts', 'likes', 'replies', 'views'];
const ONBOARDING_STAGES = ['scraping', 'twins', 'graph', 'ready'];
const MAX_BRIEF_SHORT = 80;
const MAX_BRIEF_NEWS = 600;

function onboardingRow(ctx: Ctx, onboardingId: bigint) {
  const row = ctx.db.onboarding.onboardingId.find(onboardingId);
  if (!row) throw new SenderError(`unknown onboarding ${onboardingId}`);
  return row;
}

export const requestOnboarding = spacetimedb.reducer({ handle: t.string() }, (ctx, { handle }) => {
  const clean = handle.trim().replace(/^@/, '');
  if (!HANDLE_RE.test(clean)) throw new SenderError('enter a valid X handle');
  const open = [...ctx.db.onboarding.requestedBy.filter(ctx.sender)]
    .filter(o => o.status !== 'ready' && o.status !== 'failed');
  if (open.length) throw new SenderError('an onboarding is already running');
  ctx.db.onboarding.insert({
    onboardingId: 0n, handle: clean.toLowerCase(), brandUserId: '', status: 'queued', ingestionRunId: '', twinRunId: '',
    ownerName: '', role: '', campaignName: '', campaignNews: '', goal: '', error: undefined,
    requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  } as Row<'onboarding'>);
});

export const updateOnboardingBrief = spacetimedb.reducer(
  { onboardingId: t.u64(), ownerName: t.string(), role: t.string(), campaignName: t.string(),
    campaignNews: t.string(), goal: t.string() },
  (ctx, a) => {
    const row = onboardingRow(ctx, a.onboardingId);
    if (!row.requestedBy.equals(ctx.sender)) throw new SenderError('not your onboarding');
    if (!ONBOARDING_GOALS.includes(a.goal)) throw new SenderError('unknown goal');
    for (const v of [a.ownerName, a.role, a.campaignName]) {
      if (v.length > MAX_BRIEF_SHORT) throw new SenderError(`answers must be at most ${MAX_BRIEF_SHORT} characters`);
    }
    if (a.campaignNews.length > MAX_BRIEF_NEWS) throw new SenderError(`the news must be at most ${MAX_BRIEF_NEWS} characters`);
    ctx.db.onboarding.onboardingId.update({
      ...row, ownerName: a.ownerName.trim(), role: a.role.trim(), campaignName: a.campaignName.trim(),
      campaignNews: a.campaignNews.trim(), goal: a.goal, updatedAt: ctx.timestamp,
    });
  }
);

export const claimOnboarding = spacetimedb.reducer({ onboardingId: t.u64() }, (ctx, { onboardingId }) => {
  requireAdmin(ctx);
  notPaused(ctx);
  const row = onboardingRow(ctx, onboardingId);
  if (row.status !== 'queued') throw new SenderError(`onboarding ${onboardingId} already claimed`);
  ctx.db.onboarding.onboardingId.update({ ...row, status: 'scraping', updatedAt: ctx.timestamp });
});

export const setOnboardingProgress = spacetimedb.reducer(
  { onboardingId: t.u64(), status: t.string(), brandUserId: t.string(), ingestionRunId: t.string(), twinRunId: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    notPaused(ctx);
    if (!ONBOARDING_STAGES.includes(a.status)) throw new SenderError(`status must be one of ${ONBOARDING_STAGES.join(', ')}`);
    const row = onboardingRow(ctx, a.onboardingId);
    ctx.db.onboarding.onboardingId.update({
      ...row, status: a.status, brandUserId: a.brandUserId || row.brandUserId,
      ingestionRunId: a.ingestionRunId || row.ingestionRunId, twinRunId: a.twinRunId || row.twinRunId,
      updatedAt: ctx.timestamp,
    });
  }
);

export const failOnboarding = spacetimedb.reducer(
  { onboardingId: t.u64(), error: t.string() },
  (ctx, { onboardingId, error }) => {
    requireAdmin(ctx);
    const row = onboardingRow(ctx, onboardingId);
    ctx.db.onboarding.onboardingId.update({ ...row, status: 'failed', error: error.slice(0, 300), updatedAt: ctx.timestamp });
  }
);
// Administrative retry keeps the failed attempt in history and starts a fresh Scweet cache.
export const retryOnboarding = spacetimedb.reducer({ onboardingId: t.u64() }, (ctx, { onboardingId }) => {
  requireAdmin(ctx);
  const row = onboardingRow(ctx, onboardingId);
  if (row.status !== 'failed') throw new SenderError('only failed onboardings can be retried');
  if ([...ctx.db.onboarding.iter()].some(r => r.handle === row.handle && !['ready', 'failed'].includes(r.status))) {
    throw new SenderError('an onboarding is already running');
  }
  ctx.db.onboarding.insert({ ...row, onboardingId: 0n, brandUserId: '', status: 'queued',
    ingestionRunId: '', twinRunId: '', error: undefined, createdAt: ctx.timestamp, updatedAt: ctx.timestamp });
});
// ---------- Creative reducers ----------
const CREATIVE_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', '21:9', '5:2', 'auto'];
const CREATIVE_FORMATS = ['product_ui', 'lifestyle', 'typographic', 'illustration', 'meme'];
const CREATIVE_KINDS = ['generate', 'edit', 'regenerate', 'resize', 'branch', 'tweak_prompt'];
const CREATIVE_TERMINAL = ['ready', 'failed', 'filtered'];
const CREATIVE_LEASE_MICROS = 180_000_000n;
function creativeText(value: string, label: string, max: number, allowEmpty = false) {
  if ((!allowEmpty && !value.trim()) || value.length > max) throw new SenderError(`${label} must be ${allowEmpty ? '0' : '1'}..${max} characters`);
}
function creativeStrings(values: string[], label: string, count: number, length: number) {
  if (values.length > count) throw new SenderError(`too many ${label}`);
  for (const value of values) creativeText(value, label, length);
}
function creativeRatio(value: string) {
  if (!CREATIVE_RATIOS.includes(value)) throw new SenderError('unsupported aspect ratio');
}
function campaignIn(ctx: Ctx, campaignId: string) {
  const row = ctx.db.campaign.campaignId.find(campaignId);
  if (!row) throw new SenderError('unknown campaign');
  return row;
}
function ownedCampaign(ctx: Ctx, campaignId: string) {
  const row = campaignIn(ctx, campaignId);
  if (!row.createdBy.equals(ctx.sender)) throw new SenderError('campaign belongs to another identity');
  if (row.status === 'handed_off') throw new SenderError('campaign has already been handed off');
  return row;
}
function variantIn(ctx: Ctx, variantId: string) {
  const row = ctx.db.adVariant.variantId.find(variantId);
  if (!row) throw new SenderError('unknown variant');
  return row;
}
function validateAdCopy(ctx: Ctx, campaignId: string, ...copy: string[]) {
  const parent = campaignIn(ctx, campaignId);
  const kit = ctx.db.brandKit.brandUserId.find(parent.brandUserId);
  for (const value of copy) {
    if (/@[\w.-]+|did:[\w:.-]+|at:\/\//i.test(value)) throw new SenderError('ad copy cannot include personal handles or identifiers');
    const banned = kit?.bannedClaims.find(claim => value.toLowerCase().includes(claim.toLowerCase()));
    if (banned) throw new SenderError(`ad copy contains a brand claim to avoid: ${banned}`);
  }
}
function mainSegmentMembers(ctx: Ctx, brandUserId: string) {
  const segments = new Map<string, string[]>();
  for (const link of ctx.db.twinAudience.brandUserId.filter(brandUserId)) {
    if (!ctx.db.twin.userId.find(link.userId)) continue;
    let main: { niche: string; affinity: number } | undefined;
    for (const rating of ctx.db.twinNiche.userId.filter(link.userId)) {
      if (!main || rating.affinity > main.affinity || (rating.affinity === main.affinity && rating.niche < main.niche)) main = rating;
    }
    if (main) segments.set(main.niche, [...(segments.get(main.niche) ?? []), link.userId]);
  }
  return segments;
}
function activeCreativeJobs(ctx: Ctx) {
  return [...ctx.db.creativeJob.status.filter('pending'), ...ctx.db.creativeJob.status.filter('running')];
}
function assertCreativeCapacity(ctx: Ctx, campaignId: string, requested: number) {
  const existing = [...ctx.db.adVariant.campaignId.filter(campaignId)].length;
  let reserved = 0;
  for (const job of activeCreativeJobs(ctx).filter(j => j.campaignId === campaignId)) {
    // Placeholders count as variants; only unproduced reservation slots count again.
    reserved += Math.max(0, job.reservedVariants - [...ctx.db.adVariant.jobId.filter(job.jobId)].length);
  }
  if (existing + reserved + requested > 60) throw new SenderError('campaign limit of 60 variants reached');
}
function enqueueCreative(ctx: Ctx, campaignId: string, kind: string, targetId: string, instruction: string | undefined, aspectRatio: string | undefined, reservedVariants: number) {
  ctx.db.creativeJob.insert({ jobId: 0n, campaignId, kind, targetId, instruction, aspectRatio, reservedVariants,
    status: 'pending', requestedBy: ctx.sender, error: undefined, claimedBy: undefined,
    claimedAt: undefined, createdAt: ctx.timestamp, finishedAt: undefined });
}
function runningCreativeJob(ctx: Ctx, jobId: bigint) {
  const row = ctx.db.creativeJob.jobId.find(jobId);
  if (!row) throw new SenderError('unknown creative job');
  if (row.status !== 'running') throw new SenderError(`creative job is ${row.status}`);
  if (!row.claimedBy?.equals(ctx.sender)) throw new SenderError('creative job claimed by another worker');
  if (!row.claimedAt || ctx.timestamp.microsSinceUnixEpoch - row.claimedAt.microsSinceUnixEpoch >= CREATIVE_LEASE_MICROS) throw new SenderError('creative job lease expired; recover and claim again');
  return row;
}
function refreshCampaignStatus(ctx: Ctx, campaignId: string) {
  const row = campaignIn(ctx, campaignId);
  if (row.status === 'handed_off') return;
  const active = activeCreativeJobs(ctx).filter(j => j.campaignId === campaignId);
  const status = active.some(j => j.kind !== 'brief') ? 'generating' : active.length ? 'briefing'
    : [...ctx.db.adVariant.campaignId.filter(campaignId)].length ? 'reviewing' : 'draft';
  ctx.db.campaign.campaignId.update({ ...row, status });
}
export const createCampaign = spacetimedb.reducer(
  { campaignId: t.string(), brandUserId: t.string(), name: t.string(), goal: t.string(), offer: str(), channel: t.string(), aspectRatio: t.string(), segments: t.array(t.string()), variantsPerBrief: t.u8() },
  (ctx, args) => {
    creativeText(args.campaignId, 'campaign id', 100);
    creativeText(args.name, 'name', 120); creativeText(args.goal, 'goal', 600);
    if (args.offer !== undefined) creativeText(args.offer, 'offer', 300, true);
    if (!['bluesky', 'x', 'instagram'].includes(args.channel)) throw new SenderError('unsupported channel');
    creativeRatio(args.aspectRatio);
    if (args.variantsPerBrief < 2 || args.variantsPerBrief > 4) throw new SenderError('variants per brief must be 2..4');
    if (!args.segments.length || args.segments.length > 4 || new Set(args.segments).size !== args.segments.length) throw new SenderError('choose 1..4 unique segments');
    if (ctx.db.campaign.campaignId.find(args.campaignId)) throw new SenderError('campaign id already exists');
    const members = mainSegmentMembers(ctx, args.brandUserId);
    for (const segment of args.segments) {
      if (!ctx.db.niche.slug.find(segment) || ['politics_society', 'other'].includes(segment)) throw new SenderError('unsupported audience segment');
      if ((members.get(segment)?.length ?? 0) < MIN_SEGMENT_TWINS) throw new SenderError(`each segment needs at least ${MIN_SEGMENT_TWINS} twins`);
    }
    // The first request can contain four brief-only jobs; another campaign cannot
    // use that exception to bypass the sender concurrency cap.
    if (activeCreativeJobs(ctx).some(j => j.requestedBy.equals(ctx.sender))) throw new SenderError('finish existing creative jobs before creating a campaign');
    ctx.db.campaign.insert({ ...args, offer: args.offer, status: 'briefing', createdBy: ctx.sender, createdAt: ctx.timestamp });
    for (const segment of args.segments) enqueueCreative(ctx, args.campaignId, 'brief', `${args.campaignId}:${segment}:1`, undefined, undefined, 0);
  }
);
export const requestCreative = spacetimedb.reducer(
  { campaignId: t.string(), kind: t.string(), targetId: t.string(), instruction: str(), aspectRatio: str() },
  (ctx, { campaignId, kind, targetId, instruction, aspectRatio }) => {
    const row = ownedCampaign(ctx, campaignId);
    if (!CREATIVE_KINDS.includes(kind)) throw new SenderError('unsupported creative operation');
    if (instruction !== undefined) creativeText(instruction, 'instruction', kind === 'tweak_prompt' ? 4000 : 300, true);
    if (['edit', 'branch', 'tweak_prompt'].includes(kind) && !instruction?.trim()) throw new SenderError('instruction required');
    if (aspectRatio !== undefined) creativeRatio(aspectRatio);
    if (kind === 'resize' && !aspectRatio) throw new SenderError('resize requires an aspect ratio');
    if (kind === 'generate') {
      const brief = ctx.db.creativeBrief.briefId.find(targetId);
      if (!brief || brief.campaignId !== campaignId) throw new SenderError('brief is not in this campaign');
    } else {
      const parent = variantIn(ctx, targetId);
      if (parent.campaignId !== campaignId || parent.status !== 'ready' || !parent.imageUrl) throw new SenderError('a ready parent variant in this campaign is required');
      if (parent.depth >= 64) throw new SenderError('variant lineage is too deep');
    }
    if (activeCreativeJobs(ctx).filter(j => j.requestedBy.equals(ctx.sender)).length >= 3) throw new SenderError('at most 3 open creative jobs per sender');
    const reserved = kind === 'generate' ? row.variantsPerBrief : 1;
    assertCreativeCapacity(ctx, campaignId, reserved);
    enqueueCreative(ctx, campaignId, kind, targetId, instruction, aspectRatio, reserved);
    ctx.db.campaign.campaignId.update({ ...row, status: 'generating' });
  }
);
export const deleteCampaign = spacetimedb.reducer({ campaignId: t.string() }, (ctx, { campaignId }) => {
  const campaign = campaignIn(ctx, campaignId);
  if (!campaign.createdBy.equals(ctx.sender) && !ctx.db.admin.identity.find(ctx.sender)) {
    throw new SenderError('campaign belongs to another identity');
  }
  // Remove the queue first so an interrupted worker cannot publish more output.
  for (const job of [...ctx.db.creativeJob.campaignId.filter(campaignId)]) ctx.db.creativeJob.jobId.delete(job.jobId);
  for (const variant of [...ctx.db.adVariant.campaignId.filter(campaignId)]) ctx.db.adVariant.variantId.delete(variant.variantId);
  for (const brief of [...ctx.db.creativeBrief.campaignId.filter(campaignId)]) ctx.db.creativeBrief.briefId.delete(brief.briefId);
  ctx.db.campaign.campaignId.delete(campaignId);
});
const editableBriefFields = {
  audienceLabel: t.string(), tone: t.string(), messageAngle: t.string(), valueProps: t.array(t.string()),
  headlineOptions: t.array(t.string()), cta: t.string(), visualCues: t.array(t.string()),
  visualAvoid: t.array(t.string()), format: t.string(),
};
function validateBriefCopy(fields: { audienceLabel: string; tone: string; messageAngle: string; valueProps: string[]; headlineOptions: string[]; cta: string; visualCues: string[]; visualAvoid: string[]; format: string }) {
  creativeText(fields.audienceLabel, 'audience label', 120); creativeText(fields.tone, 'tone', 300);
  creativeText(fields.messageAngle, 'message angle', 500);
  creativeStrings(fields.valueProps, 'value props', 3, 300);
  creativeStrings(fields.headlineOptions, 'headlines', 3, 100); creativeText(fields.cta, 'CTA', 60);
  creativeStrings(fields.visualCues, 'visual cues', 5, 300); creativeStrings(fields.visualAvoid, 'visual avoid', 5, 300);
  if (!CREATIVE_FORMATS.includes(fields.format)) throw new SenderError('unsupported creative format');
}
export const editBrief = spacetimedb.reducer({ briefId: t.string(), ...editableBriefFields }, (ctx, { briefId, ...fields }) => {
  const prev = ctx.db.creativeBrief.briefId.find(briefId);
  if (!prev) throw new SenderError('unknown brief');
  ownedCampaign(ctx, prev.campaignId); validateBriefCopy(fields);
  validateAdCopy(ctx, prev.campaignId, ...fields.headlineOptions, fields.cta);
  const versions = [...ctx.db.creativeBrief.campaignId.filter(prev.campaignId)].filter(b => b.segment === prev.segment);
  const version = Math.max(...versions.map(b => b.version)) + 1;
  ctx.db.creativeBrief.insert({ ...prev, ...fields, briefId: `${prev.campaignId}:${prev.segment}:${version}`, version, editedByUser: true, createdAt: ctx.timestamp });
});
export const setVariantCopy = spacetimedb.reducer({ variantId: t.string(), headline: t.string(), cta: t.string() }, (ctx, { variantId, headline, cta }) => {
  const row = variantIn(ctx, variantId); ownedCampaign(ctx, row.campaignId);
  if (row.status !== 'ready') throw new SenderError('variant must be ready');
  creativeText(headline, 'headline', 100, true); creativeText(cta, 'CTA', 60, true);
  validateAdCopy(ctx, row.campaignId, headline, cta);
  ctx.db.adVariant.variantId.update({ ...row, headline, cta, approved: false, updatedAt: ctx.timestamp });
});
export const starVariant = spacetimedb.reducer({ variantId: t.string(), starred: t.bool() }, (ctx, { variantId, starred }) => {
  const row = variantIn(ctx, variantId); ownedCampaign(ctx, row.campaignId);
  ctx.db.adVariant.variantId.update({ ...row, starred, updatedAt: ctx.timestamp });
});
export const approveVariant = spacetimedb.reducer({ variantId: t.string(), approved: t.bool() }, (ctx, { variantId, approved }) => {
  const row = variantIn(ctx, variantId); ownedCampaign(ctx, row.campaignId);
  if (approved && (row.status !== 'ready' || !row.imageUrl)) throw new SenderError('only ready images can be approved');
  ctx.db.adVariant.variantId.update({ ...row, approved, updatedAt: ctx.timestamp });
});
export const handoffCampaign = spacetimedb.reducer({ campaignId: t.string() }, (ctx, { campaignId }) => {
  const row = ownedCampaign(ctx, campaignId);
  if (activeCreativeJobs(ctx).some(j => j.campaignId === campaignId)) throw new SenderError('finish creative jobs before handoff');
  if (![...ctx.db.adVariant.campaignId.filter(campaignId)].some(v => v.status === 'ready' && v.approved && v.imageUrl)) throw new SenderError('approve at least one ready variant before handoff');
  ctx.db.campaign.campaignId.update({ ...row, status: 'handed_off' });
});
export const upsertBrandKit = spacetimedb.reducer(brandKitFields, (ctx, fields) => {
  requireAdmin(ctx);
  if (!ctx.db.xUser.userId.find(fields.brandUserId)) throw new SenderError('unknown brand user');
  creativeText(fields.displayName, 'display name', 120); creativeText(fields.productDescription, 'product description', 2000);
  creativeStrings(fields.valueProps, 'value props', 10, 500); creativeStrings(fields.palette, 'palette', 12, 7);
  if (fields.palette.some(color => !/^#[0-9a-fA-F]{6}$/.test(color))) throw new SenderError('palette must contain six-digit hex colors');
  creativeText(fields.visualStyle, 'visual style', 1000); creativeStrings(fields.bannedClaims, 'banned claims', 30, 300);
  creativeStrings(fields.referenceImageUrls, 'reference images', 4, 2000);
  if (fields.referenceImageUrls.some(url => !/^https:\/\//.test(url))) throw new SenderError('references must be HTTPS URLs');
  const row = { ...fields, updatedAt: ctx.timestamp };
  if (ctx.db.brandKit.brandUserId.find(fields.brandUserId)) ctx.db.brandKit.brandUserId.update(row);
  else ctx.db.brandKit.insert(row);
});
export const publishBrief = spacetimedb.reducer({ jobId: t.u64(), ...creativeBriefFields }, (ctx, { jobId, ...fields }) => {
  requireAdmin(ctx);
  const job = runningCreativeJob(ctx, jobId); const parent = campaignIn(ctx, fields.campaignId);
  if (job.kind !== 'brief' || job.campaignId !== fields.campaignId || job.targetId !== fields.briefId) throw new SenderError('brief does not match claimed job');
  if (!parent.segments.includes(fields.segment) || fields.briefId !== `${fields.campaignId}:${fields.segment}:1` || fields.version !== 1) throw new SenderError('invalid initial brief identity');
  validateBriefCopy(fields);
  if (!Number.isFinite(fields.share) || fields.share < 0 || fields.share > 1 || fields.twinCount < MIN_SEGMENT_TWINS) throw new SenderError('invalid audience count or share');
  const members = new Set(mainSegmentMembers(ctx, parent.brandUserId).get(fields.segment) ?? []);
  if (fields.twinCount !== members.size) throw new SenderError('brief twin count does not match segment');
  for (const themes of [fields.keyInterests, fields.avoid]) {
    if (themes.length > 5) throw new SenderError('too many brief themes');
    for (const theme of themes) {
      creativeText(theme.text, 'theme', 200); const ids = new Set(theme.twinIds);
      if ([...ids].some(id => !members.has(id))) throw new SenderError('theme cites a twin outside its segment');
      const support = ids.size / members.size;
      if (!Number.isFinite(theme.support) || Math.abs(theme.support - support) > 0.000001 || support < 0.08) throw new SenderError('theme support must equal cited segment membership and be at least 0.08');
    }
  }
  creativeText(fields.model, 'model', 100);
  if (fields.evidenceJson !== undefined) {
    creativeText(fields.evidenceJson, 'evidence', 100000, true);
    try { JSON.parse(fields.evidenceJson); } catch { throw new SenderError('evidence must be JSON'); }
  }
  if (ctx.db.creativeBrief.briefId.find(fields.briefId)) return;
  ctx.db.creativeBrief.insert({ ...fields, evidenceJson: fields.evidenceJson, editedByUser: false, createdAt: ctx.timestamp } as Row<'creativeBrief'>);
});
export const upsertVariant = spacetimedb.reducer(adVariantFields, (ctx, fields) => {
  requireAdmin(ctx);
  const job = runningCreativeJob(ctx, fields.jobId); const parentCampaign = campaignIn(ctx, fields.campaignId);
  const brief = ctx.db.creativeBrief.briefId.find(fields.briefId);
  if (job.kind === 'brief' || job.campaignId !== fields.campaignId || !brief || brief.campaignId !== fields.campaignId) throw new SenderError('variant does not match claimed job or campaign brief');
  if (fields.operation !== (job.kind === 'tweak_prompt' ? 'generate' : job.kind)) throw new SenderError('variant operation does not match job');
  if (job.kind === 'generate') {
    if (fields.briefId !== job.targetId || fields.parentVariantId || fields.rootVariantId !== fields.variantId || fields.depth !== 0) throw new SenderError('invalid root variant lineage');
  } else {
    const parent = variantIn(ctx, job.targetId);
    if (fields.parentVariantId !== parent.variantId || fields.rootVariantId !== parent.rootVariantId || fields.depth !== parent.depth + 1 || fields.briefId !== parent.briefId) throw new SenderError('invalid child variant lineage');
  }
  creativeText(fields.variantId, 'variant id', 120); creativeText(fields.imagePrompt, 'image prompt', 64000);
  creativeText(fields.headline, 'headline', 100, true); creativeText(fields.cta, 'CTA', 60, true);
  creativeText(fields.model, 'model', 100);
  if (!['grok-imagine-image-2.0', 'grok-imagine-image'].includes(fields.model)) throw new SenderError('only Grok Imagine image models are supported');
  if (fields.quality !== 'low') throw new SenderError('quality must be low for the campaign budget');
  creativeRatio(fields.aspectRatio);
  if (fields.aspectRatio !== (job.aspectRatio ?? parentCampaign.aspectRatio) && job.kind === 'generate') throw new SenderError('variant ratio does not match requested ratio');
  if (!['queued', 'generating', ...CREATIVE_TERMINAL].includes(fields.status)) throw new SenderError('invalid variant status');
  if (fields.status === 'ready' && !fields.imageUrl) throw new SenderError('ready variant needs a hosted image URL');
  if (fields.imageUrl && !(/^https:\/\//.test(fields.imageUrl) || /^\/generated\/[a-zA-Z0-9_.-]+$/.test(fields.imageUrl))) throw new SenderError('image must be an HTTPS URL or local generated asset');
  if (fields.instruction !== undefined) creativeText(fields.instruction, 'instruction', job.kind === 'tweak_prompt' ? 4000 : 300, true);
  if (fields.error !== undefined) creativeText(fields.error, 'error', 2000, true);
  const prev = ctx.db.adVariant.variantId.find(fields.variantId);
  if (prev) {
    if (prev.jobId !== fields.jobId || prev.campaignId !== fields.campaignId || prev.briefId !== fields.briefId || prev.parentVariantId !== fields.parentVariantId || prev.rootVariantId !== fields.rootVariantId || prev.depth !== fields.depth) throw new SenderError('variant identity is immutable');
    if (CREATIVE_TERMINAL.includes(prev.status)) {
      if (prev.status === fields.status && prev.imageUrl === fields.imageUrl && prev.imagePrompt === fields.imagePrompt) return;
      throw new SenderError('variant already has a terminal result');
    }
    if (prev.status === 'generating' && fields.status === 'queued') throw new SenderError('variant cannot return to queued');
    ctx.db.adVariant.variantId.update({ ...prev, ...fields, parentVariantId: fields.parentVariantId, instruction: fields.instruction, imageUrl: fields.imageUrl, xaiFileId: fields.xaiFileId, error: fields.error, updatedAt: ctx.timestamp });
  } else {
    if ([...ctx.db.adVariant.jobId.filter(fields.jobId)].length >= job.reservedVariants) throw new SenderError('job variant reservation exhausted');
    if ([...ctx.db.adVariant.campaignId.filter(fields.campaignId)].length >= 60) throw new SenderError('campaign variant limit reached');
    ctx.db.adVariant.insert({ ...fields, parentVariantId: fields.parentVariantId, instruction: fields.instruction, imageUrl: fields.imageUrl, xaiFileId: fields.xaiFileId, error: fields.error, starred: false, approved: false, createdAt: ctx.timestamp, updatedAt: ctx.timestamp } as Row<'adVariant'>);
  }
});
// Workers must say which code they run: older workers (no version) can no longer claim, so a stale machine sharing
// the backend login cannot grab campaigns and fail them with errors the current code has already fixed.
const CREATIVE_WORKER_VERSION = 2;
export const claimCreativeJob = spacetimedb.reducer({ jobId: t.u64(), workerVersion: t.u32() }, (ctx, { jobId, workerVersion }) => {
  requireAdmin(ctx); const row = ctx.db.creativeJob.jobId.find(jobId);
  notPaused(ctx);
  if (workerVersion < CREATIVE_WORKER_VERSION) throw new SenderError(`creative worker is out of date (v${workerVersion}); pull and restart it`);
  if (!row || row.status !== 'pending') throw new SenderError('creative job unavailable or already claimed');
  ctx.db.creativeJob.jobId.update({ ...row, status: 'running', claimedBy: ctx.sender, claimedAt: ctx.timestamp });
});
export const heartbeatCreativeJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireAdmin(ctx); const row = runningCreativeJob(ctx, jobId);
  ctx.db.creativeJob.jobId.update({ ...row, claimedAt: ctx.timestamp });
});
export const finishCreativeJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireAdmin(ctx); const row = runningCreativeJob(ctx, jobId);
  if (row.kind === 'brief') {
    if (!ctx.db.creativeBrief.briefId.find(row.targetId)) throw new SenderError('brief must be published before finishing');
  } else {
    const outputs = [...ctx.db.adVariant.jobId.filter(jobId)];
    if (outputs.length !== row.reservedVariants || outputs.some(v => !CREATIVE_TERMINAL.includes(v.status))) throw new SenderError('all reserved variants need terminal results before finishing');
  }
  ctx.db.creativeJob.jobId.update({ ...row, status: 'done', error: undefined, finishedAt: ctx.timestamp });
  refreshCampaignStatus(ctx, row.campaignId);
});
export const failCreativeJob = spacetimedb.reducer({ jobId: t.u64(), error: t.string() }, (ctx, { jobId, error }) => {
  requireAdmin(ctx); const row = runningCreativeJob(ctx, jobId); creativeText(error, 'error', 2000);
  for (const variant of ctx.db.adVariant.jobId.filter(jobId)) {
    if (!CREATIVE_TERMINAL.includes(variant.status)) ctx.db.adVariant.variantId.update({ ...variant, status: 'failed', error, updatedAt: ctx.timestamp });
  }
  ctx.db.creativeJob.jobId.update({ ...row, status: 'failed', error, finishedAt: ctx.timestamp });
  refreshCampaignStatus(ctx, row.campaignId);
});
export const resetStaleCreativeJobs = spacetimedb.reducer(ctx => {
  requireAdmin(ctx);
  for (const row of [...ctx.db.creativeJob.status.filter('running')]) {
    if (!row.claimedAt || ctx.timestamp.microsSinceUnixEpoch - row.claimedAt.microsSinceUnixEpoch >= CREATIVE_LEASE_MICROS) ctx.db.creativeJob.jobId.update({ ...row, status: 'pending', claimedBy: undefined, claimedAt: undefined, error: undefined });
  }
});

// ---------- Campaign video reducers ----------
const VIDEO_STAGES = ['research', 'brief', 'voice', 'film', 'stills', 'revise', 'render', 'thumbnail'];
const MAX_VIDEO_TEXT = 600;

function videoRow(ctx: Ctx, videoId: string) {
  const row = ctx.db.campaignVideo.videoId.find(videoId);
  if (!row) throw new SenderError(`unknown video ${videoId}`);
  return row;
}

// Anyone can queue a video (the worker makes it); one open request per sender.
export const requestCampaignVideo = spacetimedb.reducer(
  { brand: t.string(), news: t.string(), goal: t.string(), campaignId: t.string() },
  (ctx, a) => {
    const brand = a.brand.trim().replace(/^@/, '');
    if (!brand || brand.length > 60) throw new SenderError('enter a brand');
    if (!a.news.trim() || a.news.length > MAX_VIDEO_TEXT) throw new SenderError(`describe the news in 1..${MAX_VIDEO_TEXT} characters`);
    if (a.goal.length > 80) throw new SenderError('goal must be at most 80 characters');
    const open = [...ctx.db.campaignVideo.iter()].filter(v => v.requestedBy.equals(ctx.sender) && v.status !== 'done' && v.status !== 'failed');
    if (open.length) throw new SenderError('a video is already being made');
    const videoId = `${brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ctx.timestamp.microsSinceUnixEpoch}`;
    ctx.db.campaignVideo.insert({
      videoId, brand, campaignId: a.campaignId, news: a.news.trim(), goal: a.goal.trim(), status: 'queued', progress: 0,
      title: '', videoUrl: '', thumbnailUrl: '', durationS: 0, scriptJson: '', reviewJson: '', error: undefined,
      requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    } as Row<'campaignVideo'>);
  }
);

// The worker (or the CLI) registers a video it is about to make, so CLI runs show up live too.
export const startCampaignVideo = spacetimedb.reducer(
  { videoId: t.string(), brand: t.string(), news: t.string(), goal: t.string(), campaignId: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    notPaused(ctx);
    const row = ctx.db.campaignVideo.videoId.find(a.videoId);
    if (row) {
      if (row.status !== 'queued') throw new SenderError(`video ${a.videoId} already claimed`);
      ctx.db.campaignVideo.videoId.update({ ...row, status: 'research', progress: 0, updatedAt: ctx.timestamp });
      return;
    }
    ctx.db.campaignVideo.insert({
      videoId: a.videoId, brand: a.brand, campaignId: a.campaignId, news: a.news, goal: a.goal, status: 'research',
      progress: 0, title: '', videoUrl: '', thumbnailUrl: '', durationS: 0, scriptJson: '', reviewJson: '',
      error: undefined, requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    } as Row<'campaignVideo'>);
  }
);

export const setCampaignVideoProgress = spacetimedb.reducer(
  { videoId: t.string(), status: t.string(), progress: t.f64() },
  (ctx, { videoId, status, progress }) => {
    requireAdmin(ctx);
    notPaused(ctx);
    if (!VIDEO_STAGES.includes(status)) throw new SenderError(`status must be one of ${VIDEO_STAGES.join(', ')}`);
    ctx.db.campaignVideo.videoId.update({ ...videoRow(ctx, videoId), status, progress: Math.min(1, Math.max(0, progress)), updatedAt: ctx.timestamp });
  }
);

export const finishCampaignVideo = spacetimedb.reducer(
  { videoId: t.string(), title: t.string(), videoUrl: t.string(), thumbnailUrl: t.string(), durationS: t.f64(),
    scriptJson: t.string(), reviewJson: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    notPaused(ctx);
    ctx.db.campaignVideo.videoId.update({ ...videoRow(ctx, a.videoId), status: 'done', progress: 1, title: a.title,
      videoUrl: a.videoUrl, thumbnailUrl: a.thumbnailUrl, durationS: a.durationS, scriptJson: a.scriptJson,
      reviewJson: a.reviewJson, error: undefined, updatedAt: ctx.timestamp });
  }
);

export const failCampaignVideo = spacetimedb.reducer(
  { videoId: t.string(), error: t.string() },
  (ctx, { videoId, error }) => {
    requireAdmin(ctx);
    ctx.db.campaignVideo.videoId.update({ ...videoRow(ctx, videoId), status: 'failed', error: error.slice(0, 300), updatedAt: ctx.timestamp });
  }
);

// Put a finished video on draft A or B of a Lab experiment (the experiment's requester or an admin).
export const attachLabDraftMedia = spacetimedb.reducer(
  { experimentId: t.u64(), draft: t.string(), videoId: t.string() },
  (ctx, { experimentId, draft, videoId }) => {
    const exp = ctx.db.labExperiment.experimentId.find(experimentId);
    if (!exp) throw new SenderError(`unknown experiment ${experimentId}`);
    if (!exp.requestedBy.equals(ctx.sender) && !ctx.db.admin.identity.find(ctx.sender)) throw new SenderError('not your experiment');
    if (draft !== 'A' && draft !== 'B') throw new SenderError('draft must be A or B');
    if (videoId === '') {
      ctx.db.labDraftMedia.mediaId.delete(`${experimentId}:${draft}`);
      return;
    }
    if (videoRow(ctx, videoId).status !== 'done') throw new SenderError('the video is not finished yet');
    const row = { mediaId: `${experimentId}:${draft}`, experimentId, draft, videoId, createdAt: ctx.timestamp };
    if (ctx.db.labDraftMedia.mediaId.find(row.mediaId)) ctx.db.labDraftMedia.mediaId.update(row);
    else ctx.db.labDraftMedia.insert(row);
  }
);

// ---------- Campaign flow reducers ----------
const FLOW_STAGES = ['concepts', 'testing', 'approved', 'shipped'];
const MAX_POST = 280;

export const startCampaignFlow = spacetimedb.reducer(
  { campaignId: t.string(), brand: t.string(), source: t.string(), draftA: t.string(), draftB: t.string() },
  (ctx, a) => {
    if (!a.campaignId.trim() || a.campaignId.length > 100) throw new SenderError('campaign id required');
    if (!a.brand.trim() || a.brand.length > 60) throw new SenderError('brand required');
    if (a.source !== 'generate' && a.source !== 'import') throw new SenderError('source must be generate or import');
    if (a.source === 'import' && (!a.draftA.trim() || !a.draftB.trim())) throw new SenderError('import two drafts');
    for (const d of [a.draftA, a.draftB]) if (d.length > MAX_POST) throw new SenderError(`drafts must be at most ${MAX_POST} characters`);
    if (ctx.db.campaignFlow.campaignId.find(a.campaignId)) throw new SenderError('campaign already started');
    ctx.db.campaignFlow.insert({
      campaignId: a.campaignId, brand: a.brand.trim().replace(/^@/, ''), source: a.source, stage: 'concepts',
      draftA: a.draftA.trim(), draftB: a.draftB.trim(), experimentId: 0n, videoId: '', winnerText: '',
      requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp, shippedAt: undefined,
    } as Row<'campaignFlow'>);
  }
);

// Owner moves the campaign along; empty strings / 0 keep the current value.
export const updateCampaignFlow = spacetimedb.reducer(
  { campaignId: t.string(), stage: t.string(), experimentId: t.u64(), videoId: t.string(), winnerText: t.string() },
  (ctx, a) => {
    const row = ctx.db.campaignFlow.campaignId.find(a.campaignId);
    if (!row) throw new SenderError('unknown campaign');
    if (!row.requestedBy.equals(ctx.sender)) throw new SenderError('not your campaign');
    if (a.stage && !FLOW_STAGES.includes(a.stage)) throw new SenderError(`stage must be one of ${FLOW_STAGES.join(', ')}`);
    if (a.winnerText.length > MAX_POST) throw new SenderError(`the post must be at most ${MAX_POST} characters`);
    if (a.experimentId && !ctx.db.labExperiment.experimentId.find(a.experimentId)) throw new SenderError('unknown experiment');
    if (a.videoId && !ctx.db.campaignVideo.videoId.find(a.videoId)) throw new SenderError('unknown video');
    const stage = a.stage || row.stage;
    ctx.db.campaignFlow.campaignId.update({
      ...row, stage, experimentId: a.experimentId || row.experimentId, videoId: a.videoId || row.videoId,
      winnerText: a.winnerText || row.winnerText, updatedAt: ctx.timestamp,
      shippedAt: stage === 'shipped' ? (row.shippedAt ?? ctx.timestamp) : row.shippedAt,
    });
  }
);

// ---------- Per-draft videos and video edits ----------
const MAX_OPEN_VIDEOS = 6; // a few campaigns' drafts can queue; the workers take them in order

function openVideos(ctx: Ctx) {
  return [...ctx.db.campaignVideo.iter()].filter(v => v.requestedBy.equals(ctx.sender) && v.status !== 'done' && v.status !== 'failed');
}

function ownedFlow(ctx: Ctx, campaignId: string) {
  const flow = ctx.db.campaignFlow.campaignId.find(campaignId);
  if (!flow) throw new SenderError('unknown campaign');
  if (!flow.requestedBy.equals(ctx.sender)) throw new SenderError('not your campaign');
  return flow;
}

function linkDraft(ctx: Ctx, campaignId: string, draft: string, videoId: string) {
  const row = { linkId: `${campaignId}:${draft}`, campaignId, draft, videoId, updatedAt: ctx.timestamp };
  if (ctx.db.campaignDraftVideo.linkId.find(row.linkId)) ctx.db.campaignDraftVideo.linkId.update(row);
  else ctx.db.campaignDraftVideo.insert(row);
  const exp = ctx.db.campaignFlow.campaignId.find(campaignId)?.experimentId ?? 0n;
  const media = `${exp}:${draft}`;
  if (exp && ctx.db.labDraftMedia.mediaId.find(media)) ctx.db.labDraftMedia.mediaId.delete(media); // re-attached when done
}

function queueVideo(ctx: Ctx, base: { brand: string; campaignId: string; news: string; goal: string }, suffix: string) {
  if (openVideos(ctx).length >= MAX_OPEN_VIDEOS) throw new SenderError('a few videos are already queued');
  const videoId = `${base.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ctx.timestamp.microsSinceUnixEpoch}-${suffix}`;
  ctx.db.campaignVideo.insert({
    videoId, brand: base.brand, campaignId: base.campaignId, news: base.news, goal: base.goal, status: 'queued', progress: 0,
    title: '', videoUrl: '', thumbnailUrl: '', durationS: 0, scriptJson: '', reviewJson: '', error: undefined,
    requestedBy: ctx.sender, createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  } as Row<'campaignVideo'>);
  return videoId;
}

export const requestDraftVideo = spacetimedb.reducer(
  { campaignId: t.string(), draft: t.string(), news: t.string(), goal: t.string() },
  (ctx, a) => {
    const flow = ownedFlow(ctx, a.campaignId);
    if (a.draft !== 'A' && a.draft !== 'B') throw new SenderError('draft must be A or B');
    if (!a.news.trim() || a.news.length > MAX_VIDEO_TEXT) throw new SenderError(`describe the post in 1..${MAX_VIDEO_TEXT} characters`);
    const existing = ctx.db.campaignDraftVideo.linkId.find(`${a.campaignId}:${a.draft}`);
    if (existing && ctx.db.campaignVideo.videoId.find(existing.videoId)?.status !== 'failed') return; // already has one
    const mode = ctx.db.videoMode.key.find('global');
    if (mode?.mode === 'off') return; // /ops switched video generation off
    if (mode?.mode === 'reuse') {
      const reuse = (a.draft === 'B' && mode.reuseB) || mode.reuseA;
      if (reuse && ctx.db.campaignVideo.videoId.find(reuse)?.status === 'done') { linkDraft(ctx, a.campaignId, a.draft, reuse); return; }
    }
    const videoId = queueVideo(ctx, { brand: flow.brand, campaignId: a.campaignId, news: a.news.trim(), goal: a.goal.trim() }, a.draft.toLowerCase());
    linkDraft(ctx, a.campaignId, a.draft, videoId);
  }
);

export const requestVideoEdit = spacetimedb.reducer(
  { parentId: t.string(), instruction: t.string(), beatsJson: t.string() },
  (ctx, a) => {
    const parent = videoRow(ctx, a.parentId);
    if (!parent.requestedBy.equals(ctx.sender)) throw new SenderError('not your video');
    if (parent.status !== 'done') throw new SenderError('the video is not finished yet');
    if (a.instruction.length > MAX_VIDEO_TEXT) throw new SenderError(`instructions must be at most ${MAX_VIDEO_TEXT} characters`);
    if (a.beatsJson.length > 4000) throw new SenderError('edited script is too long');
    if (!a.instruction.trim() && !a.beatsJson.trim()) throw new SenderError('say what to change');
    const videoId = queueVideo(ctx, parent, 'edit');
    ctx.db.videoEdit.insert({ videoId, parentId: parent.videoId, instruction: a.instruction.trim(), beatsJson: a.beatsJson, createdAt: ctx.timestamp });
    for (const link of [...ctx.db.campaignDraftVideo.campaignId.filter(parent.campaignId)]) {
      if (link.videoId === parent.videoId) linkDraft(ctx, link.campaignId, link.draft, videoId);
    }
  }
);

// ---------- Brand engagement anchor ----------
export const setBrandBaseline = spacetimedb.reducer(
  { brandUserId: t.string(), posts: t.u32(), likes: t.f64(), reposts: t.f64(), replies: t.f64(), quotes: t.f64(),
    views: t.f64(), likeScale: t.f64(), repostScale: t.f64(), replyScale: t.f64(), quoteScale: t.f64(), viewScale: t.f64(),
    baselineRunId: t.string(), note: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    for (const v of [a.likeScale, a.repostScale, a.replyScale, a.quoteScale, a.viewScale]) {
      if (!(v >= 0 && v <= 100000)) throw new SenderError('scales must be in [0, 100000]');
    }
    const row = { ...a, note: a.note.slice(0, 300), updatedAt: ctx.timestamp };
    if (ctx.db.brandBaseline.brandUserId.find(a.brandUserId)) ctx.db.brandBaseline.brandUserId.update(row);
    else ctx.db.brandBaseline.insert(row);
  }
);

export const clearBrandBaseline = spacetimedb.reducer({ brandUserId: t.string() }, (ctx, { brandUserId }) => {
  requireAdmin(ctx);
  ctx.db.brandBaseline.brandUserId.delete(brandUserId);
});

// ---------- Draft tweet copy ----------
export const requestDraftCopy = spacetimedb.reducer(
  { campaignId: t.string(), draft: t.string(), headline: t.string() },
  (ctx, a) => {
    ownedFlow(ctx, a.campaignId);
    if (a.draft !== 'A' && a.draft !== 'B') throw new SenderError('draft must be A or B');
    if (!a.headline.trim() || a.headline.length > 200) throw new SenderError('headline must be 1..200 characters');
    const copyId = `${a.campaignId}:${a.draft}`;
    const prev = ctx.db.draftCopy.copyId.find(copyId);
    if (prev && prev.status !== 'failed' && prev.headline === a.headline.trim()) return; // already written / writing
    const row = { copyId, campaignId: a.campaignId, draft: a.draft, headline: a.headline.trim(), text: '', status: 'queued',
                  error: undefined, requestedBy: ctx.sender, updatedAt: ctx.timestamp };
    if (prev) ctx.db.draftCopy.copyId.update(row as Row<'draftCopy'>); else ctx.db.draftCopy.insert(row as Row<'draftCopy'>);
  }
);

export const setDraftCopy = spacetimedb.reducer(
  { copyId: t.string(), status: t.string(), text: t.string(), error: t.string() },
  (ctx, a) => {
    requireAdmin(ctx);
    if (a.status !== 'failed') notPaused(ctx);
    const row = ctx.db.draftCopy.copyId.find(a.copyId);
    if (!row) throw new SenderError('unknown draft copy');
    if (!['writing', 'done', 'failed'].includes(a.status)) throw new SenderError('bad status');
    if (a.status === 'writing' && row.status !== 'queued') throw new SenderError('already claimed');
    ctx.db.draftCopy.copyId.update({ ...row, status: a.status, text: a.text.slice(0, MAX_POST),
      error: a.error ? a.error.slice(0, 300) : undefined, updatedAt: ctx.timestamp });
  }
);

// ---------- Ops (hidden /ops page) ----------
const SCALE_MODES = ['linear', 'anchored'];
const MAX_TWINS_SETTING = 500;
const MAX_FOLLOWERS_SETTING = 5000;
const MAX_FILL_REPLIES = 30;

// /ops is open to anyone with the site (owner's choice: internal tool). Kept as a hook in case it needs locking again.
function requireOps(_ctx: Ctx) {}

export const addOpsAdmin = spacetimedb.reducer({ identity: t.identity(), note: t.string() }, (ctx, a) => {
  requireAdmin(ctx);
  const row = { identity: a.identity, note: a.note.slice(0, 120), addedAt: ctx.timestamp };
  if (ctx.db.opsAdmin.identity.find(a.identity)) ctx.db.opsAdmin.identity.update(row); else ctx.db.opsAdmin.insert(row);
});

export const removeOpsAdmin = spacetimedb.reducer({ identity: t.identity() }, (ctx, { identity }) => {
  requireAdmin(ctx);
  ctx.db.opsAdmin.identity.delete(identity);
});

export const setSimSettings = spacetimedb.reducer(
  { twinsPerBrand: t.u32(), followersScraped: t.u32(), simTwins: t.u32(), scaleMode: t.string(), fillReplies: t.u32() },
  (ctx, a) => {
    requireOps(ctx);
    if (a.twinsPerBrand < 5 || a.twinsPerBrand > MAX_TWINS_SETTING) throw new SenderError(`twins per brand must be 5..${MAX_TWINS_SETTING}`);
    if (a.followersScraped < 20 || a.followersScraped > MAX_FOLLOWERS_SETTING) throw new SenderError(`followers scraped must be 20..${MAX_FOLLOWERS_SETTING}`);
    if (a.simTwins > MAX_TWINS_SETTING) throw new SenderError(`simulated twins must be 0..${MAX_TWINS_SETTING}`);
    if (!SCALE_MODES.includes(a.scaleMode)) throw new SenderError('scale mode must be linear or anchored');
    if (a.fillReplies > MAX_FILL_REPLIES) throw new SenderError(`extra replies must be 0..${MAX_FILL_REPLIES}`);
    const row = { key: 'global', ...a, updatedAt: ctx.timestamp };
    if (ctx.db.simSettings.key.find('global')) ctx.db.simSettings.key.update(row); else ctx.db.simSettings.insert(row);
  }
);

export const setVideoExpectation = spacetimedb.reducer(
  { videoId: t.string(), likeMin: t.u32(), likeMax: t.u32(), repostMin: t.u32(), repostMax: t.u32() },
  (ctx, a) => {
    requireOps(ctx);
    if (!ctx.db.campaignVideo.videoId.find(a.videoId)) throw new SenderError('unknown video');
    if (a.likeMin > a.likeMax || a.repostMin > a.repostMax) throw new SenderError('min must not exceed max');
    const row = { ...a, updatedAt: ctx.timestamp };
    if (ctx.db.videoExpectation.videoId.find(a.videoId)) ctx.db.videoExpectation.videoId.update(row);
    else ctx.db.videoExpectation.insert(row);
  }
);

export const clearVideoExpectation = spacetimedb.reducer({ videoId: t.string() }, (ctx, { videoId }) => {
  requireOps(ctx);
  ctx.db.videoExpectation.videoId.delete(videoId);
});

export const requestTwinTopup = spacetimedb.reducer({ brand: t.string(), count: t.u32() }, (ctx, a) => {
  requireOps(ctx);
  const brand = a.brand.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(brand)) throw new SenderError('invalid X handle');
  if (a.count < 1 || a.count > MAX_TWINS_SETTING) throw new SenderError(`count must be 1..${MAX_TWINS_SETTING}`);
  ctx.db.twinTopup.insert({ topupId: 0n, brand, count: a.count, status: 'queued', error: undefined,
                            createdAt: ctx.timestamp, updatedAt: ctx.timestamp } as Row<'twinTopup'>);
});

export const setTwinTopup = spacetimedb.reducer({ topupId: t.u64(), status: t.string(), error: t.string() }, (ctx, a) => {
  requireAdmin(ctx);
  if (a.status !== 'failed') notPaused(ctx);
  const row = ctx.db.twinTopup.topupId.find(a.topupId);
  if (!row) throw new SenderError('unknown top-up');
  if (!['running', 'done', 'failed'].includes(a.status)) throw new SenderError('bad status');
  if (a.status === 'running' && row.status !== 'queued') throw new SenderError('already claimed');
  ctx.db.twinTopup.topupId.update({ ...row, status: a.status, error: a.error ? a.error.slice(0, 300) : undefined, updatedAt: ctx.timestamp });
});

const PAUSED = 'Paused from ops';

// Worker writes (claims, progress, finishes) are refused while paused, so no worker anywhere keeps going.
function notPaused(ctx: Ctx) {
  if (ctx.db.opsState.key.find('global')?.paused) throw new SenderError('workers are paused from ops');
}

// Everything queued or in flight fails with a clear reason; resuming does not restart it (run it again).
function stopInFlight(ctx: Ctx) {
  const now = ctx.timestamp;
  for (const r of [...ctx.db.labExperiment.iter()]) {
    if (r.status === 'queued' || r.status === 'running') ctx.db.labExperiment.experimentId.update({ ...r, status: 'failed', error: PAUSED });
  }
  for (const r of [...ctx.db.onboarding.iter()]) {
    if (r.status !== 'ready' && r.status !== 'failed') ctx.db.onboarding.onboardingId.update({ ...r, status: 'failed', error: PAUSED, updatedAt: now });
  }
  for (const r of [...ctx.db.campaignVideo.iter()]) {
    if (r.status !== 'done' && r.status !== 'failed') ctx.db.campaignVideo.videoId.update({ ...r, status: 'failed', error: PAUSED, updatedAt: now });
  }
  for (const r of [...ctx.db.draftCopy.iter()]) {
    if (r.status === 'queued' || r.status === 'writing') ctx.db.draftCopy.copyId.update({ ...r, status: 'failed', error: PAUSED, updatedAt: now });
  }
  for (const r of [...ctx.db.twinTopup.iter()]) {
    if (r.status === 'queued' || r.status === 'running') ctx.db.twinTopup.topupId.update({ ...r, status: 'failed', error: PAUSED, updatedAt: now });
  }
  for (const r of [...ctx.db.creativeJob.iter()]) {
    if (r.status === 'pending' || r.status === 'running') ctx.db.creativeJob.jobId.update({ ...r, status: 'failed', error: PAUSED, finishedAt: now });
  }
}

export const setOpsState = spacetimedb.reducer({ paused: t.bool(), hidden: t.bool() }, (ctx, a) => {
  requireOps(ctx);
  const prev = ctx.db.opsState.key.find('global');
  const row = { key: 'global', paused: a.paused, hidden: a.hidden, updatedAt: ctx.timestamp };
  if (prev) ctx.db.opsState.key.update(row); else ctx.db.opsState.insert(row);
  if (a.paused && !prev?.paused) stopInFlight(ctx);
  if (a.hidden && !prev?.hidden) {
    ctx.db.opsHidden.key.delete('global');
    ctx.db.opsHidden.insert({ key: 'global', since: ctx.timestamp });
  }
  if (!a.hidden) ctx.db.opsHidden.key.delete('global');
});

// ---------- Purge one brand ----------
// Removes everything a brand left behind so it can be onboarded from zero: onboarding + ingestion/twin-build runs, its
// audience (followers shared with another brand are kept), posts, twins, graph, campaigns, Lab runs, videos, snapshots.
function purgeRuns(ctx: Ctx, runIds: Set<string>) {
  for (const r of [...ctx.db.simProb.iter()]) if (runIds.has(r.runId)) ctx.db.simProb.simProbId.delete(r.simProbId);
  for (const r of [...ctx.db.simNode.iter()]) if (runIds.has(r.runId)) ctx.db.simNode.simNodeId.delete(r.simNodeId);
  for (const r of [...ctx.db.cascadeReplay.iter()]) if (runIds.has(r.runId)) ctx.db.cascadeReplay.scheduledId.delete(r.scheduledId);
  for (const r of [...ctx.db.simSignalProb.iter()]) if (runIds.has(r.runId)) ctx.db.simSignalProb.simSignalProbId.delete(r.simSignalProbId);
  for (const r of [...ctx.db.simSignal.iter()]) if (runIds.has(r.runId)) ctx.db.simSignal.simSignalId.delete(r.simSignalId);
  for (const r of [...ctx.db.simNodeSignal.iter()]) if (runIds.has(r.runId)) ctx.db.simNodeSignal.simNodeSignalId.delete(r.simNodeSignalId);
  for (const r of [...ctx.db.simEvent.iter()]) if (runIds.has(r.runId)) ctx.db.simEvent.simEventId.delete(r.simEventId);
  for (const r of [...ctx.db.simSignalSource.iter()]) if (runIds.has(r.runId)) ctx.db.simSignalSource.simSignalSourceId.delete(r.simSignalSourceId);
  for (const r of [...ctx.db.simOutsideTick.iter()]) if (runIds.has(r.runId)) ctx.db.simOutsideTick.simOutsideTickId.delete(r.simOutsideTickId);
  for (const r of [...ctx.db.simComment.iter()]) if (runIds.has(r.runId)) ctx.db.simComment.simCommentId.delete(r.simCommentId);
  for (const id of runIds) { ctx.db.simProjection.runId.delete(id); ctx.db.simRun.runId.delete(id); }
}

function purgePosts(ctx: Ctx, authors: Set<string>) {
  const posts = new Set([...ctx.db.xPost.iter()].filter(p => authors.has(p.authorUserId)).map(p => p.postId));
  for (const r of [...ctx.db.xPostReference.iter()]) if (posts.has(r.postId)) ctx.db.xPostReference.id.delete(r.id);
  for (const r of [...ctx.db.xPostEntity.iter()]) if (posts.has(r.postId)) ctx.db.xPostEntity.entityId.delete(r.entityId);
  for (const r of [...ctx.db.xContextAnnotation.iter()]) if (posts.has(r.postId)) ctx.db.xContextAnnotation.annotationId.delete(r.annotationId);
  for (const r of [...ctx.db.xPostMedia.iter()]) if (posts.has(r.postId)) ctx.db.xPostMedia.id.delete(r.id);
  for (const id of posts) ctx.db.xPost.postId.delete(id);
}

function purgeCampaigns(ctx: Ctx, campaignIds: Set<string>) {
  for (const r of [...ctx.db.creativeBrief.iter()]) if (campaignIds.has(r.campaignId)) ctx.db.creativeBrief.briefId.delete(r.briefId);
  for (const r of [...ctx.db.adVariant.iter()]) if (campaignIds.has(r.campaignId)) ctx.db.adVariant.variantId.delete(r.variantId);
  for (const r of [...ctx.db.creativeJob.iter()]) if (campaignIds.has(r.campaignId)) ctx.db.creativeJob.jobId.delete(r.jobId);
  for (const r of [...ctx.db.campaignDraftVideo.iter()]) if (campaignIds.has(r.campaignId)) ctx.db.campaignDraftVideo.linkId.delete(r.linkId);
  for (const r of [...ctx.db.draftCopy.iter()]) if (campaignIds.has(r.campaignId)) ctx.db.draftCopy.copyId.delete(r.copyId);
  for (const id of campaignIds) { ctx.db.campaignFlow.campaignId.delete(id); ctx.db.campaign.campaignId.delete(id); }
}

export const purgeBrand = spacetimedb.reducer({ handle: t.string() }, (ctx, { handle }) => {
  requireAdmin(ctx);
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{1,64}$/.test(h)) throw new SenderError('invalid handle');
  if ([...ctx.db.onboarding.iter()].some(r => r.handle === h && !['ready', 'failed'].includes(r.status))) {
    throw new SenderError(`@${h} is still onboarding; wait or pause workers first`);
  }
  const brand = [...ctx.db.xUser.iter()].find(u => u.username.toLowerCase() === h);
  const B = brand?.userId ?? '';
  // Audience: drop this brand's links; a follower goes only if no other brand still has them.
  const people = new Set<string>();
  for (const r of [...ctx.db.audienceMembership.iter()]) if (r.brandUserId === B) { people.add(r.followerUserId); ctx.db.audienceMembership.membershipId.delete(r.membershipId); }
  for (const r of [...ctx.db.twinAudience.iter()]) if (r.brandUserId === B) { people.add(r.userId); ctx.db.twinAudience.twinAudienceId.delete(r.twinAudienceId); }
  for (const r of [...ctx.db.audienceEdge.iter()]) if (r.brandUserId === B) ctx.db.audienceEdge.edgeId.delete(r.edgeId);
  const stillUsed = new Set([...[...ctx.db.audienceMembership.iter()].map(r => r.followerUserId), ...[...ctx.db.twinAudience.iter()].map(r => r.userId),
                             ...[...ctx.db.audienceMembership.iter()].map(r => r.brandUserId)]);
  const gone = new Set([...people].filter(id => !stillUsed.has(id)));
  if (B && !stillUsed.has(B)) gone.add(B);
  for (const r of [...ctx.db.twinNiche.iter()]) if (gone.has(r.userId)) ctx.db.twinNiche.twinNicheId.delete(r.twinNicheId);
  purgePosts(ctx, gone);
  for (const id of gone) { ctx.db.twin.userId.delete(id); ctx.db.xUser.userId.delete(id); }
  if (B) ctx.db.archivedProfile.userId.delete(B);
  // Runs and jobs.
  for (const r of [...ctx.db.onboarding.iter()]) if (r.handle === h) ctx.db.onboarding.onboardingId.delete(r.onboardingId);
  for (const r of [...ctx.db.xIngestionRun.iter()]) if (r.targetUsername.toLowerCase() === h) ctx.db.xIngestionRun.ingestionRunId.delete(r.ingestionRunId);
  const builds = new Set([...ctx.db.twinBuildRun.iter()].filter(r => r.brandUserId === B).map(r => r.runId));
  for (const r of [...ctx.db.twinBuildJob.iter()]) if (builds.has(r.runId)) ctx.db.twinBuildJob.jobId.delete(r.jobId);
  for (const id of builds) ctx.db.twinBuildRun.runId.delete(id);
  // Lab, campaigns, videos, snapshots, brand settings.
  const experiments = [...ctx.db.labExperiment.iter()].filter(r => r.brand.toLowerCase() === h || (B && r.brandUserId === B));
  for (const e of experiments) {
    for (const d of ['A', 'B']) ctx.db.labDraftMedia.mediaId.delete(`${e.experimentId}:${d}`);
    ctx.db.labExperiment.experimentId.delete(e.experimentId);
  }
  purgeRuns(ctx, new Set([...ctx.db.simRun.iter()].filter(r => B && r.brandUserId === B).map(r => r.runId)));
  purgeCampaigns(ctx, new Set([...[...ctx.db.campaign.iter()].filter(r => B && r.brandUserId === B).map(r => r.campaignId),
                               ...[...ctx.db.campaignFlow.iter()].filter(r => r.brand.toLowerCase() === h).map(r => r.campaignId)]));
  for (const r of [...ctx.db.campaignVideo.iter()]) if (r.brand.toLowerCase() === h) { ctx.db.videoExpectation.videoId.delete(r.videoId); ctx.db.campaignVideo.videoId.delete(r.videoId); }
  for (const r of [...ctx.db.audienceSnapshot.iter()]) if (r.brand.toLowerCase() === h || (B && r.brandUserId === B)) ctx.db.audienceSnapshot.snapshotId.delete(r.snapshotId);
  if (B) { ctx.db.brandBaseline.brandUserId.delete(B); ctx.db.brandKit.brandUserId.delete(B); }
});

// Re-queue a failed creative job (same campaign, same owner) after its cause is fixed.
export const retryCreativeJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  requireAdmin(ctx);
  notPaused(ctx);
  const row = ctx.db.creativeJob.jobId.find(jobId);
  if (!row) throw new SenderError('unknown creative job');
  if (row.status !== 'failed') throw new SenderError(`job is ${row.status}, not failed`);
  ctx.db.creativeJob.jobId.update({ ...row, status: 'pending', claimedBy: undefined, claimedAt: undefined, error: undefined, finishedAt: undefined });
});

const MIN_VIDEO_SECONDS = 6;
const MAX_VIDEO_SECONDS = 60;
export const setVideoSettings = spacetimedb.reducer({ maxSeconds: t.u32(), voiceId: t.string() }, (ctx, a) => {
  requireOps(ctx);
  if (a.maxSeconds < MIN_VIDEO_SECONDS || a.maxSeconds > MAX_VIDEO_SECONDS) throw new SenderError(`length must be ${MIN_VIDEO_SECONDS}..${MAX_VIDEO_SECONDS} seconds`);
  const voiceId = a.voiceId.trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) throw new SenderError('voice id must be an ElevenLabs voice id (letters and digits)');
  const row = { key: 'global', maxSeconds: a.maxSeconds, voiceId, updatedAt: ctx.timestamp };
  if (ctx.db.videoSettings.key.find('global')) ctx.db.videoSettings.key.update(row); else ctx.db.videoSettings.insert(row);
});

export const setVideoMode = spacetimedb.reducer({ mode: t.string(), reuseA: t.string(), reuseB: t.string() }, (ctx, a) => {
  requireOps(ctx);
  if (!['generate', 'off', 'reuse'].includes(a.mode)) throw new SenderError('mode must be generate, off or reuse');
  for (const id of [a.reuseA, a.reuseB]) {
    if (id && ctx.db.campaignVideo.videoId.find(id)?.status !== 'done') throw new SenderError(`video ${id} is not a finished video`);
  }
  if (a.mode === 'reuse' && !a.reuseA) throw new SenderError('pick a video to reuse');
  const row = { key: 'global', mode: a.mode, reuseA: a.reuseA, reuseB: a.reuseB, updatedAt: ctx.timestamp };
  if (ctx.db.videoMode.key.find('global')) ctx.db.videoMode.key.update(row); else ctx.db.videoMode.insert(row);
});
