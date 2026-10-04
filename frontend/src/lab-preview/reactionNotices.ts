import type { Reaction, SpreadScene, SpreadTrial } from './spreadScene';

export type ReactionNotice = { draft: 'A' | 'B'; event: Reaction; at: number; until: number };
export const REPOST_NOTICE_SHARE = .4;
export const NOTICE_SECONDS = 1.8;
export const NOTICE_GAP = .25;
export const SPREAD_SLOWDOWN = 1.6;

/** Reserve at least 40% of each draft's illustrative reposts, including every bridge actor. */
export function reactionNotices(scene: SpreadScene, seed: number): ReactionNotice[] {
  const candidates = (['A', 'B'] as const).map(draft => {
    const events = (draft === 'A' ? scene.a : scene.b).events;
    const reposts = events.filter(event => event.action === 'repost');
    const selected = new Set(reposts.filter(event => event.target !== undefined));
    const quota = Math.ceil(reposts.length * REPOST_NOTICE_SHARE);
    const others = reposts.filter(event => !selected.has(event));
    const needed = Math.max(0, quota - selected.size);
    for (let i = 0; i < needed; i++) selected.add(others[Math.floor((i + .5) * others.length / needed)]);
    if (!selected.size) { const like = events.find(event => event.featured); if (like) selected.add(like); }
    return [...selected].sort((a, b) => a.at - b.at).map(event => ({ draft, event }));
  });
  const preferred = seed & 1 ? 'A' : 'B';
  const ordered = candidates.flat().sort((a, b) => a.event.at - b.event.at || (a.draft === preferred ? -1 : 1));
  let available = 0, previousEvent = 0, previousNotice = 0;
  const notices: ReactionNotice[] = [];
  for (const candidate of ordered) {
    const at = Math.max(previousNotice + (candidate.event.at - previousEvent) * SPREAD_SLOWDOWN, available), until = at + NOTICE_SECONDS;
    notices.push({ ...candidate, at, until });
    available = until + NOTICE_GAP;
    previousEvent = candidate.event.at; previousNotice = at;
  }
  return notices;
}

/** Retimes illustrative reactions and their causal paths together; recorded Lab results never change. */
export function synchronizeSpread(scene: SpreadScene, seed: number): { scene: SpreadScene; notices: ReactionNotice[] } {
  const plan = reactionNotices(scene, seed);
  const retime = (draft: 'A' | 'B', trial: SpreadTrial) => {
    const anchors = [{ original: 0, display: 0 }, ...plan.filter(notice => notice.draft === draft).map(notice => ({ original: notice.event.at, display: notice.at }))];
    const at = (original: number): number => {
      if (!Number.isFinite(original)) return original;
      const next = anchors.findIndex(anchor => anchor.original >= original);
      if (next === 0) return 0;
      if (next < 0) { const last = anchors.at(-1)!; return last.display + (original - last.original) * SPREAD_SLOWDOWN; }
      const start = anchors[next - 1], end = anchors[next];
      return start.display + (original - start.original) / (end.original - start.original) * (end.display - start.display);
    };
    return { trial: { events: trial.events.map(event => ({ ...event, at: at(event.at) })),
      handoffs: trial.handoffs.map(handoff => ({ ...handoff, at: at(handoff.at), arrives: at(handoff.arrives) })),
      arrivals: trial.arrivals.map(at) }, duration: at(scene.duration) };
  };
  const a = retime('A', scene.a), b = retime('B', scene.b);
  const notices = plan.map(notice => ({ ...notice, event: (notice.draft === 'A' ? a.trial : b.trial).events.find(event => event.id === notice.event.id)! }));
  return { scene: { ...scene, a: a.trial, b: b.trial, duration: Math.max(a.duration, b.duration, (notices.at(-1)?.until ?? 0) + .3) }, notices };
}
