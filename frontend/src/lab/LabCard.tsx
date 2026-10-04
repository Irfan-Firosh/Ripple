import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { SIGNALS, countsAt, expectedCounts, SIGNAL_LABEL, type LabExperiment, type LabRun, type LabNiche, type BacktestHeadline } from './labData';
import { useLabComments } from './labComments';
import { LabTweet } from './LabTweet';
import { useLabAuthor } from './labAuthor';
import { SignalRow } from './SignalRow';

type LabCardProps = { experiment: LabExperiment; niches: LabNiche[]; headline: BacktestHeadline; onCompose: () => void };
function values(run: LabRun | null, members?: Set<string>) {
  if (!run || run.status === 'scoring' || run.status === 'failed') return null;
  if (run.status === 'replaying') return countsAt(run, members);
  if (members) return expectedCounts(run, members);
  return run.signals ? Object.fromEntries(SIGNALS.map(s => [s, run.signals![s].p50])) as Record<(typeof SIGNALS)[number], number> : null;
}

export function LabCard({ experiment, niches, headline, onCompose }: LabCardProps) {
  const [niche, setNiche] = useState('');
  const author = useLabAuthor(experiment.brand);
  const [replayProgress, setReplayProgress] = useState<number | null>(null);
  const members = niches.find(n => n.slug === niche)?.members;
  const runs = [experiment.a, experiment.b].filter((r): r is LabRun => r !== null);
  const running = experiment.status === 'queued' || experiment.status === 'running';
  const { comments, error: commentsError, retry: retryComments } = useLabComments(runs.map(r => r.runId), running);
  useEffect(() => {
    if (replayProgress === null) return;
    const start = performance.now();
    const interval = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - start) / 12000);
      setReplayProgress(progress === 1 ? null : progress);
    }, 100);
    return () => clearInterval(interval);
    // One clock per requested replay; subsequent ticks must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayProgress !== null]);
  const visibleRun = (run: LabRun | null): LabRun | null => run && replayProgress !== null ? { ...run, status: 'replaying', replayTick: Math.floor(replayProgress * run.replayMaxTick) } : run;
  const runA = visibleRun(experiment.a), runB = visibleRun(experiment.b);
  const a = values(runA, members), b = values(runB, members);
  const maximum = Math.max(1, ...SIGNALS.flatMap(s => [a?.[s] ?? 0, b?.[s] ?? 0]));
  const people = Math.max(0, ...runs.map(r => r.people));
  const projection = runs.find(r => r.projection?.mode === 'linear')?.projection;
  const projected = projection ? ` · projected to ${projection.audience.toLocaleString()} followers` : '';
  const scoring = runs.some(r => r.status === 'scoring') || (experiment.status === 'running' && runs.length < 2);
  const status = experiment.status === 'failed' ? 'Could not complete this experiment'
    : experiment.status === 'queued' ? 'queued…' : scoring ? `Analyzing your audience…`
    : replayProgress !== null ? `replaying · ${people} people` : experiment.status === 'done' ? `done · ${people} people simulated${projected}` : `simulating · ${people} people`;
  const progress = replayProgress ?? (experiment.status === 'done' ? 1 : Math.min(1, runs.reduce((sum, r) => sum + r.replayTick, 0) / Math.max(1, runs.reduce((sum, r) => sum + r.replayMaxTick, 0))));
  const range = (signal: (typeof SIGNALS)[number]) => {
    const ar = experiment.a?.signals?.[signal], br = experiment.b?.signals?.[signal];
    return ar && br ? `${SIGNAL_LABEL[signal]} range: A ${ar.p10}–${ar.p90} vs B ${br.p10}–${br.p90}${members ? ' (whole audience)' : ''}` : '';
  };
  const ci = headline?.note.match(/95%\s*CI\s*[:(]?\s*(0?\.\d+|\d+(?:\.\d+)?)\s*[-–—]\s*(0?\.\d+|\d+(?:\.\d+)?)/i);
  const showBacktest = !!headline && !!ci && Number(ci[1]) > .5;
  const lift = Math.round(experiment.lift * 100);
  return <section className="lab-comparison" aria-label="Draft comparison">
    <div className="lab-comparison-toolbar"><div><h2>{experiment.title || 'Untitled experiment'}</h2><span className="lab-status" role="status" aria-live="polite"><i className={running || replayProgress !== null ? 'is-running' : ''} aria-hidden="true" />{status}</span></div><div className="lab-comparison-controls">
      {experiment.status === 'done' && <button className="lab-replay" onClick={() => setReplayProgress(replayProgress === null ? 0 : null)} title="Replay the recorded trial. Completed totals show forecast medians."><RotateCcw size={13} />{replayProgress === null ? 'Replay reactions' : 'End replay'}</button>}
      <select aria-label="Niche" value={niche} onChange={e => setNiche(e.target.value)}><option value="">All niches</option>{niches.map(n => <option key={n.slug} value={n.slug}>{n.label}</option>)}</select>
    </div></div>
    <div className="lab-progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>
    <div className="lab-tweet-pair" role="region" aria-label="Compared drafts">{(['A', 'B'] as const).map(draft => <LabTweet key={draft} draft={draft} author={author} text={draft === 'A' ? experiment.draftA : experiment.draftB} createdAt={experiment.createdAt} run={draft === 'A' ? runA : runB} counts={draft === 'A' ? a : b} comments={comments} members={members} winner={experiment.status === 'done' && experiment.winner === draft} replaying={replayProgress !== null} commentsError={commentsError} onRetryComments={retryComments} />)}</div>
    {experiment.status === 'failed' && <div className="lab-error lab-failed-panel" role="alert"><p>{experiment.error || 'This experiment could not finish. Try another draft.'}</p><button className="lab-secondary" onClick={onCompose}>Try another draft</button></div>}
    <div className="lab-forecast-panel"><div className="lab-forecast-heading"><span>Side by side</span><span>{replayProgress !== null ? 'Recorded trial' : experiment.status === 'done' ? members ? 'Expected engagement in this niche' : 'Median expected engagement' : 'Live engagement'}<span className="lab-forecast-key"><b className="lab-a">A</b> / <b className="lab-b">B</b></span></span></div><div className="lab-signals">{SIGNALS.map(signal => <SignalRow key={signal} signal={signal} a={a?.[signal] ?? null} b={b?.[signal] ?? null} maximum={maximum} range={range(signal)} />)}</div>
    {experiment.status === 'done' && <div className="lab-summary"><p><strong className={experiment.winner === 'A' ? 'lab-a' : experiment.winner === 'B' ? 'lab-b' : ''}>{experiment.winner === 'A' ? 'A wins' : experiment.winner === 'B' ? 'B wins' : 'Too close to call'}</strong><span> · {lift >= 0 ? '+' : ''}{lift}% expected engagement</span></p><p className="lab-range-summary">{SIGNALS.map(s => range(s)).filter(Boolean).join(' · ')}</p>{showBacktest && headline && <p className="lab-backtest">Backtest: picks the better post {Math.round(headline.value * 100)}% of the time (coin flip 50%, n={headline.n})</p>}</div>}
    </div>
  </section>;
}
