import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { Loader } from '../components/ui/loader';
import { loadSpreadAudience, type PreviewAudience } from '../lab-preview/previewAudience';
import { createSpreadScene } from '../lab-preview/spreadScene';
import { SpreadGraph } from '../lab-preview/SpreadGraph';
import { synchronizeSpread } from '../lab-preview/reactionNotices';
import type { LabExperiment } from './labData';
import '../lab-preview/spread-preview.css';
import './lab-audience-spread.css';

type LoadState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; audience: PreviewAudience };

export function LabAudienceSpread({ experiment }: { experiment: LabExperiment }) {
  const reduced = Boolean(useReducedMotion());
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const progress = useRef(0);
  const audience = load.status === 'ready' ? load.audience : null;
  const seed = [...experiment.id].reduce((value, letter) => Math.imul(value ^ letter.charCodeAt(0), 16777619), 2166136261);
  const presentation = useMemo(() => audience ? synchronizeSpread(createSpreadScene(audience, seed, experiment.draftA, experiment.draftB), seed) : null,
    [audience, seed, experiment.draftA, experiment.draftB]);
  const scene = presentation?.scene ?? null, notices = presentation?.notices ?? [];
  const duration = scene?.duration ?? 0;
  const notice = time < duration ? notices.find(item => item.at <= time && time < item.until) : undefined;

  useEffect(() => {
    const abort = new AbortController(); setLoad({ status: 'loading' });
    loadSpreadAudience(experiment.brand, abort.signal)
      .then(next => { if (!abort.signal.aborted) setLoad({ status: 'ready', audience: next }); })
      .catch(() => { if (!abort.signal.aborted) setLoad({ status: 'failed' }); });
    return () => abort.abort();
  }, [experiment.brand, attempt]);
  useEffect(() => {
    if (!scene) return;
    progress.current = reduced ? duration : 0; setTime(progress.current); setPlaying(!reduced);
  }, [scene, duration, reduced]);
  useEffect(() => {
    if (!scene || !playing || reduced) return;
    let frame = 0, last = performance.now(), drawn = last;
    const advance = (now: number) => {
      progress.current = Math.min(duration, progress.current + (now - last) / 1000); last = now;
      if (now - drawn > 40 || progress.current === duration) { setTime(progress.current); drawn = now; }
      if (progress.current < duration) frame = requestAnimationFrame(advance); else setPlaying(false);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [scene, duration, playing, reduced]);
  const restart = () => {
    if (!scene) return;
    progress.current = reduced ? duration : 0; setTime(progress.current); setPlaying(!reduced);
  };

  if (load.status === 'loading') return <div className="lab-spread-state" role="status">
    <Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true" /><span>Loading audience…</span>
  </div>;
  if (load.status === 'failed') return <div className="lab-spread-state" role="alert">
    <span>Audience unavailable.</span><button className="lab-secondary" onClick={() => setAttempt(value => value + 1)}>Try again</button>
  </div>;
  if (!scene) return null;
  return <section className="lab-audience-spread" aria-label="Audience spread comparison">
    <div className="lab-spread-pair">{(['A', 'B'] as const).map(draft => <figure key={draft} className={`lab-spread-graph spread-${draft}`}>
      <figcaption>{draft}</figcaption>
      <SpreadGraph scene={scene} draft={draft} time={time} reduced={reduced} brandLabel={`@${experiment.brand}`} minimal automaticEvent={notice?.draft === draft ? notice.event : null} />
    </figure>)}</div>
    <footer><span>Illustrative spread</span><div>
      {!reduced && <button className="lab-icon" aria-label={playing ? 'Pause audience animation' : 'Play audience animation'} onClick={() => time >= duration ? restart() : setPlaying(value => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>}
      <button className="lab-icon" aria-label="Restart audience animation" onClick={restart}><RotateCcw size={14} /></button>
    </div></footer>
  </section>;
}
