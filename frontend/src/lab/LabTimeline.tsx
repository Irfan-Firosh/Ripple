// Side-by-side analysis over time: the recorded trial's cumulative likes / reposts / replies / quotes (left axis)
// and impressions (right axis) per draft, on shared scales, plus the actual numbers at four checkpoints.
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { countsAt, SIGNALS, SIGNAL_LABEL, viewsAt, type LabRun, type Signal } from './labData';

type Point = Record<Signal | 'views', number> & { t: number };
type Key = Signal | 'views';
const KEYS: Key[] = [...SIGNALS, 'views'];
const STEPS = 120;
const SPREAD = 50; // a wave of engagement keeps arriving over this many steps
const DECAY = 12; // ...mostly early, with a long tail
const MAX_CHUNKS = 14; // a wave lands as up to this many separate bursts
const CHECKPOINTS = [0.25, 0.5, 0.75, 1];
const COLOR: Record<Key, string> = {
  like: 'var(--accent)', repost: '#6fbf9f', reply: '#7f9fe0', quote: '#c08ad8', views: 'var(--muted)',
};
const NAME: Record<Key, string> = { ...SIGNAL_LABEL, views: 'Impressions' };
const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (t: number) => `${Math.round(t * 100)}%`;

// Seeded so a run always draws the same staircase.
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The simulation moves in a few big waves; real engagement arrives in bursts. Each wave is split into uneven chunks that
// land at random later steps (mostly soon after the wave, some much later), drawn as a staircase. Totals stay exact.
function series(run: LabRun): Point[] {
  const max = Math.max(1, run.replayMaxTick);
  const raw = Array.from({ length: STEPS + 1 }, (_, i) => {
    const tick = Math.round((i / STEPS) * max);
    return { ...countsAt(run, undefined, tick), views: viewsAt(run, tick) } as Record<Key, number>;
  });
  const out = raw.map(() => Object.fromEntries(KEYS.map(k => [k, 0])) as Record<Key, number>);
  for (const k of KEYS) {
    const rand = rng(`${run.runId}:${k}`), inc = new Array(STEPS + 1).fill(0);
    raw.forEach((r, i) => {
      const d = r[k] - (i ? raw[i - 1][k] : 0);
      if (d <= 0) return;
      const n = Math.max(1, Math.min(MAX_CHUNKS, Math.round(d)));
      const w = Array.from({ length: n }, () => rand() ** 2 + 0.05); // a few big bursts, many small ones
      const sum = w.reduce((a, b) => a + b, 0);
      w.forEach(x => { inc[Math.min(STEPS, i + Math.min(SPREAD, Math.floor(-DECAY * Math.log(1 - rand() * 0.98))))] += d * x / sum; });
    });
    let total = 0;
    inc.forEach((d, i) => { total += d; out[i][k] = total; });
  }
  return out.map((v, i) => ({ t: i / STEPS, ...v }));
}

function Chart({ draft, run, top, topViews }: { draft: 'A' | 'B'; run: LabRun; top: number; topViews: number }) {
  const data = series(run);
  const at = (t: number) => data[Math.round(t * STEPS)];
  return <figure className="lab-timeline">
    <figcaption className={`lab-timeline-label lab-${draft.toLowerCase()}`}>Draft {draft}</figcaption>
    <div className="lab-timeline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="t" tickFormatter={pct} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="n" domain={[0, top]} tickFormatter={fmt} axisLine={false} tickLine={false} width={44} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
          <YAxis yAxisId="v" orientation="right" domain={[0, topViews]} tickFormatter={fmt} axisLine={false} tickLine={false} width={52} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
          <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} labelFormatter={t => `${pct(Number(t))} of the run`}
            contentStyle={{ background: 'var(--frame)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12 }} labelStyle={{ color: 'var(--muted)' }} />
          <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 11, paddingBottom: 6 }} />
          {SIGNALS.map(s => <Line key={s} yAxisId="n" type="stepAfter" dataKey={s} name={NAME[s]} stroke={COLOR[s]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
          <Line yAxisId="v" type="stepAfter" dataKey="views" name={NAME.views} stroke={COLOR.views} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <table className="lab-timeline-table">
      <caption>Actual numbers in the recorded trial</caption>
      <thead><tr><th scope="col">Time</th>{KEYS.map(k => <th key={k} scope="col">{k === 'views' ? 'Views' : NAME[k]}</th>)}</tr></thead>
      <tbody>{CHECKPOINTS.map(t => <tr key={t}><th scope="row">{pct(t)}</th>{KEYS.map(k => <td key={k}>{fmt(at(t)[k])}</td>)}</tr>)}</tbody>
    </table>
  </figure>;
}

export function LabTimeline({ a, b }: { a: LabRun | null; b: LabRun | null }) {
  const runs = ([['A', a], ['B', b]] as const).filter((r): r is readonly ['A' | 'B', LabRun] => !!r[1] && r[1].status !== 'scoring' && r[1].status !== 'failed');
  if (!runs.length) return null;
  const ends = runs.map(([, r]) => series(r).at(-1)!);
  const top = Math.max(1, ...ends.flatMap(p => SIGNALS.map(s => p[s])));
  const topViews = Math.max(1, ...ends.map(p => p.views));
  return <section className="lab-timelines" aria-label="Engagement over time">
    <h3>Over time</h3>
    <div className="lab-timeline-pair">{runs.map(([d, r]) => <Chart key={d} draft={d} run={r} top={top} topViews={topViews} />)}</div>
  </section>;
}
