// The Lab's data contract: A/B draft experiments, per-signal ranges and the replayed trial's events,
// read straight from SpacetimeDB (no backend, no mock data).
import { useEffect, useState } from 'react';
import { BRANDS, loadAudience, sql } from '../audience/liveAudience';
import { groupByNiche } from '../visuals/liveNetwork';
import { loadAudienceSnapshot } from '../history/historyData';

const DB = 'https://maincloud.spacetimedb.com';
const DB_NAME = 'ripple-mhacks';
const TOKEN_KEY = 'ripple-lab-token';

export const SIGNALS = ['like', 'repost', 'reply', 'quote'] as const;
export type Signal = (typeof SIGNALS)[number];
export const SIGNAL_LABEL: Record<Signal, string> = { like: 'Likes', repost: 'Reposts', reply: 'Replies', quote: 'Quotes' };
export type SignalRange = { p10: number; p50: number; p90: number; mean: number };
export type LabComment = { userId: string; handle: string; name: string; avatar: string; kind: 'reply' | 'quote'; text: string; tick: number };
export type OutsideTick = { tick: number; views: number; like: number; repost: number; reply: number; quote: number };
export type LabEvent = { userId: string; handle: string; name: string; avatar: string; signal: Signal; tick: number; draft: 'A' | 'B' };
// How a run's counts were projected onto the real audience ('linear' = x audience / simulated).
export type LabProjection = { mode: 'linear' | 'anchored' | 'none'; audience: number; simulated: number; factor: number };
export type LabRun = {
  runId: string; status: 'scoring' | 'replaying' | 'done' | 'failed'; replayTick: number; replayMaxTick: number; people: number;
  signals: Record<Signal, SignalRange> | null; events: LabEvent[]; shares: Map<string, Record<Signal, number>>;
  views: SignalRange | null; outside: OutsideTick[]; comments: LabComment[]; outsideShare: number;
  projection: LabProjection | null;
};
export type LabExperimentSummary = {
  id: string; brand: string; title: string; status: 'queued' | 'running' | 'done' | 'failed';
  winner: '' | 'A' | 'B' | 'tie'; lift: number; createdAt: number;
};
export type LabExperiment = LabExperimentSummary & { draftA: string; draftB: string; error: string | null; a: LabRun | null; b: LabRun | null };
export type LabNiche = { slug: string; label: string; members: Set<string> };
export type LabBrand = { handle: string; name: string; avatar: string; verified: boolean };
export type BacktestHeadline = { metric: string; value: number; baseline: number; n: number; note: string } | null;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const zero = (): Record<Signal, number> => ({ like: 0, repost: 0, reply: 0, quote: 0 });

function summary(r: Record<string, any>): LabExperimentSummary {
  return { id: String(r.experiment_id), brand: r.brand, title: r.title, status: r.status, winner: r.winner, lift: r.lift,
           createdAt: Number(r.created_at) };
}

export async function listExperiments(brand: string, signal?: AbortSignal): Promise<LabExperimentSummary[]> {
  const rows = await sql(`SELECT * FROM lab_experiment WHERE brand = ${q(brand)}`, signal);
  return rows.map(summary).sort((a, b) => b.createdAt - a.createdAt);
}

// x_user rows are cached per session: every poll would otherwise re-download the whole table.
let userCache: Map<string, Record<string, any>> | null = null;
async function users(ids: string[], signal?: AbortSignal, refresh = false): Promise<Map<string, Record<string, any>>> {
  if (refresh || !userCache || ids.some(id => !userCache!.has(id))) {
    const [rows, archived] = await Promise.all([
      sql('SELECT user_id, username, name, profile_image_url, verified FROM x_user', signal),
      sql('SELECT user_id, username, name, profile_image_url, verified FROM archived_profile', signal),
    ]);
    userCache = new Map([...archived, ...rows].map(u => [u.user_id as string, u]));
  }
  return userCache;
}
const bigger = (url?: string | null) => (url ?? '').replace('_normal.', '_200x200.');

async function loadRun(runId: string, draft: 'A' | 'B', signal?: AbortSignal): Promise<LabRun | null> {
  if (!runId) return null;
  const [runs, sigs, events, shares, outside, comments, sources, projections] = await Promise.all([
    sql(`SELECT * FROM sim_run WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_signal WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_event WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_node_signal WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_outside_tick WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_comment WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_signal_source WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_projection WHERE run_id = ${q(runId)}`, signal).catch(() => []),
  ]);
  const run = runs[0];
  if (!run) return null;
  const byId = await users([...events, ...comments].map(e => e.user_id as string), signal);
  const person = (id: string) => { const u = byId.get(id); return { handle: u?.username ?? id, name: u?.name ?? '', avatar: bigger(u?.profile_image_url) }; };
  const range = (r: Record<string, any>): SignalRange => ({ p10: r.p_10, p50: r.p_50, p90: r.p_90, mean: r.mean });
  const engaged = sources.filter(r => (SIGNALS as readonly string[]).includes(r.signal));
  const total = engaged.reduce((a, r) => a + r.mean, 0);
  const counted = sigs.filter(r => (SIGNALS as readonly string[]).includes(r.signal));
  const view = sigs.find(r => r.signal === 'view');
  const p = projections[0];
  const projection: LabProjection | null = p ? { mode: p.mode, audience: Number(p.audience), simulated: p.simulated, factor: p.factor } : null;
  const signals = counted.length ? Object.fromEntries(counted.map(r => [r.signal, range(r)])) as Record<Signal, SignalRange> : null;
  return {
    runId, status: run.status, replayTick: run.replay_tick, replayMaxTick: run.replay_max_tick, people: run.people,
    signals,
    views: view ? range(view) : null,
    events: events.map(e => ({ userId: e.user_id, ...person(e.user_id), signal: e.signal, tick: e.tick, draft })).sort((x, y) => x.tick - y.tick),
    shares: new Map(shares.map(s => [s.user_id as string, { like: s.like_share, repost: s.repost_share, reply: s.reply_share, quote: s.quote_share }])),
    outside: outside.map(o => ({ tick: o.tick, views: o.views, like: o.likes, repost: o.reposts, reply: o.replies, quote: o.quotes })).sort((x, y) => x.tick - y.tick),
    comments: comments.map(c => ({ userId: c.user_id, ...person(c.user_id), kind: c.kind, text: c.text, tick: c.tick })).sort((x, y) => x.tick - y.tick),
    outsideShare: total ? engaged.filter(r => r.source === 'outside').reduce((a, r) => a + r.mean, 0) / total : 0,
    projection,
  };
}

export async function loadBrand(brand: string, signal?: AbortSignal): Promise<LabBrand> {
  const all = await users([], signal, true);
  const u = [...all.values()].find(r => String(r.username).toLowerCase() === brand.toLowerCase());
  return { handle: u?.username ?? brand, name: u?.name ?? brand, avatar: bigger(u?.profile_image_url), verified: Boolean(u?.verified) };
}

export async function loadExperiment(id: string, signal?: AbortSignal): Promise<LabExperiment> {
  const rows = await sql(`SELECT * FROM lab_experiment WHERE experiment_id = ${Number(id)}`, signal);
  const r = rows[0];
  if (!r) throw new Error(`Experiment ${id} was not found.`);
  const [a, b] = await Promise.all([loadRun(r.run_a, 'A', signal), loadRun(r.run_b, 'B', signal)]);
  return { ...summary(r), draftA: r.draft_a, draftB: r.draft_b, error: r.error ?? null, a, b };
}

export async function loadLabNiches(brand: string, signal?: AbortSignal): Promise<LabNiche[]> {
  const audience = await loadAudience(brand, signal).catch(async error => {
    if (signal?.aborted) throw error;
    const versions = await sql<{ snapshot_id: string; created_at: number }>(`SELECT snapshot_id, created_at FROM audience_snapshot WHERE brand = ${q(brand)}`, signal);
    const latest = versions.sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];
    if (!latest) throw error;
    return loadAudienceSnapshot(latest.snapshot_id, signal);
  });
  const cap = BRANDS.find(b => b.handle === brand)?.maxNiches ?? 7;
  const labels = new Map(audience.niches.map(n => [n.slug, n.label]));
  return groupByNiche(audience.members, cap).map(([slug, ms]) => ({ slug, label: labels.get(slug) ?? slug, members: new Set(ms.map(m => m.userId)) }));
}

export async function loadBacktestHeadline(brand: string, signal?: AbortSignal): Promise<BacktestHeadline> {
  const users = await sql(`SELECT user_id, username FROM x_user`, signal);
  const id = users.find(u => String(u.username).toLowerCase() === brand.toLowerCase())?.user_id;
  if (!id) return null;
  const rows = await sql(`SELECT * FROM backtest_result WHERE backtest_result_id = ${q(`${id}:pairwise_accuracy_likes`)}`, signal);
  const r = rows[0];
  return r ? { metric: r.metric, value: r.value, baseline: r.baseline, n: r.n, note: r.note } : null;
}

async function token(): Promise<string> {
  try { const saved = localStorage.getItem(TOKEN_KEY); if (saved) return saved; } catch { /* storage unavailable */ }
  const res = await fetch(`${DB}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create a SpacetimeDB identity.');
  const { token: fresh } = (await res.json()) as { token: string };
  try { localStorage.setItem(TOKEN_KEY, fresh); } catch { /* storage unavailable */ }
  return fresh;
}

export async function requestExperiment(input: { brand: string; title: string; draftA: string; draftB: string }): Promise<void> {
  if ([input.draftA, input.draftB].some(draft => !draft.trim() || draft.length > 1000)) {
    throw new Error('drafts must be 1..1000 characters');
  }
  const res = await fetch(`${DB}/v1/database/${DB_NAME}/call/request_lab_experiment`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([input.brand, input.title, input.draftA, input.draftB]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.replace(/^.*SenderError:?\s*/s, '').trim() || `Request failed (${res.status}).`);
  }
}

// Live counts at the run's current replay tick: followers' actions (optionally only `members`) plus, for the whole
// audience view, the engagement reposts brought in from outside the brand's followers. Always whole numbers.
export function countsAt(run: LabRun, members?: Set<string>, tick: number = run.replayTick): Record<Signal, number> {
  const out = zero();
  for (const e of run.events) if (e.tick <= tick && (!members || members.has(e.userId))) out[e.signal] += 1;
  if (!members) for (const o of run.outside) if (o.tick <= tick) for (const k of SIGNALS) out[k] += o[k];
  return out;
}

export function viewsAt(run: LabRun, tick: number = run.replayTick): number {
  return run.people + run.outside.filter(o => o.tick <= tick).reduce((a, o) => a + o.views, 0);
}

// Expected counts for a niche (sum of each member's per-signal share), rounded to whole people.
export function expectedCounts(run: LabRun, members?: Set<string>): Record<Signal, number> {
  const out = zero();
  run.shares.forEach((s, userId) => { if (!members || members.has(userId)) for (const k of SIGNALS) out[k] += s[k]; });
  for (const k of SIGNALS) out[k] = Math.round(out[k]);
  return out;
}

export function useLabExperiment(id: string | null): { experiment: LabExperiment | null; error: string | null } {
  const [experiment, setExperiment] = useState<LabExperiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setExperiment(null); setError(null);
    if (!id) return;
    const controller = new AbortController();
    let timer = 0;
    const settled = (e: LabExperiment) => e.status === 'failed' || (e.status === 'done' && e.a?.status === 'done' && e.b?.status === 'done');
    const poll = () => loadExperiment(id, controller.signal).then(e => {
      setExperiment(e); setError(null);
      if (!settled(e)) timer = window.setTimeout(poll, 500);
    }).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'The experiment could not be read.');
      timer = window.setTimeout(poll, 2000); // keep trying through a transient read error
    });
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);
  return { experiment, error };
}

// The finished numbers the Lab shows for a run: the expected (mean) outcome over all simulated trials. The tweet
// card, the side-by-side graph and its table all read this, so they always agree.
export function finalCounts(run: LabRun): Record<Signal | 'views', number> {
  const m = run.signals, mean = (r?: SignalRange) => Math.round(r?.mean ?? 0);
  return { like: mean(m?.like), repost: mean(m?.repost), reply: mean(m?.reply), quote: mean(m?.quote),
           views: mean(run.views ?? undefined) };
}
