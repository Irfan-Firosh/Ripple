export type Draft = { id: string; title: string; text: string };
export type Result = Draft & { median: number; low: number; high: number; penetration: number; histogram: number[] };
export const starterDrafts: Draft[] = [
  { id: 'A', title: 'The announcement', text: 'We built an open-source tool that lets you test a post before you publish. Meet Ripple.' },
  { id: 'B', title: 'The question', text: 'What if you could watch your next idea spread before you post it? We built Ripple to find the bridges between communities. Try it, then tell us what surprised you.' },
];
// Local illustrative distribution, not a trained policy or a Bluesky forecast.
export function previewResults(drafts: Draft[], runs: number): Result[] {
  return drafts.map(draft => {
    let seed = 2166136261;
    for (const c of draft.text) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const hook = /\?/.test(draft.text) ? .16 : 0;
    const invitation = /\b(try|you|your|what|tell)\b/i.test(draft.text) ? .13 : 0;
    const clarity = draft.text.length >= 60 && draft.text.length <= 240 ? .08 : 0;
    const baseline = .22 + hook + invitation + clarity;
    const values = Array.from({ length: runs }, () => Math.max(1, Math.min(48, Math.round(48 * (baseline + (random() + random() - 1) * .32))))).sort((a,b) => a-b);
    const quantile = (p: number) => values[Math.floor((values.length - 1) * p)];
    const median = quantile(.5);
    return { ...draft, median, low: quantile(.1), high: quantile(.9), penetration: Math.min(4, Math.max(1, Math.ceil(median / 12))), histogram: Array.from({ length: 8 }, (_, i) => values.filter(n => Math.min(7, Math.floor((n - 1) / 6)) === i).length) };
  }).sort((a,b) => b.median - a.median);
}
