// SPIKE (throwaway): store X posts fetched via Grok x_search in SpacetimeDB.
import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  x_post: table(
    { public: true },
    {
      post_id: t.string().primaryKey(),
      post_url: t.string(),
      author_handle: t.string(),
      text: t.string(),
      created_at: t.string().optional(),
      likes: t.u32().optional(),
      reposts: t.u32().optional(),
      replies: t.u32().optional(),
      quotes: t.u32().optional(),
      views: t.u32().optional(),
      parent_url: t.string().optional(),
      topic: t.string(),
    }
  ),
});
export default spacetimedb;

export const upsertPost = spacetimedb.reducer(
  {
    post_id: t.string(),
    post_url: t.string(),
    author_handle: t.string(),
    text: t.string(),
    created_at: t.string().optional(),
    likes: t.u32().optional(),
    reposts: t.u32().optional(),
    replies: t.u32().optional(),
    quotes: t.u32().optional(),
    views: t.u32().optional(),
    parent_url: t.string().optional(),
    topic: t.string(),
  },
  (ctx, args) => {
    const row = {
      ...args,
      created_at: args.created_at,
      likes: args.likes,
      reposts: args.reposts,
      replies: args.replies,
      quotes: args.quotes,
      views: args.views,
      parent_url: args.parent_url,
    };
    if (ctx.db.x_post.post_id.find(row.post_id)) {
      ctx.db.x_post.post_id.update(row);
    } else {
      ctx.db.x_post.insert(row);
    }
  }
);
