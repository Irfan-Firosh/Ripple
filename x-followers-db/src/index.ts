// Raw X API data only. Persona/AI-inferred data belongs in separate tables.
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

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
