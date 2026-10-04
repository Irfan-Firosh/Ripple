// The Lab's data contract: A/B draft experiments, per-signal ranges and the replayed trial's events,
// read straight from SpacetimeDB (no backend, no mock data).
import { useEffect, useState } from 'react';
import { BRANDS, loadAudience, sql } from '../audience/liveAudience';
import { groupByNiche } from '../visuals/liveNetwork';

const DB = 'https://maincloud.spacetimedb.com';
const DB_NAME = 'ripple-mhacks';
const TOKEN_KEY = 'ripple-lab-token';

export const SIGNALS = ['like', 'repost', 'reply', 'quote'] as const;
export type Signal = (typeof SIGNALS)[number];
export const SIGNAL_LABEL: Record<Signal, string> = { like: 'Likes', repost: 'Reposts', reply: 'Replies', quote: 'Quotes' };
export type SignalRange = { p10: number; p50: number; p90: number; mean: number };
export type LabEvent = { userId: string; handle: string; name: string; avatar: string; signal: Signal; tick: number; draft: 'A' | 'B' };
export type LabRun = {
  runId: string; status: 'scoring' | 'replaying' | 'done' | 'failed'; replayTick: number; replayMaxTick: number; people: number;
  signals: Record<Signal, SignalRange> | null; events: LabEvent[]; shares: Map<string, Record<Signal, number>>;
};
export type LabExperimentSummary = {
  id: string; brand: string; title: string; status: 'queued' | 'running' | 'done' | 'failed';
  winner: '' | 'A' | 'B' | 'tie'; lift: number; createdAt: number;
};
export type LabExperiment = LabExperimentSummary & { draftA: string; draftB: string; error: string | null; a: LabRun | null; b: LabRun | null };
export type LabNiche = { slug: string; label: string; members: Set<string> };
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

async function loadRun(runId: string, draft: 'A' | 'B', signal?: AbortSignal): Promise<LabRun | null> {
  if (!runId) return null;
  const [runs, sigs, events, shares] = await Promise.all([
    sql(`SELECT * FROM sim_run WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_signal WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_event WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_node_signal WHERE run_id = ${q(runId)}`, signal),
  ]);
  const run = runs[0];
  if (!run) return null;
  const ids = [...new Set(events.map(e => e.user_id as string))];
  const users = ids.length ? await sql(`SELECT user_id, username, name, profile_image_url FROM x_user`, signal) : [];
  const byId = new Map(users.filter(u => ids.includes(u.user_id)).map(u => [u.user_id as string, u]));
  const ranges = sigs.length ? Object.fromEntries(sigs.map(s => [s.signal, { p10: s.p_10, p50: s.p_50, p90: s.p_90, mean: s.mean }])) as Record<Signal, SignalRange> : null;
  return {
    runId, status: run.status, replayTick: run.replay_tick, replayMaxTick: run.replay_max_tick, people: run.people, signals: ranges,
    events: events.map(e => {
      const u = byId.get(e.user_id);
      return { userId: e.user_id, handle: u?.username ?? e.user_id, name: u?.name ?? '', avatar: (u?.profile_image_url ?? '').replace('_normal.', '_200x200.'),
               signal: e.signal, tick: e.tick, draft };
    }).sort((x, y) => x.tick - y.tick),
    shares: new Map(shares.map(s => [s.user_id as string, { like: s.like_share, repost: s.repost_share, reply: s.reply_share, quote: s.quote_share }])),
  };
}

export async function loadExperiment(id: string, signal?: AbortSignal): Promise<LabExperiment> {
  const rows = await sql(`SELECT * FROM lab_experiment WHERE experiment_id = ${Number(id)}`, signal);
  const r = rows[0];
  if (!r) throw new Error(`Experiment ${id} was not found.`);
  const [a, b] = await Promise.all([loadRun(r.run_a, 'A', signal), loadRun(r.run_b, 'B', signal)]);
  return { ...summary(r), draftA: r.draft_a, draftB: r.draft_b, error: r.error ?? null, a, b };
}

export async function loadLabNiches(brand: string, signal?: AbortSignal): Promise<LabNiche[]> {
  const audience = await loadAudience(brand, signal);
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
  const res = await fetch(`${DB}/v1/database/${DB_NAME}/call/request_lab_experiment`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([input.brand, input.title, input.draftA, input.draftB]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.replace(/^.*SenderError:?\s*/s, '').trim() || `Request failed (${res.status}).`);
  }
}

export function countsAt(run: LabRun, members?: Set<string>): Record<Signal, number> {
  const out = zero();
  for (const e of run.events) if (e.tick <= run.replayTick && (!members || members.has(e.userId))) out[e.signal] += 1;
  return out;
}

export function expectedCounts(run: LabRun, members?: Set<string>): Record<Signal, number> {
  const out = zero();
  run.shares.forEach((s, userId) => { if (!members || members.has(userId)) for (const k of SIGNALS) out[k] += s[k]; });
  for (const k of SIGNALS) out[k] = Math.round(out[k] * 10) / 10;
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
