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

const spacetimedb = schema({
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
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
// Reducer args mark option fields as `?:`; table rows want them present (possibly undefined).
type Row<K extends keyof Ctx['db']> = Ctx['db'][K] extends { insert(row: infer R): unknown } ? R : never;

// Tables are public to read; only the publisher (and identities it adds) can write.
function requireAdmin(ctx: Ctx) {
  if (!ctx.db.admin.identity.find(ctx.sender)) throw new SenderError('not authorized');
}

const RUN_STATUSES = ['pending', 'running', 'completed', 'partial', 'failed'];

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
type Calib = { feedReach: number; shareReach: number; scale: SignalP };
type TrialEvent = { userId: string; signal: Signal; tick: number };

function calibrationFor(ctx: Ctx, brandUserId: string): Calib {
  const row = ctx.db.simCalibration.scope.find(brandUserId) ?? ctx.db.simCalibration.scope.find('default');
  if (!row) return { feedReach: FEED_REACH, shareReach: SHARE_REACH, scale: { like: 1, repost: 1, reply: 1, quote: 1 } };
  return { feedReach: row.feedReach, shareReach: row.shareReach,
           scale: { like: row.likeScale, repost: row.repostScale, reply: row.replyScale, quote: row.quoteScale } };
}

// One independent-cascade trial. Seeing the post = a chance to act on each signal independently;
// only reposts and quotes put the post in front of the actor's neighbours (Bluesky: likes don't spread).
function signalTrial(rand: Rng, ids: string[], p: Map<string, SignalP>, adj: Map<string, string[]>, cal: Calib,
                     record?: { seen: Map<string, number>; events: TrialEvent[] }) {
  const seen = new Set<string>();
  const acted = new Map<string, Set<Signal>>();
  const counts: SignalP = { like: 0, repost: 0, reply: 0, quote: 0 };
  let tick = 0;
  const expose = (id: string, chance: number, next: string[]) => {
    if (seen.has(id) || rand() >= chance) return;
    seen.add(id); record?.seen.set(id, tick);
    const pr = p.get(id);
    if (!pr) return;
    let spreads = false;
    for (const s of SIGNALS) {
      if (rand() >= pr[s]) continue;
      counts[s] += 1;
      const mine = acted.get(id) ?? new Set<Signal>();
      mine.add(s); acted.set(id, mine);
      record?.events.push({ userId: id, signal: s, tick });
      if (s === 'repost' || s === 'quote') spreads = true;
    }
    if (spreads) next.push(id);
  };
  let frontier: string[] = [];
  for (const id of ids) expose(id, cal.feedReach, frontier);
  while (frontier.length) {
    tick += 1;
    const next: string[] = [];
    for (const u of frontier) for (const v of adj.get(u) ?? []) expose(v, cal.shareReach, next);
    frontier = next;
  }
  return { seen, acted, counts, lastTick: tick };
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

export const startCascade = spacetimedb.reducer(
  { runId: t.string(), trials: t.u32() },
  (ctx, { runId, trials }) => {
    requireAdmin(ctx);
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
    const cal = calibrationFor(ctx, run.brandUserId);
    // Per-signal probabilities when the policy sent them; otherwise the legacy single p_engage spreads like a repost.
    const p = new Map<string, SignalP>();
    for (const pr of probs) {
      const sp = ctx.db.simSignalProb.simSignalProbId.find(`${runId}:${pr.userId}`);
      const raw: SignalP = sp ? { like: sp.pLike, repost: sp.pRepost, reply: sp.pReply, quote: sp.pQuote }
                              : { like: 0, repost: pr.pEngage, reply: 0, quote: 0 };
      p.set(pr.userId, sp ? {
        like: Math.min(1, raw.like * cal.scale.like), repost: Math.min(1, raw.repost * cal.scale.repost),
        reply: Math.min(1, raw.reply * cal.scale.reply), quote: Math.min(1, raw.quote * cal.scale.quote),
      } : raw);
    }
    const rand: Rng = () => ctx.random();
    const engagedCount = new Map<string, number>(), seenCount = new Map<string, number>();
    const signalCount = new Map<string, SignalP>();
    const reach: number[] = [], seenTotals: number[] = [];
    const perSignal: Record<Signal, number[]> = { like: [], repost: [], reply: [], quote: [] };
    const replay = { seen: new Map<string, number>(), events: [] as TrialEvent[] };
    let replayMaxTick = 0;
    for (let trial = 0; trial < n; trial++) {
      const r = signalTrial(rand, ids, p, adj, cal, trial === 0 ? replay : undefined);
      reach.push(r.acted.size); seenTotals.push(r.seen.size);
      for (const s of SIGNALS) perSignal[s].push(r.counts[s]);
      for (const id of r.seen) seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
      for (const [id, acts] of r.acted) {
        engagedCount.set(id, (engagedCount.get(id) ?? 0) + 1);
        const c = signalCount.get(id) ?? { like: 0, repost: 0, reply: 0, quote: 0 };
        for (const s of acts) c[s] += 1;
        signalCount.set(id, c);
      }
      if (trial === 0) replayMaxTick = r.lastTick;
    }
    reach.sort((a, b) => a - b); seenTotals.sort((a, b) => a - b);
    const firstAct = new Map<string, number>();
    for (const e of replay.events) if (!firstAct.has(e.userId)) firstAct.set(e.userId, e.tick);
    for (const id of ids) {
      const c = signalCount.get(id) ?? { like: 0, repost: 0, reply: 0, quote: 0 };
      ctx.db.simNode.insert({
        simNodeId: `${runId}:${id}`, runId, userId: id,
        engagedShare: (engagedCount.get(id) ?? 0) / n, seenShare: (seenCount.get(id) ?? 0) / n,
        replaySeenTick: replay.seen.get(id), replayEngagedTick: firstAct.get(id),
      } as Row<'simNode'>);
      ctx.db.simNodeSignal.insert({
        simNodeSignalId: `${runId}:${id}`, runId, userId: id,
        likeShare: c.like / n, repostShare: c.repost / n, replyShare: c.reply / n, quoteShare: c.quote / n,
      });
    }
    for (const s of SIGNALS) {
      const xs = perSignal[s].sort((a, b) => a - b);
      ctx.db.simSignal.insert({
        simSignalId: `${runId}:${s}`, runId, signal: s,
        p10: percentile(xs, 0.1), p50: percentile(xs, 0.5), p90: percentile(xs, 0.9),
        mean: xs.reduce((a, b) => a + b, 0) / n,
      });
    }
    for (const e of replay.events) {
      ctx.db.simEvent.insert({ simEventId: `${runId}:${e.userId}:${e.signal}`, runId, userId: e.userId, signal: e.signal, tick: e.tick });
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
