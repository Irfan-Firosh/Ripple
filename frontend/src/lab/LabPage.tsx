import { ArrowLeft, Moon, RotateCcw, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RippleMark, initialTheme } from '../App';
import { Loader } from '../components/ui/loader';
import { RippleWorkspaceNav } from '../components/ui/floating-dock';
import { BRANDS } from '../audience/liveAudience';
import { listExperiments, loadBrand, useLabExperiment, type LabBrand, type LabExperimentSummary } from './labData';
import { LabComposer } from './LabComposer';
import { LabDock } from './LabDock';
import { Tweet } from './Tweet';
import { useReplayTick } from './useReplayTick';
import './lab.css';

const params = () => new URLSearchParams(location.search);
const initialBrand = () => BRANDS.find(b => b.handle === params().get('brand')?.toLowerCase())?.handle ?? 'raycast.com';

function useExperiments(brand: string, refreshKey: number) {
  const [list, setList] = useState<LabExperimentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    const poll = () => listExperiments(brand, controller.signal).then(next => {
      setList(next); setError(null);
      if (next.some(x => x.status === 'queued' || x.status === 'running')) timer = window.setTimeout(poll, 3000);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not read experiments.'); });
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [brand, refreshKey]);
  return { list, error };
}

export default function LabPage() {
  const [theme, setTheme] = useState(initialTheme);
  const [brand, setBrand] = useState<string>(initialBrand);
  const [expId, setExpId] = useState<string | null>(() => params().get('exp'));
  const [composing, setComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [awaitingNew, setAwaitingNew] = useState<number | null>(null);
  const [profile, setProfile] = useState<LabBrand | null>(null);
  const { list, error: listError } = useExperiments(brand, refresh);
  const { experiment, error } = useLabExperiment(expId);
  const a = useReplayTick(experiment?.a ?? null);
  const b = useReplayTick(experiment?.b ?? null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme; document.title = 'Lab — Ripple';
    try { localStorage.setItem('ripple-theme', theme); } catch { /* optional */ }
  }, [theme]);
  useEffect(() => { loadBrand(brand).then(setProfile).catch(() => setProfile(null)); }, [brand]);
  useEffect(() => {
    if (!list?.length) return;
    // After queuing, jump to the newest experiment once it appears; otherwise default to the newest.
    if (awaitingNew !== null && list[0].createdAt > awaitingNew) { setExpId(list[0].id); setAwaitingNew(null); return; }
    if (!expId || !list.some(x => x.id === expId)) setExpId(list[0].id);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams({ brand, ...(expId ? { exp: expId } : {}) });
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [brand, expId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list?.length || composing || (e.key !== '[' && e.key !== ']')) return;
      const at = list.findIndex(x => x.id === expId);
      const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === ']' ? 1 : -1)))];
      if (next) setExpId(next.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list, expId, composing]);

  const switchBrand = (handle: string) => { const next = BRANDS.find(x => x.handle === handle); if (next) { setBrand(next.handle); setExpId(null); } };
  const queued = useCallback((b: string) => { setComposing(false); setAwaitingNew(Date.now() * 1000 - 60_000_000); setBrand(BRANDS.find(x => x.handle === b)?.handle ?? 'raycast.com'); setRefresh(n => n + 1); }, []);
  const replay = () => { a.restart(); b.restart(); };
  const bothDone = experiment?.status === 'done' && a.finished && b.finished;
  const winnerLine = experiment && bothDone
    ? experiment.winner === 'tie' ? 'Too close to call' : `${experiment.winner} wins · ${experiment.lift > 0 ? '+' : ''}${Math.round(Math.abs(experiment.lift) * 100)}% expected engagement`
    : null;

  return <main className="lab-page">
    <header className="lab-header">
      <a className="brand" href="/" aria-label="Ripple home"><RippleMark size={26} /><span>Ripple</span></a>
      <span className="lab-crumb">Lab</span>
      <RippleWorkspaceNav brand={brand} />
      <nav className="lab-brands" aria-label="Audience">{BRANDS.map(x => <button key={x.handle} aria-current={x.handle === brand ? 'page' : undefined} onClick={() => switchBrand(x.handle)}>{x.label}</button>)}</nav>
      <div className="lab-header-actions">
        <a className="lab-icon" href="/dashboard" aria-label="Back to dashboard"><ArrowLeft size={15} /></a>
        <button className="lab-icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      </div>
    </header>

    {listError || error ? <div className="lab-state" role="alert">{listError ?? error}<button className="lab-secondary" onClick={() => setRefresh(n => n + 1)}><RotateCcw size={14} /> Try again</button></div>
      : list === null || (expId && !experiment) ? <div className="lab-state" role="status"><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true" /><p>Opening the Lab…</p></div>
      : !list.length ? <div className="lab-state"><h2>No experiments for @{brand} yet</h2><button className="lab-primary" onClick={() => setComposing(true)}>New experiment</button></div>
      : experiment && profile && <>
        <div className="lab-toolbar">
          <h2>{experiment.title}</h2>
          {winnerLine && <span className={`lab-verdict lab-draft-${experiment.winner}`}>{winnerLine}</span>}
          {experiment.status === 'failed' && <span className="lab-verdict lab-failed" role="alert">{experiment.error ?? 'This experiment failed.'}</span>}
          {(experiment.status === 'queued') && <span className="lab-verdict" role="status">Queued — waiting for the simulator…</span>}
          <button className="lab-secondary" onClick={replay} disabled={!experiment.a || !experiment.b}><RotateCcw size={14} /> Replay</button>
        </div>
        <div className="lab-columns">
          <Tweet label="A" brand={profile} draft={experiment.draftA} run={experiment.a} tick={a.tick} finished={a.finished} winner={Boolean(bothDone && experiment.winner === 'A')} />
          <Tweet label="B" brand={profile} draft={experiment.draftB} run={experiment.b} tick={b.tick} finished={b.finished} winner={Boolean(bothDone && experiment.winner === 'B')} />
        </div>
      </>}

    <LabDock experiments={list ?? []} activeId={expId} onSelect={setExpId} onNew={() => setComposing(true)} />
    {composing && <LabComposer brand={brand} onClose={() => setComposing(false)} onQueued={queued} />}
  </main>;
}
