// Reads the real Ripple audience (twins, niches, profile pictures) from SpacetimeDB over its public SQL API.
// CORS on Maincloud allows browser reads, so no backend is needed.
const STDB_SQL = 'https://maincloud.spacetimedb.com/v1/database/ripple-mhacks/sql';

type AlgebraicType = Record<string, any>;
type Statement = { schema: { elements: { name: { some: string }; algebraic_type: AlgebraicType }[] }; rows: unknown[][] };

export type AudienceNiche = { slug: string; label: string; affinity: number };
export type Platform = 'x' | 'bluesky';
// Brands whose audiences have been scraped and twinned. maxNiches caps the niche groups drawn on the dashboard.
export const BRANDS = [
  { handle: 'spacetimedb', label: '@spacetimedb', platform: 'x' as Platform, maxNiches: 5 },
  { handle: 'raycast.com', label: 'Raycast', platform: 'bluesky' as Platform, maxNiches: 7 },
] as const;
export type BrandHandle = (typeof BRANDS)[number]['handle'];

// Bluesky handles are domains (alice.bsky.social) and its ids are DIDs; X handles have no dots.
export const platformOf = (userId: string, handle: string): Platform =>
  userId.startsWith('did:') || handle.includes('.') ? 'bluesky' : 'x';
export const profileUrl = (userId: string, handle: string): string =>
  platformOf(userId, handle) === 'bluesky' ? `https://bsky.app/profile/${handle}` : `https://x.com/${handle}`;
export type AudienceMember = {
  userId: string; username: string; name: string; avatar: string; followers: number; profileUrl: string;
  postCount: number; engagementRate: number; replyShare: number;
  tone: string; personaSummary: string; hotButtons: string[];
  niches: AudienceNiche[]; primaryNiche: string;
};
export type Audience = {
  brand: { userId: string; username: string; name: string; avatar: string; platform: Platform };
  members: AudienceMember[];
  niches: { slug: string; label: string }[];
  links: [string, string][]; // real reply/mention links between audience members
};

function decode(value: unknown, ty: AlgebraicType): unknown {
  if (ty.Sum) {
    const names = ty.Sum.variants.map((v: any) => v.name?.some);
    if (names[0] === 'some' && names[1] === 'none') {
      const [tag, inner] = value as [number, unknown];
      return tag === 0 ? decode(inner, ty.Sum.variants[0].algebraic_type) : null;
    }
    return value;
  }
  if (ty.Product) {
    const els = ty.Product.elements;
    if (els.length === 1 && els[0].name?.some === '__timestamp_micros_since_unix_epoch__') return (value as unknown[])[0];
    return Object.fromEntries(els.map((e: any, i: number) => [e.name?.some, decode((value as unknown[])[i], e.algebraic_type)]));
  }
  if (ty.Array) {
    if (typeof value === 'string' && ty.Array.U8) return value.match(/../g)?.map(h => parseInt(h, 16)) ?? []; // array<u8> arrives hex-encoded
    return (value as unknown[]).map(v => decode(v, ty.Array));
  }
  return value;
}

export async function sql<T = Record<string, any>>(query: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(STDB_SQL, { method: 'POST', body: query, signal });
  if (!res.ok) throw new Error(`SpacetimeDB returned ${res.status} for: ${query}`);
  const statements = (await res.json()) as Statement[];
  return statements.flatMap(s => s.rows.map(row => Object.fromEntries(
    s.schema.elements.map((e, i) => [e.name.some, decode(row[i], e.algebraic_type)])) as T));
}

const biggerAvatar = (url: string | null) => (url ?? '').replace('_normal.', '_200x200.');

export async function loadAudience(brandHandle: string, signal?: AbortSignal): Promise<Audience> {
  const [nicheRows, twins, twinNiches, users, links, posts, mentions] = await Promise.all([
    sql('SELECT * FROM niche', signal),
    sql('SELECT * FROM twin', signal),
    sql('SELECT user_id, niche, affinity FROM twin_niche', signal),
    sql('SELECT user_id, username, name, profile_image_url, followers_count FROM x_user', signal),
    sql('SELECT brand_user_id, user_id FROM twin_audience', signal),
    sql('SELECT post_id, author_user_id, in_reply_to_user_id FROM x_post', signal),
    sql("SELECT post_id, mentioned_user_id FROM x_post_entity WHERE entity_type = 'mention'", signal),
  ]);
  const labels = new Map(nicheRows.map(n => [n.slug as string, n.label as string]));
  const userById = new Map(users.map(u => [u.user_id as string, u]));
  const brandUser = users.find(u => String(u.username).toLowerCase() === brandHandle.toLowerCase());
  if (!brandUser) throw new Error(`@${brandHandle} has not been scraped into SpacetimeDB yet.`);
  const inBrand = new Set(links.filter(l => l.brand_user_id === brandUser.user_id).map(l => l.user_id as string));
  if (!inBrand.size) throw new Error(`No twins have been built for @${brandHandle} yet. Run: python -m twins build --brand ${brandHandle}`);

  const nichesByUser = new Map<string, AudienceNiche[]>();
  for (const r of twinNiches) {
    const list = nichesByUser.get(r.user_id) ?? [];
    list.push({ slug: r.niche, label: labels.get(r.niche) ?? r.niche, affinity: r.affinity });
    nichesByUser.set(r.user_id, list);
  }
  const members: AudienceMember[] = twins.filter(t => inBrand.has(t.user_id)).map(t => {
    const u = userById.get(t.user_id);
    const niches = (nichesByUser.get(t.user_id) ?? []).sort((a, b) => b.affinity - a.affinity);
    return {
      userId: t.user_id, username: t.username, name: u?.name ?? t.username, avatar: biggerAvatar(u?.profile_image_url),
      followers: u?.followers_count ?? 0, profileUrl: profileUrl(t.user_id, t.username),
      postCount: t.post_count, engagementRate: t.engagement_rate,
      replyShare: t.reply_share, tone: t.tone, personaSummary: t.persona_summary, hotButtons: t.hot_buttons ?? [],
      niches, primaryNiche: niches[0]?.slug ?? 'other',
    };
  });

  const inAudience = new Set(members.map(m => m.userId));
  const authorOf = new Map(posts.map(p => [p.post_id as string, p.author_user_id as string]));
  const pairs = new Set<string>();
  const addPair = (a?: string | null, b?: string | null) => {
    if (a && b && a !== b && inAudience.has(a) && inAudience.has(b)) pairs.add([a, b].sort().join('|'));
  };
  for (const p of posts) addPair(p.author_user_id, p.in_reply_to_user_id);
  for (const m of mentions) addPair(authorOf.get(m.post_id), m.mentioned_user_id);

  return {
    brand: {
      userId: brandUser.user_id, username: brandUser.username, name: brandUser.name,
      avatar: biggerAvatar(brandUser.profile_image_url), platform: platformOf(brandUser.user_id, brandUser.username),
    },
    members,
    niches: nicheRows.map(n => ({ slug: n.slug, label: n.label })),
    links: [...pairs].map(p => p.split('|') as [string, string]),
  };
}
