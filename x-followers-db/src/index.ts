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
  profileBannerUrl: str(),
  protected: bool(),
  verified: bool(),
  verifiedType: str(),
  isIdentityVerified: bool(),
  followersCount: u64(),
  followingCount: u64(),
  listedCount: u64(),
  postCount: u64(),
  likeCount: u64(),
  mediaCount: u64(),
  pinnedPostId: str(),
  mostRecentPostId: str(),
};

const xPostFields = {
  postId: t.string(),
  authorUserId: t.string(),
  text: t.string(),
  createdAt: t.string(),
  lang: str(),
  conversationId: str(),
  inReplyToUserId: str(),
  isReply: t.bool(),
  isQuote: t.bool(),
  isRepost: t.bool(),
  replySettings: str(),
  possiblySensitive: bool(),
  source: str(),
  communityId: str(),
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
  referenceType: t.string(), // replied_to | quoted | retweeted, as returned by X
};

const postEntityFields = {
  postId: t.string(),
  entityType: t.string(), // hashtag | cashtag | mention | url
  value: t.string(),
  startOffset: t.u32(),
  endOffset: t.u32(),
  mentionedUserId: str(),
  mentionedUsername: str(),
  url: str(),
  expandedUrl: str(),
  displayUrl: str(),
  title: str(),
  description: str(),
};

const contextAnnotationFields = {
  postId: t.string(),
  domainId: t.string(),
  domainName: t.string(),
  domainDescription: str(),
  entityIdFromX: t.string(),
  entityName: t.string(),
  entityDescription: str(),
};

const postMediaFields = {
  postId: t.string(),
  mediaKey: t.string(),
  type: t.string(),
  url: str(),
  previewImageUrl: str(),
  width: t.option(t.u32()),
  height: t.option(t.u32()),
  durationMs: u64(),
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
  paginationCursor: str(),
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
      paginationCursor: undefined,
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
    ctx.db.xUser.userId.update({ ...user, ingestedAt: existing.ingestedAt, updatedAt: ctx.timestamp } as Row<'xUser'>);
  } else {
    ctx.db.xUser.insert({ ...user, ingestedAt: ctx.timestamp, updatedAt: ctx.timestamp } as Row<'xUser'>);
  }
});

export const upsertAudienceMembership = spacetimedb.reducer(
  { brandUserId: t.string(), followerUserId: t.string(), ingestionRunId: t.string() },
  (ctx, { brandUserId, followerUserId, ingestionRunId }) => {
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
