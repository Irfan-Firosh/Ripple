import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, LoaderCircle, Moon, Pause, Play, Plus, RotateCcw, Sun } from 'lucide-react';
import { initialTheme } from './App';
import { RippleLogo } from './components/RippleLogo';
import { RippleWorkspaceNav } from './components/ui/floating-dock';
import { BRANDS } from './audience/liveAudience';
import { loadCampaignDrafts, type CampaignDrafts } from './creative/handoff';
import { runInLab } from './creative/runInLab';
import { previewResults, starterDrafts, type Draft, type Result } from './dashboard/preview';
import { NetworkCanvas } from './visuals/NetworkCanvas';
import { profiles } from './visuals/network';
import './lab/lab.css';
import './studio.css';
import './lab-v2.css';

type Comparison = { id: string; date: string; brand: string; results: Result[]; runs: number; creative: CampaignDrafts | null };
const params = () => new URLSearchParams(location.search);
const initialBrand = () => BRANDS.find(b => b.handle === params().get('brand'))?.handle ?? 'raycast.com';
const draftsFrom = (creative: CampaignDrafts | null): Draft[] => creative
  ? creative.variants.map((v, i) => ({ id: String.fromCharCode(65 + i), title: v.brief?.audienceLabel ?? v.segment,
    text: [v.headline, v.cta].filter(Boolean).join('\n\n') }))
  : starterDrafts.map(d => ({ ...d }));

function Distribution({ result }: { result: Result }) {
  return <div className="v2-distribution" role="img" aria-label={`Draft ${result.id}: sample median ${result.median} of 48 accounts; range ${result.low} to ${result.high}`}>
    <div>{result.histogram.map((n, i) => <i key={i} style={{ height: `${Math.max(4, n / Math.max(...result.histogram) * 100)}%` }} />)}</div>
    <footer><span>1 account</span><span>48 accounts</span></footer>
  </div>;
}

export default function LabV2() {
  const [theme, setTheme] = useState(initialTheme);
  const [brand, setBrand] = useState<string>(initialBrand);
  const [creative, setCreative] = useState(() => loadCampaignDrafts(params().get('handoff')));
  const [drafts, setDrafts] = useState(() => draftsFrom(creative));
  const [runs, setRuns] = useState(200);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [history, setHistory] = useState<Comparison[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  const [profile, setProfile] = useState(0);
  const [networkOpen, setNetworkOpen] = useState(false);
  const dirty = useMemo(() => Boolean(comparison && (runs !== comparison.runs || drafts.length !== comparison.results.length
    || drafts.some(d => comparison.results.find(r => r.id === d.id)?.text !== d.text))), [comparison, drafts, runs]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme; document.title = 'Lab v2 — Ripple';
    try { localStorage.setItem('ripple-theme', theme); } catch { /* optional */ }
  }, [theme]);
  const reset = (nextBrand = brand) => {
    setBrand(nextBrand); setCreative(null); setDrafts(draftsFrom(null)); setComparison(null); setError('');
    window.history.replaceState(null, '', '/lab-v2?' + new URLSearchParams({ brand: nextBrand }));
  };
  const compare = () => {
    if (drafts.some(d => !d.text.trim())) { setError('Add text to every draft.'); return; }
    const next = { id: crypto.randomUUID(), date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      brand, results: previewResults(drafts, runs), runs, creative };
    setComparison(next); setHistory(h => [next, ...h]); setError(''); setReplay(n => n + 1); setPlaying(true);
  };
  const exportSample = () => {
    if (!comparison) return;
    const report = { mode: 'illustrative-preview', audience: comparison.brand, runs: comparison.runs,
      results: comparison.results, calibrated: false, creativeContext: comparison.creative };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ripple-sample-comparison.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const run = async () => {
    if (busy || drafts.length !== 2 || drafts.some(d => !d.text.trim())) return;
    setBusy(true); setError('');
    try {
      const href = await runInLab({ brand, title: (creative?.campaign.name ?? 'Campaign comparison').slice(0, 80),
        draftA: drafts[0].text.trim(), draftB: drafts[1].text.trim() });
      location.assign(href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the simulation.'); setBusy(false); }
  };
  const load = (item: Comparison) => {
    setBrand(item.brand); setDrafts(item.results.map(({ id, title, text }) => ({ id, title, text })).sort((a, b) => a.id.localeCompare(b.id)));
    setRuns(item.runs); setCreative(item.creative); setComparison(item); setError('');
    window.history.replaceState(null, '', '/lab-v2?' + new URLSearchParams({ brand: item.brand }));
  };

  return <main className="lab-page campaign-page v2-page">
    <header className="lab-header workspace-header">
      <RippleLogo />
      <span className="lab-crumb">Lab v2</span><RippleWorkspaceNav brand={brand} />
      <nav className="lab-brands" aria-label="Audience">{BRANDS.map(b => <button key={b.handle} disabled={busy}
        aria-current={b.handle === brand ? 'page' : undefined} onClick={() => reset(b.handle)}>{b.label}</button>)}</nav>
      <button className="lab-icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
    <WorkspaceAccount /></header>
    <div className="campaign-main">
      <div className="campaign-toolbar"><div><h1>{creative?.campaign.name ?? 'Compare drafts'}</h1>
        {creative?.recordedRehearsal && <span className="campaign-recorded">Recorded demo</span>}</div>
        <button className="lab-secondary" disabled={busy} onClick={() => reset()}><Plus size={14} /> New comparison</button>
      </div>
      {params().has('handoff') && !creative && !comparison && <p className="campaign-muted">The campaign transfer expired. Reopen your concepts from Campaigns.</p>}
      <div className="campaign-grid">{drafts.map(draft => {
        const variant = creative?.variants[draft.id.charCodeAt(0) - 65];
        return <article className="v2-draft" key={draft.id}>
          <div className="campaign-concept-header"><span>Draft {draft.id}</span><span>{variant?.brief?.audienceLabel}</span></div>
          <div className="v2-editor">
            {variant?.imageUrl && <img className="v2-image" src={variant.imageUrl} alt={`Campaign concept ${draft.id}`} />}
            <label htmlFor={'v2-' + draft.id}>Post text</label><textarea id={'v2-' + draft.id} aria-label={'Draft ' + draft.id} maxLength={1000}
              disabled={busy} rows={5} value={draft.text} onChange={e => setDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, text: e.target.value } : d))} />
            {variant?.brief && <details className="campaign-details"><summary>Brief</summary><p>{variant.brief.messageAngle}</p></details>}
            {draft.id === 'C' && <button className="campaign-text-button" onClick={() => setDrafts(ds => ds.filter(d => d.id !== 'C'))}>Remove draft C</button>}
          </div>
        </article>;
      })}</div>
      <div className="v2-actions">
        <div><button className="lab-primary" disabled={busy || drafts.length !== 2 || drafts.some(d => !d.text.trim())} onClick={() => void run()}>
          {busy ? <LoaderCircle size={14} className="campaign-spin" /> : <Play size={14} />}{busy ? 'Starting…' : 'Run in Lab'}<ArrowRight size={14} /></button>
          <p className="campaign-muted">{drafts.length === 3 ? 'Main Lab compares two drafts. Remove draft C to run.' : 'Text simulation · full brand audience'}</p></div>
        <details className="v2-sample-options"><summary>Sample tools</summary><div>
          <label>Runs per draft<select value={runs} onChange={e => setRuns(Number(e.target.value))}>{[50, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          {drafts.length < 3 && <button className="lab-secondary" onClick={() => setDrafts(ds => [...ds, { id: 'C', title: 'Another angle', text: '' }])}><Plus size={14} /> Add a third draft</button>}
          <button className="lab-secondary" onClick={compare}>Compare sample</button>
        </div></details>
      </div>
      {error && <p className="campaign-error" role="alert">{error}</p>}
      {comparison && <section className="v2-results" aria-label="Sample results">
        <header><h2>Sample comparison</h2><span>{dirty ? 'Drafts changed' : 'Illustrative · 48 accounts'}</span>
          <button className="lab-secondary" onClick={exportSample}><Download size={13} /> Export sample</button></header>
        <div className="campaign-grid">{comparison.results.map((r, i) => <article key={r.id}>
          <div className="v2-result-heading"><span>Draft {r.id}</span>{i === 0 && <span>{comparison.results[1]?.median === r.median ? 'Same sample reach' : 'Highest sample reach'}</span>}</div>
          <strong>{r.median}<small> / 48 accounts</small></strong><Distribution result={r} />
          <p>Range {r.low}–{r.high} · {r.penetration} of 4 communities</p>
        </article>)}</div>
        <details className="v2-network" onToggle={e => setNetworkOpen(e.currentTarget.open)}><summary>Sample network</summary>
          {networkOpen && <div className="v2-network-stage"><NetworkCanvas concept="constellation" theme={theme} playing={playing} selected={profile} onSelect={setProfile} replay={replay} /></div>}
          <footer><button className="lab-icon" aria-label={playing ? 'Pause cascade' : 'Play cascade'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
            <button className="lab-icon" aria-label="Replay cascade" onClick={() => { setReplay(n => n + 1); setPlaying(true); }}><RotateCcw size={14} /></button>
            <span>{profiles[profile].name} · sample network</span></footer>
        </details>
      </section>}
    </div>
    <nav className="lab-dock" aria-label="Sample comparison history"><button className="lab-dock-new" disabled={busy} onClick={() => reset()}><Plus size={16} /> New</button>
      {history.filter(h => h.brand === brand).map(h => <button key={h.id} disabled={busy} aria-current={comparison?.id === h.id ? 'true' : undefined} onClick={() => load(h)}>
        <i className="lab-dock-dot" /><span className="lab-dock-title">{h.date}</span><span className="lab-dock-badge">{h.results[0].id}</span>
      </button>)}
    </nav>
  </main>;
}
import { WorkspaceAccount } from './components/WorkspaceAccount';
