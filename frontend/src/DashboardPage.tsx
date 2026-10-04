import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Show, UserButton, useUser } from '@clerk/react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';
import { LayoutDashboard, Compass, FileText, Network, History, ArrowUpRight, ArrowRight, Plus, Play, Pause, RotateCcw, Sun, Moon, Menu, X, Download, Check, SlidersHorizontal } from 'lucide-react';
import { RippleMark, initialTheme } from './App';
import { NetworkCanvas } from './visuals/NetworkCanvas';
import { communities, profiles } from './visuals/network';
import { previewResults, starterDrafts, type Draft, type Result } from './dashboard/preview';
import './dashboard.css';

type View = 'overview' | 'discover' | 'drafts' | 'audience' | 'runs';
const views = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'drafts', label: 'Draft lab', icon: FileText },
  { id: 'audience', label: 'Audience', icon: Network },
  { id: 'runs', label: 'Simulation history', icon: History },
] as const;
const scouts: { name: string; shape: BotAvatarType; color: string }[] = [
  { name: 'Social scout', shape: 'clover', color: '#88b9ed' },
  { name: 'Narrative scout', shape: 'star', color: '#e6bc88' },
  { name: 'Community scout', shape: 'flower', color: '#93c6b1' },
];
const signals = [
  { topic: 'Build in public, with receipts.', community: 'AI builders', text: 'Concrete demos and small, useful tools make a better starting point than another big announcement.', source: 'Bluesky · example narrative', draft: 'What if you could watch your next idea spread before you post it? Here is the open-source demo we built. Try it and tell us what surprised you.' },
  { topic: 'Less friction. More making.', community: 'Design & tools', text: 'Lead with the task your tool makes easier. Show the workflow, then explain the technology.', source: 'Web · example narrative', draft: 'Your next post deserves more than a guess. Try two hooks, watch where each one travels, and pick the one that reaches a new community.' },
  { topic: 'Open tools, shared progress.', community: 'Open source', text: 'A specific invitation gives people a way to take part: test, contribute, or share what they found.', source: 'Hacker News · example narrative', draft: 'We built Ripple in the open. Can you help us find what makes an idea travel? Try the demo and share one thing you would change.' },
];
function Distribution({ result }: { result: Result }) {
  return <div className="dash-distribution" role="img" aria-label={`Draft ${result.id}: sample reach, 10th to 90th percentile ${result.low} to ${result.high} accounts; median ${result.median}`}>
    <div className="dash-bars">{result.histogram.map((value, i) => <i key={i} style={{ height: `${Math.max(4, value / Math.max(...result.histogram) * 100)}%` }} />)}</div>
    <div className="dash-axis"><span>1 account</span><span>48 accounts</span></div>
  </div>;
}
export default function DashboardPage() {
  const { user } = useUser();
  const [theme, setTheme] = useState(initialTheme);
  const [view, setView] = useState<View>('overview');
  const [mobile, setMobile] = useState(false);
  const [scoutsPaused, setScoutsPaused] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(starterDrafts);
  const [runs, setRuns] = useState(200);
  const [results, setResults] = useState(() => previewResults(starterDrafts, 200));
  const [resultRuns, setResultRuns] = useState(200);
  const [selectedDraft, setSelectedDraft] = useState('B');
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  const [handle, setHandle] = useState('ripple-demo.bsky.social');
  const [handleInput, setHandleInput] = useState(handle);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{ id: number; date: string; results: Result[]; runs: number; handle: string }[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = 'Workspace — Ripple';
    try { localStorage.setItem('ripple-theme', theme); } catch { /* Optional. */ }
  }, [theme]);
  useEffect(() => {
    if (!mobile) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobile(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mobile]);
  const current = results.find(r => r.id === selectedDraft) ?? results[0];
  const profile = profiles[selectedProfile];
  const dirty = useMemo(() => drafts.some(d => results.find(r => r.id === d.id)?.text !== d.text) || drafts.length !== results.length, [drafts, results]);
  const navigate = (next: View) => { setView(next); setMobile(false); setError(''); setNotice(''); };
  const simulate = () => {
    if (drafts.some(d => !d.text.trim())) { setError('Add text to every draft before comparing.'); return; }
    const next = previewResults(drafts, runs);
    setResults(next); setResultRuns(runs); setSelectedDraft(next[0].id); setReplay(n => n+1); setPlaying(true);
    setHistory(h => [{ id: Date.now(), date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), results: next, runs, handle }, ...h]);
    setError(''); setView('overview'); setNotice('Sample comparison complete. These are illustrative results, not a prediction.');
  };
  const exportResults = () => {
    const report = { mode: 'illustrative-preview', audience: handle, runs: resultRuns, results, calibrated: false };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ripple-sample-comparison.json'; link.click(); URL.revokeObjectURL(url);
    setNotice('Sample comparison exported.');
  };
  const loadAudience = (event: FormEvent) => {
    event.preventDefault(); const value = handleInput.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(value)) { setError('Enter a Bluesky handle, such as name.bsky.social.'); return; }
    setHandle(value); setError(''); setNotice('Sample workspace label updated. No live Bluesky data was fetched.');
  };
  const network = <section className="dash-card dash-network">
    <div className="dash-card-head"><div><span className="dash-eyebrow">WATCH IT SPREAD</span><h2>Your audience, connected.</h2></div><span className="dash-chip">Illustrative cascade</span></div>
    <div className="dash-network-stage"><NetworkCanvas concept="constellation" theme={theme} playing={playing} selected={selectedProfile} onSelect={setSelectedProfile} replay={replay} /><div className="dash-network-controls"><button aria-label={playing ? 'Pause cascade' : 'Play cascade'} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><button aria-label="Replay cascade" onClick={() => { setReplay(n=>n+1); setPlaying(true); }}><RotateCcw size={14} /></button><span>Drag to orbit · select a node</span></div></div>
    <div className="dash-network-bottom"><div className="dash-legend">{communities.map(c => <span key={c.name}><i style={{ background: c.color }} />{c.name}</span>)}</div><span>{profile.name} · sample {profile.role.toLowerCase()}</span></div>
  </section>;
  return <div className="ripple-workspace">
    {mobile && <button className="dash-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <aside className={`dash-sidebar${mobile ? ' is-open' : ''}`}>
      <a className="brand" href="/"><RippleMark size={29} /><span>Ripple</span></a>
      <button className="dash-workspace-picker" onClick={() => navigate('audience')}><span className="dash-workspace-icon"><Network size={16} /></span><span>Sample workspace<small>@{handle}</small></span><SlidersHorizontal size={13} /></button>
      <span className="dash-nav-label">WORKSPACE</span>
      <nav aria-label="Workspace navigation">{views.map(item => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === 'drafts' && <small>{drafts.length}</small>}</button>)}</nav>
      <div className="dash-sidebar-bottom"><div className="dash-twin-note"><RippleMark size={22} /><p>A little clarity<br />before you post.</p><a href="/research/ripple-design.md">Explore the project <ArrowUpRight size={12} /></a></div><a className="dash-home" href="/">Back to the landing page <ArrowUpRight size={13} /></a></div>
    </aside>
    <div className="dash-main">
      <header className="dash-topbar"><div><button className="dash-menu" aria-label={mobile ? 'Close navigation' : 'Open navigation'} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>{mobile ? <X size={19} /> : <Menu size={19} />}</button><span>Workspace <span className="dash-slash">/</span> {views.find(v=>v.id===view)?.label}</span></div><div className="dash-top-actions"><span className="dash-preview-tag"><i /> Sample data</span><button aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><Show when="signed-in"><UserButton /></Show><Show when="signed-out"><a href="/auth/sign-in">Sign in <ArrowUpRight size={12} /></a></Show></div></header>
      <main className="dash-content">
        <div className="dash-heading"><div><span className="dash-eyebrow">{user?.firstName ? `WELCOME BACK, ${user.firstName.toUpperCase()}` : 'A LITTLE CLARITY BEFORE YOU POST'}</span><h1>{view === 'overview' ? 'Your next ripple.' : view === 'discover' ? 'Find the conversation.' : view === 'drafts' ? 'One idea. More possibilities.' : view === 'audience' ? 'Know the connections.' : 'Every ripple, revisited.'}</h1><p>{view === 'overview' ? 'Explore your audience. Compare your drafts. Find the way through.' : view === 'discover' ? 'A starting point for your next idea, shaped by community signals.' : view === 'drafts' ? 'Change the hook. Compare the possibilities before you publish.' : view === 'audience' ? 'Public behavior, connected communities, and the bridges between them.' : 'Review your sample comparisons and pick up where you left off.'}</p></div><button className="dash-primary" onClick={() => navigate('drafts')}><Plus size={15} /> New comparison</button></div>
        {notice && <div className="dash-notice" role="status"><Check size={15} />{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={14} /></button></div>}
        <div className="dash-context"><span><i /> @{handle}</span><span>48 sample accounts · 4 communities</span><button onClick={() => navigate('audience')}>Change audience <ArrowRight size={13} /></button></div>
        {view === 'overview' && <>
          <div className="dash-metrics">{[{ label: 'Audience mapped', value: '48', sub: 'Sample accounts', icon: Network }, { label: 'Communities', value: '4', sub: 'Connected clusters', icon: Compass }, { label: 'Drafts compared', value: String(results.length), sub: `${resultRuns} sample runs per draft`, icon: FileText }, { label: 'Audience analysis accuracy', value: '—', sub: 'Not calibrated yet', icon: SlidersHorizontal }].map(metric => <article className="dash-card dash-metric" key={metric.label}><div><span>{metric.label}</span><metric.icon size={16} /></div><strong>{metric.value}</strong><small>{metric.sub}</small></article>)}</div>
          <div className="dash-analysis-grid">{network}<section className="dash-card dash-compare"><div className="dash-card-head"><div><span className="dash-eyebrow">COMPARE THE POSSIBILITIES</span><h2>A different first signal.</h2></div><button aria-label="Edit drafts" onClick={() => navigate('drafts')}><ArrowUpRight size={17} /></button></div><div className="dash-draft-tabs" role="group" aria-label="Choose a draft">{results.map(r => <button key={r.id} aria-pressed={current.id===r.id} onClick={() => setSelectedDraft(r.id)}>Draft {r.id}{r.id===results[0].id && <i />}</button>)}</div><p className="dash-quote">“{current.text}”</p><div className="dash-reach"><span>Sample median reach</span><strong>{current.median}<small> / 48 accounts</small></strong></div><Distribution result={current} /><div className="dash-result-detail"><span>10th–90th percentile<strong>{current.low}–{current.high} accounts</strong></span><span>Sample communities<strong>{current.penetration} of 4</strong></span></div><button className="dash-text-action" onClick={() => navigate('drafts')}>Try a different hook <ArrowRight size={14} /></button></section></div>
          <div className="dash-lower-grid"><section className="dash-card"><div className="dash-card-head"><div><span className="dash-eyebrow">WHERE IT COULD GO</span><h2>Beyond your first circle.</h2></div><button className="dash-text-action" onClick={() => navigate('audience')}>View audience <ArrowUpRight size={13} /></button></div><div className="dash-community-list">{communities.map((c,i)=><div key={c.name}><i style={{background:c.color}}/><span>{c.name}<small>12 sample accounts</small></span><div className="dash-community-meter"><i style={{ width: `${[84,62,43,28][i]}%`, background:c.color }} /></div><strong>{i===0 ? 'Starting circle' : 'Connected'}</strong></div>)}</div></section><section className="dash-card dash-insight"><span className="dash-eyebrow">A BETTER QUESTION</span><h2>What makes an idea<br />leave its niche?</h2><p>Try an invitation instead of an announcement. In the sample model, a question and a clear next step change the reach distribution.</p><button className="dash-text-action" onClick={() => navigate('drafts')}>Explore the hook <ArrowRight size={14} /></button><span className="dash-insight-mark" aria-hidden="true"><RippleMark size={120}/></span></section></div>
        </>}
        {view === 'drafts' && <div className="dash-lab-layout"><section className="dash-card dash-editor"><div className="dash-card-head"><div><span className="dash-eyebrow">DRAFT LAB</span><h2>Give every draft a chance.</h2></div><span className="dash-chip">{dirty ? 'Uncompared edits' : 'Compared'}</span></div>{drafts.map((draft, index) => <div className="dash-draft-editor" key={draft.id}><label htmlFor={`draft-${draft.id}`}><span>Draft {draft.id}</span><small>{draft.text.length} characters</small></label><textarea id={`draft-${draft.id}`} maxLength={300} value={draft.text} onChange={event=>setDrafts(ds=>ds.map(d=>d.id===draft.id ? {...d,text:event.target.value} : d))} />{index===2 && <button className="dash-text-action" onClick={()=>setDrafts(ds=>ds.slice(0,2))}>Remove draft C</button>}</div>)}{drafts.length<3 && <button className="dash-secondary" onClick={()=>setDrafts(ds=>[...ds,{id:'C',title:'Another angle',text:''}])}><Plus size={14}/> Add a third draft</button>}<div className="dash-run-options"><label>Runs per draft<select value={runs} onChange={e=>setRuns(Number(e.target.value))}><option value={50}>50 · Quick exploration</option><option value={200}>200 · Standard comparison</option><option value={500}>500 · Deeper comparison</option></select></label><button className="dash-primary" onClick={simulate}><Play size={14}/> Compare sample drafts</button></div>{error && <p className="dash-error" role="alert">{error}</p>}</section><aside className="dash-card dash-lab-guide"><span className="dash-eyebrow">A SMALL CHANGE</span><h2>Start with the hook.</h2><p>Keep the idea. Change the way it opens.</p><ol><li>Lead with a question your community cares about.</li><li>Show what someone can do with it.</li><li>Give them a reason to carry it forward.</li></ol><div className="dash-calibration"><SlidersHorizontal size={20}/><h3>Ranges, not promises.</h3><p>This preview uses a simple local model on 48 sample accounts. It isn’t calibrated against real posts.</p></div></aside></div>}
        {view === 'discover' && <><div className="dash-discover-banner"><Compass size={24}/><div><h2>Listen before you write.</h2><p>Example narratives for this sample audience. Live scouting hasn’t been connected.</p></div><button className="dash-secondary dash-scout-toggle" aria-pressed={scoutsPaused} onClick={()=>setScoutsPaused(!scoutsPaused)}>{scoutsPaused ? <Play size={13}/> : <Pause size={13}/>}{scoutsPaused ? 'Animate scouts' : 'Pause scouts'}</button></div><div className="dash-signal-grid">{signals.map((signal,i)=><article className="dash-card dash-signal" key={signal.topic}><div className="dash-scout-head"><div className="dash-scout-avatar"><BotAvatar type={scouts[i].shape} size={96} color={scouts[i].color} saturation={1} brightness={1} face="mouth" shading="fabric" state="default" theme={theme} paused={scoutsPaused} interactive={!scoutsPaused} seed={i / 3} speed={.7} jumpEvery={12} aria-label={`${scouts[i].name} — sample agent avatar`} /></div><div className="dash-scout-label"><strong>{scouts[i].name}</strong><span>Sample agent</span></div></div><span className="dash-eyebrow">0{i+1} / {signal.community.toUpperCase()}</span><h2>{signal.topic}</h2><p>{signal.text}</p><small>{signal.source}</small><button className="dash-secondary" onClick={()=>{setDrafts(ds=>ds.map(d=>d.id==='B'?{...d,text:signal.draft}:d));navigate('drafts');}} >Use as a starting point <ArrowRight size={14}/></button></article>)}</div></>}
        {view === 'audience' && <><form className="dash-card dash-audience-form" onSubmit={loadAudience}><div><span className="dash-eyebrow">YOUR STARTING POINT</span><h2>A handle. A whole network.</h2><p>Set the label for your sample workspace. Live graph building will connect here.</p></div><label>Bluesky handle<input value={handleInput} onChange={e=>setHandleInput(e.target.value)} placeholder="name.bsky.social" /></label><button className="dash-secondary" type="submit">Update sample label <ArrowRight size={14}/></button>{error && <p className="dash-error" role="alert">{error}</p>}</form>{network}<section className="dash-card dash-audience-communities"><div className="dash-card-head"><h2>Four communities. Shared connections.</h2><span className="dash-chip">Public behavior only</span></div><div className="dash-community-tiles">{communities.map((c,i)=><button key={c.name} onClick={()=>setSelectedProfile(i*12)} aria-pressed={Math.floor(selectedProfile/12)===i}><i style={{background:c.color}}/><h3>{c.name}</h3><span>12 sample accounts · 1 example bridge</span></button>)}</div></section></>}
        {view === 'runs' && <section className="dash-card dash-history"><div className="dash-card-head"><div><span className="dash-eyebrow">SIMULATION HISTORY</span><h2>Pick up the thread.</h2></div><button className="dash-secondary" onClick={exportResults}><Download size={14}/> Export sample</button></div>{history.length ? <div className="dash-history-list">{history.map((run,i)=><button key={run.id} onClick={()=>{setResults(run.results);setResultRuns(run.runs);setRuns(run.runs);setHandle(run.handle);setHandleInput(run.handle);setDrafts(run.results.map(({id,title,text})=>({id,title,text})).sort((a,b)=>a.id.localeCompare(b.id)));setSelectedDraft(run.results[0].id);setView('overview');setNotice(`Opened sample comparison ${history.length-i} for @${run.handle}.`);}}><span><FileText size={17}/><strong>Comparison {history.length-i}<small>{run.results.length} drafts · {run.runs} runs each · @{run.handle}</small></strong></span><span>Draft {run.results[0].id} leads <small>{run.date}</small></span><ArrowUpRight size={16}/></button>)}</div>:<div className="dash-empty"><History size={32}/><h3>Your next comparison starts here.</h3><p>Run a sample comparison in the draft lab to add it to this session’s history.</p><button className="dash-primary" onClick={()=>navigate('drafts')}>Open draft lab <ArrowRight size={14}/></button></div>}</section>}
        <footer className="dash-footnote"><span>Sample workspace · illustrative distributions, not real-world forecasts.</span><a href="/research/ripple-design.md">How Ripple works <ArrowUpRight size={12}/></a></footer>
      </main>
    </div>
  </div>;
}
