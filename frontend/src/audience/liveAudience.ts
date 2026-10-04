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
  pending?: boolean;
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

async function rawSql<T = Record<string, any>>(query: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(STDB_SQL, { method: 'POST', body: query, signal });
  if (!res.ok) throw new Error(`SpacetimeDB returned ${res.status} for: ${query}`);
  const statements = (await res.json()) as Statement[];
  return statements.flatMap(s => s.rows.map(row => Object.fromEntries(
    s.schema.elements.map((e, i) => [e.name.some, decode(row[i], e.algebraic_type)])) as T));
}

// Hide from /ops = a clean slate for demos: while ops_hidden exists, rows created before its `since` are dropped from
// every read, and brand audiences only show for brands onboarded after it. Nothing is deleted; unhide restores all.
type Cutoff = { since: number; brands: Set<string> } | null;
const CUTOFF_TTL_MS = 10_000;
const CREATED: Record<string, string> = {
  campaign_flow: 'created_at', lab_experiment: 'created_at', campaign: 'created_at', campaign_video: 'created_at',
  onboarding: 'created_at', audience_snapshot: 'created_at',
};
const BRAND_KEYED = new Set(['twin_audience', 'audience_membership', 'audience_edge']);
const micros = (v: unknown) => { const n = Number(v); return n >= 1e14 ? n : n * 1000; }; // u64 ms columns vs timestamps
let cutoff: { at: number; value: Promise<Cutoff> } | null = null;

function loadCutoff(): Promise<Cutoff> {
  if (cutoff && Date.now() - cutoff.at < CUTOFF_TTL_MS) return cutoff.value;
  const value = (async (): Promise<Cutoff> => {
    const rows = await rawSql<{ since: number }>("SELECT * FROM ops_hidden WHERE key = 'global'");
    if (!rows[0]) return null;
    const since = micros(rows[0].since);
    const onboarded = await rawSql<{ brand_user_id: string; created_at: number }>('SELECT brand_user_id, created_at FROM onboarding');
    return { since, brands: new Set(onboarded.filter(r => r.brand_user_id && micros(r.created_at) >= since).map(r => r.brand_user_id)) };
  })().catch(() => null); // an unreachable flag never hides anything
  cutoff = { at: Date.now(), value };
  return value;
}

// Reads that ignore /ops Hide (the ops page itself must see everything).
export const sqlUnfiltered = rawSql;

// True while /ops Hide is on (clean slate): pages use it to show a friendly empty state instead of an error.
export async function cleanSlate(): Promise<boolean> {
  return (await loadCutoff()) !== null;
}

export async function sql<T = Record<string, any>>(query: string, signal?: AbortSignal): Promise<T[]> {
  const [rows, hide] = await Promise.all([rawSql<T>(query, signal), loadCutoff()]);
  const table = query.match(/FROM\s+(\w+)/i)?.[1]?.toLowerCase() ?? '';
  // Lists are filtered; a lookup of one row by its id (e.g. a video reused for a demo) is not.
  const lookup = /WHERE\s+(video_id|campaign_id|experiment_id|snapshot_id|onboarding_id)\s*=/i.test(query);
  if (!hide || (!CREATED[table] && !BRAND_KEYED.has(table))) return rows;
  return rows.filter(row => {
    const r = row as Record<string, unknown>;
    if (CREATED[table] && r[CREATED[table]] != null) return lookup || micros(r[CREATED[table]]) >= hide.since;
    if (BRAND_KEYED.has(table) && r.brand_user_id != null) return hide.brands.has(String(r.brand_user_id));
    return true;
  });
}

// Stable small hash: the same person always lands in the same niche with the same links.
function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

const PLACEHOLDER_LINKS = 2; // links inside the niche per placeholder person (1..this)
const CROSS_NICHE_SHARE = 8; // 1 in this many also links into another niche (keeps inter-cluster relations)

function placeholderLinks(placeholders: AudienceMember[], members: AudienceMember[], addPair: (a: string, b: string) => void) {
  const byNiche = new Map<string, AudienceMember[]>();
  for (const m of members) byNiche.set(m.primaryNiche, [...(byNiche.get(m.primaryNiche) ?? []), m]);
  for (const p of placeholders) {
    const same = (byNiche.get(p.primaryNiche) ?? []).filter(m => m.userId !== p.userId);
    const count = 1 + (seeded(`${p.userId}:n`) % PLACEHOLDER_LINKS);
    for (let i = 0; i < count && same.length; i++) addPair(p.userId, same[seeded(`${p.userId}:${i}`) % same.length].userId);
    if (seeded(`${p.userId}:x`) % CROSS_NICHE_SHARE === 0) {
      const other = members.filter(m => m.primaryNiche !== p.primaryNiche);
      if (other.length) addPair(p.userId, other[seeded(`${p.userId}:o`) % other.length].userId);
    }
  }
}

const biggerAvatar = (url: string | null) => (url ?? '').replace('_normal.', '_200x200.');

async function archivedAudience(brand: string, signal: AbortSignal | undefined, error: string): Promise<Audience> {
  const safe = `'${brand.replace(/'/g, "''")}'`;
  const versions = await sql<{ payload: string; created_at: number }>(`SELECT payload, created_at FROM audience_snapshot WHERE brand = ${safe}`, signal);
  const latest = versions.sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];
  if (!latest) throw new Error(error);
  return JSON.parse(latest.payload) as Audience;
}

export async function loadAudience(brandHandle: string, signal?: AbortSignal, includeScraped = false): Promise<Audience> {
  const [nicheRows, twins, twinNiches, users, links, posts, mentions, memberships] = await Promise.all([
    sql('SELECT * FROM niche', signal),
    sql('SELECT * FROM twin', signal),
    sql('SELECT user_id, niche, affinity FROM twin_niche', signal),
    sql('SELECT user_id, username, name, profile_image_url, followers_count, post_count, description FROM x_user', signal),
    sql('SELECT brand_user_id, user_id FROM twin_audience', signal),
    sql('SELECT post_id, author_user_id, in_reply_to_user_id FROM x_post', signal),
    sql("SELECT post_id, mentioned_user_id FROM x_post_entity WHERE entity_type = 'mention'", signal),
    includeScraped ? sql('SELECT brand_user_id, follower_user_id FROM audience_membership', signal) : Promise.resolve([]),
  ]);
  const labels = new Map(nicheRows.map(n => [n.slug as string, n.label as string]));
  const userById = new Map(users.map(u => [u.user_id as string, u]));
  const brandUser = users.find(u => String(u.username).toLowerCase() === brandHandle.toLowerCase());
  if (!brandUser) {
    const message = `@${brandHandle} has not been scraped into SpacetimeDB yet.`;
    if (!includeScraped) return archivedAudience(brandHandle, signal, message);
    throw new Error(message);
  }
  const inBrand = new Set(links.filter(l => l.brand_user_id === brandUser.user_id).map(l => l.user_id as string));
  if (includeScraped) memberships.filter(r => r.brand_user_id === brandUser.user_id).forEach(r => inBrand.add(r.follower_user_id));
  if (!inBrand.size) {
    const message = `No followers have been scraped for @${brandHandle} yet.`;
    if (!includeScraped) return archivedAudience(brandHandle, signal, message);
    throw new Error(message);
  }

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
  // Proof of concept: followers scraped but not analysed yet are placed into the real niches (weighted by niche size,
  // fixed per person) instead of one "still building" cluster, and get a few links (see placeholderLinks below).
  const placeholders: AudienceMember[] = [];
  if (includeScraped) {
    const built = new Set(members.map(m => m.userId));
    const sizes = new Map<string, number>();
    for (const m of members) if (m.primaryNiche !== 'other') sizes.set(m.primaryNiche, (sizes.get(m.primaryNiche) ?? 0) + 1);
    const pool = sizes.size ? [...sizes].flatMap(([slug, n]) => Array<string>(n).fill(slug))
      : nicheRows.map(n => n.slug).filter(slug => slug !== 'other').slice(0, 5);
    for (const id of inBrand) {
      const u = userById.get(id); if (!u || built.has(id)) continue;
      const slug = pool.length ? pool[seeded(id) % pool.length] : 'other';
      const member: AudienceMember = { userId: id, username: u.username, name: u.name, avatar: biggerAvatar(u.profile_image_url), followers: u.followers_count ?? 0,
        profileUrl: profileUrl(id, u.username), postCount: u.post_count ?? 0, engagementRate: 0, replyShare: 0, tone: '', personaSummary: u.description ?? '', hotButtons: [],
        niches: [{ slug, label: labels.get(slug) ?? slug, affinity: 0.5 + (seeded(`${id}:a`) % 40) / 100 }], primaryNiche: slug, pending: true };
      members.push(member);
      placeholders.push(member);
    }
  }

  const inAudience = new Set(members.map(m => m.userId));
  const authorOf = new Map(posts.map(p => [p.post_id as string, p.author_user_id as string]));
  const pairs = new Set<string>();
  const addPair = (a?: string | null, b?: string | null) => {
    if (a && b && a !== b && inAudience.has(a) && inAudience.has(b)) pairs.add([a, b].sort().join('|'));
  };
  for (const p of posts) addPair(p.author_user_id, p.in_reply_to_user_id);
  for (const m of mentions) addPair(authorOf.get(m.post_id), m.mentioned_user_id);
  placeholderLinks(placeholders, members, addPair);

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
