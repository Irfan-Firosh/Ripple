import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, History, Moon, Sun, RotateCcw, Plus, Minus, X } from 'lucide-react';
import { RippleMark, initialTheme } from './App';
import { Loader } from './components/ui/loader';
import { RippleWorkspaceNav } from './components/ui/floating-dock';
import { BRANDS, loadAudience } from './audience/liveAudience';
import { buildLiveNetwork, NetworkSizeError, type CascadeNetwork } from './visuals/liveNetwork';
import { CascadeCanvas } from './visuals/CascadeCanvas';
import { prepareNetwork } from './visuals/prepareNetwork';
import './network-test.css';
import { HistoryDrawer } from './history/HistoryDrawer';
import { listActiveBrands, loadAudienceSnapshot } from './history/historyData';

type LoadState = { status: 'loading'; preparing?:boolean } | { status: 'error'|'oversized'; message: string } | { status: 'ready'; network: CascadeNetwork };

// Loads the scraped audience from SpacetimeDB. There is no sample fallback: if the database can't be read, say so.
type Brand = { handle: string; label: string; platform: 'x' | 'bluesky'; maxNiches: number };

function brandFromUrl(): Brand {
  const wanted = new URLSearchParams(location.search).get('brand')?.toLowerCase();
  return BRANDS.find(b => b.handle === wanted) ?? (wanted && /^[a-z0-9_]{1,15}$/.test(wanted)
    ? { handle: wanted, label: `@${wanted}`, platform: 'x', maxNiches: 6 } : BRANDS[0]);
}

function useAudienceNetwork(brand: Brand, snapshot: string | null) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0, fingerprint = '', loaded = false;
    setState({ status: 'loading' });
    const poll = async () => {
      try {
        const audience = snapshot ? await loadAudienceSnapshot(snapshot, controller.signal) : await loadAudience(brand.handle, controller.signal, true);
        const next = JSON.stringify(audience);
        if (controller.signal.aborted) return;
        if (next !== fingerprint) {
          const network = buildLiveNetwork(audience, { maxNicheGroups: brand.maxNiches, prepareLayout: false });
          if (!loaded) setState({ status: 'loading', preparing: true });
          await prepareNetwork(network, controller.signal);
          if (controller.signal.aborted) return;
          setState({ status: 'ready', network }); fingerprint = next; loaded = true;
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (!loaded || error instanceof NetworkSizeError) setState({ status: error instanceof NetworkSizeError ? 'oversized' : 'error', message: error instanceof Error ? error.message : 'SpacetimeDB could not be reached.' });
      }
      if (!snapshot && !controller.signal.aborted) timer = window.setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt, brand, snapshot]);
  return { state, retry: useCallback(() => setAttempt(n => n + 1), []) };
}

export default function NetworkTestPage({workspace=false}:{workspace?:boolean}) {
  const [theme,setTheme]=useState(initialTheme);
  const [brand, setBrand]=useState(brandFromUrl);
  const [snapshot] = useState(() => new URLSearchParams(location.search).get('snapshot'));
  const [showHistory, setShowHistory] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([brand]);
  const { state, retry } = useAudienceNetwork(brand, snapshot);
  useEffect(() => {
    const controller = new AbortController();
    listActiveBrands(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setBrands(rows.some(b => b.handle === brand.handle) ? rows : [brand, ...rows]);
      if (!new URLSearchParams(location.search).has('brand') && rows.length && !rows.some(b => b.handle === brand.handle)) setBrand(rows[0]);
    }).catch(() => { /* The map presents read errors; its history remains accessible. */ });
    return () => controller.abort();
  }, [brand]);
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.title=workspace?'Dashboard — Ripple':'Network playground — Ripple';
    try{localStorage.setItem('ripple-theme',theme);}catch{/* Optional. */}
  },[theme,workspace]);
  const toggleTheme=<button className="nt-icon-button" aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;
  const header=(subtitle:string)=><header className={`nt-header${workspace?' nt-header--workspace':''}`}>
    <a className="brand" href="/" aria-label="Ripple home"><RippleMark size={27}/><span>Ripple</span></a>
    <span className="nt-page-name">{workspace?'Audience':'Network playground'} <i/> {subtitle}</span>
    {workspace&&<RippleWorkspaceNav brand={brand.handle}/>}
    <nav className="nt-brands" aria-label="Brand audience">{brands.map(b=><a key={b.handle} href={`?brand=${b.handle}`} aria-current={b.handle===brand.handle?'page':undefined}>{b.label}<span>{b.platform==='bluesky'?'Bluesky':'X'}</span></a>)}</nav>
    <div className="nt-header-actions">{snapshot && <a className="nt-replay" href={`/dashboard?brand=${encodeURIComponent(brand.handle)}`}>Live audience</a>}<button className="nt-icon-button" aria-label="Open history" onClick={() => setShowHistory(true)}><History size={16}/></button>{!workspace&&<a href="/dashboard" aria-label="Back to workspace"><ArrowLeft size={15}/></a>}{toggleTheme}</div>
    {showHistory && <HistoryDrawer kind="audience" activeId={snapshot} onClose={() => setShowHistory(false)} onSelect={entry => location.assign(entry.kind === 'audience'
      ? `/dashboard?brand=${encodeURIComponent(entry.brand)}&snapshot=${encodeURIComponent(entry.id)}` : `/lab?brand=${encodeURIComponent(entry.brand)}&exp=${encodeURIComponent(entry.id)}`)} />}
  </header>;
  if(state.status!=='ready') return <main className="network-test">
    {header('Live audience')}
    <div className="nt-state" role="status" aria-live="polite">
      {state.status==='loading'
        ? <><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true"/><p>{state.preparing?'Arranging people by shared interests…':'Reading the audience from SpacetimeDB…'}</p></>
        : state.status==='oversized'?<p>{state.message}</p>: <><p>Couldn't load the audience. {state.message}</p><button className="nt-replay" onClick={retry}><RotateCcw size={14}/> Try again</button></>}
    </div>
  </main>;
  return <AudienceView key={state.network.nodes.map(n => n.member.userId).join('|')} network={state.network} theme={theme} header={header(`@${state.network.source.handle} ${snapshot ? 'saved audience' : 'audience'} · ${state.network.nodes.length} people`)}/>;
}

function AudienceView({network,theme,header}:{network:CascadeNetwork;theme:'dark'|'light';header:React.ReactNode}) {
  const [selected,setSelected]=useState<number|null>(null);
  const [focus,setFocus]=useState<number|null>(null);
  const [zoomStep,setZoomStep]=useState(0);
  const [reset,setReset]=useState(0);
  const [prepared,setPrepared]=useState(false);
  const resetView=()=>{setFocus(null);setReset(n=>n+1);};
  const chosen=selected===null?null:network.nodes[selected];
  return <main className="network-test">
    {header}
    <aside className="nt-index" aria-label="Niche index"><span className="nt-eyebrow">THE AUDIENCE · BY NICHE</span><div className="nt-community-index">{network.communities.map((community,index)=><button key={community.slug} aria-pressed={focus===index} onClick={()=>{setFocus(index);setSelected(null);}}><span className="nt-index-number">{String(index+1).padStart(2,'0')}</span><i style={{background:community.color}}/><span>{community.name}</span><span className="nt-index-count">{community.size}</span></button>)}</div><button className="nt-all" onClick={resetView} aria-pressed={focus===null}>All niches <ArrowLeft size={12}/></button></aside>
    <section className="nt-stage" aria-label="Network visualization" aria-busy={!prepared}><CascadeCanvas network={network} view="3d" audienceOnly elapsed={network.duration} theme={theme} selected={selected} focus={focus} zoomStep={zoomStep} reset={reset} onSelect={setSelected} onPrepared={setPrepared}/>{!prepared&&<div className="nt-state" role="status"><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true"/><p>Preparing the network…</p></div>}</section>
    {chosen&&<aside className="nt-selection" aria-label="Selected account"><button className="nt-close" aria-label="Close account details" onClick={()=>setSelected(null)}><X size={15}/></button>
      <div className="nt-person">{chosen.avatar&&<img src={chosen.avatar} alt="" referrerPolicy="no-referrer"/>}<div><h2>{chosen.name}</h2><a href={chosen.member.profileUrl} target="_blank" rel="noreferrer">@{chosen.handle}</a></div></div>
      <ul className="nt-niches">{chosen.member.niches.map(n=><li key={n.slug}><span>{n.label}</span>{!chosen.member.pending && <b>{Math.round(n.affinity*100)}%</b>}</li>)}</ul>
      <p className="nt-summary">{chosen.member.personaSummary}</p>
      {!chosen.member.pending && <span className="nt-eyebrow">{chosen.member.postCount} POSTS SCRAPED · {(chosen.member.engagementRate*100).toFixed(1)}% ENGAGEMENT</span>}
    </aside>}
    <div className="nt-controls"><button className="nt-icon-button" aria-label="Zoom in" onClick={()=>setZoomStep(n=>n+1)}><Plus size={16}/></button><button className="nt-icon-button" aria-label="Zoom out" onClick={()=>setZoomStep(n=>n-1)}><Minus size={16}/></button><button className="nt-icon-button" aria-label="Reset network view" onClick={resetView}><RotateCcw size={14}/></button></div>
    <span className="nt-hint" title="Nearby people share niche interests or have recorded reply/mention connections. Distances are approximate, not geographic.">Closer = shared interests or connections · drag to orbit · scroll to zoom</span>
  </main>;
}
