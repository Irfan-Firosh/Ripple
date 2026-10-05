// The campaign flow (Audience -> Campaign -> Lab -> Launch) talks to SpacetimeDB with ONE browser identity: the
// creative token Campaign Studio already uses, so the campaign, its Lab experiment and its video share an owner.
import { sql } from '../audience/liveAudience';
import { SNAPSHOT_VIEWER, STATIC_SNAPSHOT, assertLive } from '../snapshot';

const DB = 'https://maincloud.spacetimedb.com';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DATABASE || 'ripple-mhacks';
const URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
export const CREATIVE_TOKEN_KEY = `ripple-creative-token:${URI}:${DB_NAME}`;
export const MAX_POST = 280;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export type FlowStage = 'concepts' | 'testing' | 'approved' | 'shipped';
export type FlowRow = {
  campaign_id: string; brand: string; source: 'generate' | 'import'; stage: FlowStage; draft_a: string; draft_b: string;
  experiment_id: number; video_id: string; winner_text: string; created_at: number;
};
export type VideoRow = {
  video_id: string; status: string; progress: number; title: string; video_url: string; thumbnail_url: string;
  duration_s: number; error: string | null; script_json?: string;
};
export type ExperimentRow = { experiment_id: number; status: string; winner: '' | 'A' | 'B' | 'tie'; lift: number; draft_a: string; draft_b: string; error: string | null };
export type BrandPost = { post_id: string; text: string; like_count: number | null; created_at: string };

async function token(): Promise<string> {
  try { const saved = localStorage.getItem(CREATIVE_TOKEN_KEY); if (saved) return saved; } catch { /* Storage is optional. */ }
  const res = await fetch(`${DB}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create a SpacetimeDB identity.');
  const { token: fresh } = (await res.json()) as { token: string };
  try { localStorage.setItem(CREATIVE_TOKEN_KEY, fresh); } catch { /* Keep this session in memory. */ }
  return fresh;
}

export async function call(reducer: string, args: unknown[]): Promise<void> {
  assertLive();
  const res = await fetch(`${DB}/v1/database/${DB_NAME}/call/${reducer}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.replace(/^.*SenderError:?\s*/s, '').trim() || `Request failed (${res.status}).`);
  }
}

export async function brandUserId(handle: string, signal?: AbortSignal): Promise<string | null> {
  const rows = await sql<{ user_id: string; username: string }>(`SELECT user_id, username FROM x_user WHERE username = ${q(handle)}`, signal);
  return rows[0]?.user_id ?? null;
}

export async function recentPosts(userId: string, signal?: AbortSignal): Promise<BrandPost[]> {
  const rows = await sql<BrandPost>(`SELECT post_id, text, like_count, created_at FROM x_post WHERE author_user_id = ${q(userId)}`, signal);
  return rows.filter(p => p.text && !p.text.startsWith('RT @')).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
}

export async function flowRow(campaignId: string, signal?: AbortSignal): Promise<FlowRow | null> {
  return (await sql<FlowRow>(`SELECT * FROM campaign_flow WHERE campaign_id = ${q(campaignId)}`, signal))[0] ?? null;
}

export async function videoRow(videoId: string, signal?: AbortSignal): Promise<VideoRow | null> {
  if (!videoId) return null;
  return (await sql<VideoRow>(`SELECT * FROM campaign_video WHERE video_id = ${q(videoId)}`, signal))[0] ?? null;
}

export async function experimentRow(id: number, signal?: AbortSignal): Promise<ExperimentRow | null> {
  if (!id) return null;
  return (await sql<ExperimentRow>(`SELECT * FROM lab_experiment WHERE experiment_id = ${id}`, signal))[0] ?? null;
}

/** Video for the campaign: the newest one this campaign requested (the worker names it). */
export async function campaignVideo(campaignId: string, signal?: AbortSignal): Promise<VideoRow | null> {
  const rows = await sql<VideoRow & { created_at: number }>(`SELECT * FROM campaign_video WHERE campaign_id = ${q(campaignId)}`, signal);
  return rows.sort((a, b) => Number(b.created_at) - Number(a.created_at))[0] ?? null;
}

/** Queue A vs B in the Lab and return the new experiment's id (same reducer the Lab composer uses). */
export async function testInLab(brand: string, title: string, draftA: string, draftB: string): Promise<number> {
  const query = `SELECT experiment_id, draft_a, draft_b FROM lab_experiment WHERE brand = ${q(brand)}`;
  const before = new Set((await sql<{ experiment_id: number }>(query)).map(r => Number(r.experiment_id)));
  await call('request_lab_experiment', [brand, title.slice(0, 80), draftA, draftB]);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await sql<{ experiment_id: number; draft_a: string; draft_b: string }>(query);
    const mine = rows.filter(r => !before.has(Number(r.experiment_id)) && r.draft_a === draftA && r.draft_b === draftB);
    if (mine.length) return Math.max(...mine.map(r => Number(r.experiment_id)));
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('The Lab accepted the test but it has not appeared yet. Open the Lab to watch it.');
}

export const tweetText = (headline: string, cta: string) => [headline.trim(), cta.trim()].filter(Boolean).join('\n\n').slice(0, MAX_POST);

/** "Ship to X": X's own compose window with the post prefilled (no API keys needed; the user attaches the video). */
export const shipIntent = (text: string) => `https://x.com/intent/post?${new URLSearchParams({ text })}`;

export type Draft = 'A' | 'B';
export type DraftVideos = Record<Draft, VideoRow | null>;
export type ScriptBeat = { on_screen: string; voiceover: string };

/** Each draft's own video (campaign_draft_video -> campaign_video). Edits move the link to the newest version. */
export async function draftVideos(campaignId: string, signal?: AbortSignal): Promise<DraftVideos> {
  const links = await sql<{ draft: Draft; video_id: string }>(`SELECT draft, video_id FROM campaign_draft_video WHERE campaign_id = ${q(campaignId)}`, signal);
  const out: DraftVideos = { A: null, B: null };
  await Promise.all(links.map(async l => { out[l.draft] = await videoRow(l.video_id, signal); }));
  return out;
}

export const requestDraftVideo = (campaignId: string, draft: Draft, post: string, goal = 'reach') =>
  call('request_draft_video', [campaignId, draft, post.slice(0, 600), goal]);

export const requestVideoEdit = (parentId: string, instruction: string, beats: ScriptBeat[]) =>
  call('request_video_edit', [parentId, instruction.slice(0, 600), beats.length ? JSON.stringify(beats) : '']);

/** The film's script (from the brief Opus wrote), for the editor. */
export function scriptOf(video: VideoRow & { script_json?: string }): ScriptBeat[] {
  try {
    const brief = JSON.parse(video.script_json || '{}') as { beats?: ScriptBeat[] };
    return (brief.beats ?? []).map(b => ({ on_screen: b.on_screen, voiceover: b.voiceover }));
  } catch { return []; }
}

export type DraftCopyRow = { draft: Draft; headline: string; text: string; status: 'queued' | 'writing' | 'done' | 'failed' };
export type DraftCopies = Record<Draft, DraftCopyRow | null>;

/** The real tweet for each generated draft, written in the brand's voice (draft_copy, filled by our worker). */
export async function draftCopies(campaignId: string, signal?: AbortSignal): Promise<DraftCopies> {
  const rows = await sql<DraftCopyRow>(`SELECT draft, headline, text, status FROM draft_copy WHERE campaign_id = ${q(campaignId)}`, signal);
  return { A: rows.find(r => r.draft === 'A') ?? null, B: rows.find(r => r.draft === 'B') ?? null };
}

export const requestDraftCopy = (campaignId: string, draft: Draft, headline: string) =>
  call('request_draft_copy', [campaignId, draft, headline.slice(0, 200)]);

// The hex identity of this browser's creative token (SpacetimeDB tokens are JWTs carrying `hex_identity`).
export async function myIdentity(): Promise<string> {
  if (STATIC_SNAPSHOT) return SNAPSHOT_VIEWER;
  const payload = (await token()).split('.')[1] ?? '';
  const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { hex_identity?: string };
  return json.hex_identity ?? '';
}

// /ops demo switch: Generate replays the brand's last finished campaign instead of running the agents.
export async function campaignReplayOn(): Promise<boolean> {
  const rows = await sql<{ campaign_replay: boolean }>("SELECT * FROM demo_settings WHERE key = 'global'").catch(() => []);
  return Boolean(rows[0]?.campaign_replay);
}
