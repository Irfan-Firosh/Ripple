import { WorkspaceAccount } from '../components/WorkspaceAccount';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, Play, Pause, RotateCcw, X } from 'lucide-react';
import { RippleMark, initialTheme } from '../App';
import { BRANDS, loadAudience, type BrandHandle } from '../audience/liveAudience';
import { buildLiveNetwork, type CascadeNetwork } from '../visuals/liveNetwork';
import { prepareNetwork } from '../visuals/prepareNetwork';
import { SIGNALS, SIGNAL_LABEL, countsAt, listExperiments, useLabExperiment, type LabExperimentSummary, type LabRun } from '../lab/labData';
import { GameCanvas } from './GameCanvas';
import './lab-game.css';

export default function LabGamePage() {
  const initial = useRef(new URLSearchParams(location.search));
  const [brand, setBrand] = useState<BrandHandle>(() => BRANDS.find(b => b.handle === initial.current.get('brand'))?.handle ?? 'spacetimedb');
  const [id, setId] = useState<string | null>(initial.current.get('exp'));
  const [draft, setDraft] = useState<'A' | 'B'>('A');
  const [theme, setTheme] = useState(initialTheme);
  const [network, setNetwork] = useState<CascadeNetwork | null>(null);
  const [list, setList] = useState<LabExperimentSummary[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [niche, setNiche] = useState<number | null>(null);
  const [person, setPerson] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const { experiment, error: experimentError } = useLabExperiment(id);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ripple-theme', theme); } catch { /* Optional persistence. */ } }, [theme]);
  useEffect(() => { const params = new URLSearchParams(); params.set('brand', brand); if (id) params.set('exp', id); history.replaceState(null, '', `/lab-game?${params}`); }, [brand, id]);
  useEffect(() => {
    const abort = new AbortController(); let timer = 0;
    setNetwork(null); setError(''); setNiche(null); setPerson(null); setList([]);
    const refresh = async () => { const experiments = await listExperiments(brand, abort.signal); if (abort.signal.aborted) return; setList(experiments); setId(current => experiments.some(e => e.id === current) ? current : experiments.find(e => e.status === 'done')?.id ?? experiments[0]?.id ?? null); if (experiments.some(e => /queued|running/.test(e.status))) timer = window.setTimeout(() => void refresh().catch(() => {}), 5000); };
    void Promise.all([refresh(), loadAudience(brand, abort.signal).then(audience => prepareNetwork(buildLiveNetwork(audience, { maxNicheGroups: BRANDS.find(b => b.handle === brand)!.maxNiches, prepareLayout: false }), abort.signal)).then(next => { if (!abort.signal.aborted) setNetwork(next); })]).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load this audience.'); });
    return () => { abort.abort(); clearTimeout(timer); };
  }, [brand, revision]);
  useEffect(() => { const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; setProgress(reduced ? 1 : 0); setPlaying(!reduced); }, [id, draft]);
  useEffect(() => {
    if (!playing || progress >= 1 || experiment?.status !== 'done') return;
    const timer = setInterval(() => { if (!document.hidden) setProgress(p => Math.min(1, p + .01)); }, 120);
    return () => clearInterval(timer);
  }, [playing, experiment?.status, progress >= 1]);
  const valid = experiment?.id === id && experiment.brand === brand ? experiment : null;
  const source = valid ? (draft === 'A' ? valid.a : valid.b) : null;
  const run: LabRun | null = source?.status === 'done' ? { ...source, replayTick: Math.floor(source.replayMaxTick * progress) } : source;
  const members = niche === null ? undefined : new Set(network?.nodes.filter(n => n.community === niche).map(n => n.member.userId));
  const counts = run ? countsAt(run, members) : null;
  const selected = person === null ? null : network?.nodes[person];
  const visiblePeople = network?.nodes.filter(n => niche === null || n.community === niche) ?? [];
  const choosePerson = (next: number) => { setPerson(next); const group = network?.nodes[next].community; if (group !== undefined) setNiche(group); };
  return <main className="lg-page">
    <header className="lg-header"><a href="/" aria-label="Ripple home"><RippleMark /><span>Ripple <small>islands</small></span></a><nav aria-label="Visualization navigation"><a href="/lab">Lab</a><a aria-current="page" href="/lab-game">Islands</a></nav><div><select aria-label="Brand" value={brand} onChange={e => { setId(null); setBrand(e.target.value as BrandHandle); }}>{BRANDS.map(b => <option key={b.handle} value={b.handle}>{b.label}</option>)}</select><button aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div><WorkspaceAccount /></header>
    <aside className="lg-index" aria-label="Niche index"><span className="lg-eyebrow">YOUR AUDIENCE</span><button aria-current={niche === null ? 'true' : undefined} onClick={() => { setNiche(null); setPerson(null); }}>All islands <small>{network?.nodes.length ?? '—'}</small></button>{network?.communities.map((c, i) => <button key={c.slug} aria-current={niche === i ? 'true' : undefined} onClick={() => { setNiche(i); setPerson(null); }}><i style={{ background: c.color }} />{c.name}<small>{c.size}</small></button>)}</aside>
    <section className="lg-world" aria-label="Audience visualization">{error ? <div className="lg-state" role="alert"><p>{error}</p><button onClick={() => setRevision(v => v + 1)}>Try again</button></div> : network ? <GameCanvas network={network} run={run} draft={draft} theme={theme} niche={niche} person={person} onPerson={choosePerson} /> : <div className="lg-state" role="status"><img src="/lab-game/villager.png" alt="" /><span>Finding your islands…</span></div>}</section>
    <section className="lg-tools" aria-label="Experiment controls"><select aria-label="Experiment" value={id ?? ''} onChange={e => setId(e.target.value)}>{!list.length && <option value="">No experiments yet</option>}{list.map(e => <option key={e.id} value={e.id}>{e.title} · {e.status}</option>)}</select><div className="lg-drafts">{(['A', 'B'] as const).map(d => <button key={d} className={`lg-draft-${d.toLowerCase()}`} aria-pressed={draft === d} onClick={() => setDraft(d)}>Draft {d}</button>)}</div><div className="lg-play"><button aria-label={playing && progress < 1 ? 'Pause replay' : 'Play replay'} disabled={source?.status !== 'done'} onClick={() => { if (progress >= 1) setProgress(0); setPlaying(v => progress >= 1 || !v); }}>{playing && progress < 1 ? <Pause size={16} /> : <Play size={16} />}</button><button aria-label="Replay" disabled={source?.status !== 'done'} onClick={() => { setProgress(0); setPlaying(true); }}><RotateCcw size={16} /></button></div><p className="lg-status" aria-live="polite">{experimentError || (valid?.status === 'failed' ? valid.error : source?.status === 'done' ? 'Recorded trial' : valid?.status === 'queued' ? 'Queued…' : source?.status === 'scoring' ? 'Scoring…' : source ? 'Simulating…' : 'Audience overview')}</p></section>
    <footer className="lg-signals">{SIGNALS.map(s => <div key={s}><span>{SIGNAL_LABEL[s]}</span><strong>{counts?.[s] ?? '—'}</strong></div>)}<label className="lg-person-picker">Person<select aria-label="Audience person" value={person ?? ''} onChange={e => { if (e.target.value) choosePerson(Number(e.target.value)); else setPerson(null); }}><option value="">Choose a person</option>{visiblePeople.map(n => <option key={n.id} value={n.id}>@{n.handle}</option>)}</select></label></footer>
    {selected && <section className="lg-profile" aria-label="Selected person"><button aria-label="Close person" onClick={() => setPerson(null)}><X size={16} /></button>{selected.avatar && <img src={selected.avatar} referrerPolicy="no-referrer" alt="" />}<a href={selected.member.profileUrl} target="_blank" rel="noreferrer">{selected.name}<small>@{selected.handle}</small></a><p>{run?.events.filter(e => e.userId === selected.member.userId && e.tick <= run.replayTick).map(e => SIGNAL_LABEL[e.signal]).join(' · ') || 'No recorded reaction yet'}</p></section>}
    <a className="lg-credit" href="https://kenney.nl/assets/tiny-town" target="_blank" rel="noreferrer">Sprites by Kenney · CC0</a>
  </main>;
}
