import { useEffect, useState } from 'react';
import { sql } from '../audience/liveAudience';
import { assertLive } from '../snapshot';

const BASE = 'https://maincloud.spacetimedb.com';
const TOKEN_KEY = 'ripple-onboarding-token';
export type Goal = 'reposts' | 'likes' | 'replies' | 'views';
export type Status = 'queued' | 'scraping' | 'twins' | 'graph' | 'ready' | 'failed';
export type OnboardingRow = {
  onboarding_id: number; handle: string; brand_user_id: string; status: Status;
  ingestion_run_id: string; twin_run_id: string; owner_name: string; role: string;
  campaign_name: string; campaign_news: string; goal: string; error: string | null;
};
export type Brief = { name: string; role: string; campaign: string; news: string; goal: Goal | null };
type Profile = { user_id: string; username: string; name?: string; profile_image_url: string | null };
type Ingestion = { followers_discovered: number };
type Twins = { requested: number; ready: number; failed: number };
export type BuildSnapshot = { row: OnboardingRow; followers: number; requested: number; ready: number; brand: Profile | null; avatars: Profile[] };
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
export const normalizeHandle = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

let identity: Promise<string> | null = null;
export async function onboardingToken(): Promise<string> {
  try { const saved = localStorage.getItem(TOKEN_KEY); if (saved) return saved; } catch { /* Optional storage. */ }
  if (!identity) identity = (async () => {
    const response = await fetch(`${BASE}/v1/identity`, { method: 'POST' });
    if (!response.ok) throw new Error('Could not connect. Try again.');
    const data = await response.json() as { token: string };
    try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* Keep this session in memory. */ }
    return data.token;
  })().catch(error => { identity = null; throw error; });
  return identity;
}

async function call(reducer: string, args: (string | number)[]): Promise<void> {
  assertLive();
  const response = await fetch(`${BASE}/v1/database/ripple-mhacks/call/${reducer}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await onboardingToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.replace(/^.*SenderError:?\s*/s, '').trim() || `Request failed (${response.status}).`);
  }
}

export const requestOnboarding = (handle: string) => call('request_onboarding', [normalizeHandle(handle)]);
export function updateBrief(id: number, brief: Brief): Promise<void> {
  if (!brief.goal) return Promise.reject(new Error('Choose a goal.'));
  return call('update_onboarding_brief', [id, brief.name.trim(), brief.role.trim(), brief.campaign.trim(), brief.news.trim(), brief.goal]);
}
export async function findOnboarding(handle: string): Promise<OnboardingRow> {
  const rows = await sql<OnboardingRow>(`SELECT * FROM onboarding WHERE handle = ${quote(normalizeHandle(handle))}`);
  const row = rows.sort((a, b) => Number(b.onboarding_id) - Number(a.onboarding_id))[0];
  if (!row) throw new Error('Could not read your build. Try again.');
  return row;
}

async function followerAvatars(id: string, signal: AbortSignal, previous?: BuildSnapshot): Promise<Profile[]> {
  if (!id) return [];
  if (previous?.row.brand_user_id === id && previous.avatars.length === 24) return previous.avatars;
  const membership = await sql<{ follower_user_id: string }>(`SELECT follower_user_id FROM audience_membership WHERE brand_user_id = ${quote(id)}`, signal);
  const ids = new Set(membership.map(row => row.follower_user_id));
  if (!ids.size) return [];
  const profiles = await sql<Profile>('SELECT user_id, username, profile_image_url FROM x_user', signal);
  return profiles.filter(p => ids.has(p.user_id) && p.profile_image_url).slice(0, 24);
}
export async function loadBuild(id: number, signal: AbortSignal, previous?: BuildSnapshot): Promise<BuildSnapshot> {
  const [row] = await sql<OnboardingRow>(`SELECT * FROM onboarding WHERE onboarding_id = ${id}`, signal);
  if (!row) throw new Error('Could not read your build. Try again.');
  const [ingestion, twins, profiles, avatars] = await Promise.all([
    row.ingestion_run_id ? sql<Ingestion>(`SELECT * FROM x_ingestion_run WHERE ingestion_run_id = ${quote(row.ingestion_run_id)}`, signal) : Promise.resolve([]),
    row.twin_run_id ? sql<Twins>(`SELECT * FROM twin_build_run WHERE run_id = ${quote(row.twin_run_id)}`, signal) : Promise.resolve([]),
    row.brand_user_id ? sql<Profile>(`SELECT * FROM x_user WHERE user_id = ${quote(row.brand_user_id)}`, signal) : Promise.resolve([]),
    followerAvatars(row.brand_user_id, signal, previous),
  ]);
  return { row, followers: ingestion[0]?.followers_discovered ?? 0, requested: twins[0]?.requested ?? 0, ready: twins[0]?.ready ?? 0, brand: profiles[0] ?? null, avatars };
}

export function useBuild(id: number | null, active: boolean) {
  const [snapshot, setSnapshot] = useState<BuildSnapshot | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => { setSnapshot(null); setError(''); }, [id]);
  useEffect(() => {
    if (id === null || !active) return;
    const abort = new AbortController(); let timer = 0; let previous: BuildSnapshot | undefined;
    const poll = async () => {
      try {
        const next = await loadBuild(id, abort.signal, previous);
        if (abort.signal.aborted) return;
        previous = next; setSnapshot(next); setError('');
        if (next.row.status === 'ready' || next.row.status === 'failed') return;
      } catch (cause: unknown) { if (abort.signal.aborted) return; setError(cause instanceof Error ? cause.message : 'Could not read your build.'); }
      timer = window.setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [id, active, revision]);
  return { snapshot, error, retry: () => setRevision(value => value + 1) };
}

export function stages(snapshot: BuildSnapshot | null, row: OnboardingRow | null): boolean[] {
  const status = row?.status;
  return [Boolean(status && ['twins', 'graph', 'ready'].includes(status)) || Boolean(row?.twin_run_id),
    status === 'graph' || status === 'ready' || Boolean(snapshot && snapshot.requested > 0 && snapshot.ready >= snapshot.requested), status === 'ready'];
}
export function liveStatus(row: OnboardingRow | null): string {
  switch (row?.status) {
    case 'scraping': return 'Reading followers';
    case 'twins': return 'Analyzing your audience';
    case 'graph': return 'Mapping the graph';
    case 'ready': return 'Ready';
    case 'failed': return 'Build failed';
    default: return 'Queued';
  }
}
