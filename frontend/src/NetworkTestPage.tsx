import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Moon, Sun, Pause, Play, RotateCcw, Plus, Minus, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { RippleMark, initialTheme } from './App';
import { Loader } from './components/ui/loader';
import { RippleWorkspaceNav } from './components/ui/floating-dock';
import { BRANDS, loadAudience } from './audience/liveAudience';
import { loadSimRun, type SimRunState } from './audience/liveSimulation';
import { buildLiveNetwork, NetworkSizeError, type CascadeNetwork } from './visuals/liveNetwork';
import { CascadeCanvas } from './visuals/CascadeCanvas';
import { prepareNetwork } from './visuals/prepareNetwork';
import './network-test.css';

type LoadState = { status: 'loading'; preparing?:boolean } | { status: 'error'|'oversized'; message: string } | { status: 'ready'; network: CascadeNetwork };

// Loads the scraped audience from SpacetimeDB. There is no sample fallback: if the database can't be read, say so.
type Brand = (typeof BRANDS)[number];

function brandFromUrl(): Brand {
  const wanted = new URLSearchParams(location.search).get('brand')?.toLowerCase();
  return BRANDS.find(b => b.handle === wanted) ?? BRANDS[0];
}

function useAudienceNetwork(brand: Brand) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadAudience(brand.handle, controller.signal)
      .then(audience => {
        if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
        const network=buildLiveNetwork(audience,{maxNicheGroups:brand.maxNiches,prepareLayout:false});
        setState({status:'loading',preparing:true});
        return prepareNetwork(network,controller.signal);
      })
      .then(network=>{if(!controller.signal.aborted)setState({status:'ready',network});})
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: error instanceof NetworkSizeError?'oversized':'error', message: error instanceof Error ? error.message : 'SpacetimeDB could not be reached.' });
      });
    return () => controller.abort();
  }, [attempt, brand]);
  return { state, retry: useCallback(() => setAttempt(n => n + 1), []) };
}

type Replay = { run: SimRunState | null; tick: number; error: string | null; restart: () => void };
const REPLAY_STEP_MS = 700; // same pace as the cascade_tick reducer

// Follows one simulation run: polls SpacetimeDB while the cascade replays live, and replays a finished run locally.
function useSimReplay(runId: string | null): Replay | null {
  const [run, setRun] = useState<SimRunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const sawLive = useRef(false);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = () => loadSimRun(runId, controller.signal).then(next => {
      setRun(next); setError(null);
      if (next.status !== 'done') { sawLive.current = true; timer = window.setTimeout(poll, 500); }
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The simulation could not be read.'); });
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId]);
  const done = run?.status === 'done';
  const maxTick = run?.replayMaxTick ?? 0;
  useEffect(() => {
    if (!run) return;
    if (!done) { setTick(run.replayTick); return; }
    if (sawLive.current && restarts === 0) { setTick(maxTick); return; } // watched it live: stay on the final state
    setTick(0);
    const timer = window.setInterval(() => setTick(t => (t >= maxTick ? t : t + 1)), REPLAY_STEP_MS);
    return () => clearInterval(timer);
  }, [run, done, maxTick, restarts]);
  const restart = useCallback(() => setRestarts(n => n + 1), []);
  return runId ? { run, tick, error, restart } : null;
}

export default function NetworkTestPage({workspace=false}:{workspace?:boolean}) {
  const [theme,setTheme]=useState(initialTheme);
  const [brand]=useState(brandFromUrl);
  const { state, retry } = useAudienceNetwork(brand);
  const [runId]=useState(()=>new URLSearchParams(location.search).get('run'));
  const replay=useSimReplay(runId);
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
    <nav className="nt-brands" aria-label="Brand audience">{BRANDS.map(b=><a key={b.handle} href={`?brand=${b.handle}`} aria-current={b.handle===brand.handle?'page':undefined}>{b.label}<span>{b.platform==='bluesky'?'Bluesky':'X'}</span></a>)}</nav>
    <div className="nt-header-actions">{!workspace&&<a href="/dashboard" aria-label="Back to workspace"><ArrowLeft size={15}/></a>}{toggleTheme}</div>
  </header>;
  if(state.status!=='ready') return <main className="network-test">
    {header('Live audience')}
    <div className="nt-state" role="status" aria-live="polite">
      {state.status==='loading'
        ? <><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true"/><p>{state.preparing?'Arranging people by shared interests…':'Reading the audience from SpacetimeDB…'}</p></>
        : state.status==='oversized'?<p>{state.message}</p>: <><p>Couldn't load the audience. {state.message}</p><button className="nt-replay" onClick={retry}><RotateCcw size={14}/> Try again</button></>}
    </div>
  </main>;
  return <AudienceView network={state.network} theme={theme} replay={replay} header={header(`@${state.network.source.handle} audience · ${state.network.nodes.length} people`)}/>;
}

function AudienceView({network,theme,header,replay}:{network:CascadeNetwork;theme:'dark'|'light';header:React.ReactNode;replay:Replay|null}) {
  const [playing,setPlaying]=useState(true);
  const [elapsed,setElapsed]=useState(0);
  const [selected,setSelected]=useState<number|null>(null);
  const [focus,setFocus]=useState<number|null>(null);
  const [zoomStep,setZoomStep]=useState(0);
  const [reset,setReset]=useState(0);
  const [prepared,setPrepared]=useState(false);
  const [view,setView]=useState<'2d'|'3d'>(()=>new URLSearchParams(location.search).get('view')==='2d'?'2d':'3d');
  const changeView=(next:'2d'|'3d')=>{setView(next);const url=new URL(location.href);if(next==='2d')url.searchParams.set('view','2d');else url.searchParams.delete('view');history.replaceState(null,'',url);};
  const reduced=useReducedMotion();
  const time=useRef(0);
  const duration=network.duration;
  const effectiveTime=reduced?duration:elapsed;
  const finished=effectiveTime>=duration;
  useEffect(()=>{
    if(!playing||reduced||!prepared)return;
    let frame=0,last=0,lastUpdate=0;
    const tick=(now:number)=>{
      if(last&&!document.hidden)time.current=Math.min(duration,time.current+Math.min((now-last)/1000,.08));
      last=now;
      if(now-lastUpdate>=32||time.current>=duration){setElapsed(time.current);lastUpdate=now;}
      if(time.current<duration)frame=requestAnimationFrame(tick);else setPlaying(false);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,reduced,duration,prepared]);
  const replayCascade=()=>{time.current=0;setElapsed(0);setPlaying(true);replay?.restart();};
  const resetView=()=>{setFocus(null);setReset(n=>n+1);};
  const chosen=selected===null?null:network.nodes[selected];
  const reached=network.arrivals.filter(a=>a.id!==network.sourceId&&a.at<=effectiveTime).length;
  return <main className="network-test">
    {header}
    <aside className="nt-index" aria-label="Niche index"><span className="nt-eyebrow">THE AUDIENCE · BY NICHE</span><div className="nt-community-index">{network.communities.map((community,index)=><button key={community.slug} aria-pressed={focus===index} onClick={()=>{setFocus(index);setSelected(null);}}><span className="nt-index-number">{String(index+1).padStart(2,'0')}</span><i style={{background:community.color}}/><span>{community.name}</span><span className="nt-index-count">{community.size}</span></button>)}</div><button className="nt-all" onClick={resetView} aria-pressed={focus===null}>All niches <ArrowLeft size={12}/></button></aside>
    <div className="nt-view-switch" role="group" aria-label="Network dimension"><button aria-pressed={view==='2d'} onClick={()=>changeView('2d')}>2D</button><button aria-pressed={view==='3d'} onClick={()=>changeView('3d')}>3D</button></div>
    <section className="nt-stage" aria-label="Network visualization" aria-busy={!prepared}><CascadeCanvas network={network} view={view} elapsed={effectiveTime} theme={theme} selected={selected} focus={focus} zoomStep={zoomStep} reset={reset} onSelect={setSelected} onPrepared={setPrepared} replay={replay?.run?{run:replay.run,tick:replay.tick}:null}/>{!prepared&&<div className="nt-state" role="status"><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true"/><p>Preparing the network…</p></div>}</section>
    {chosen&&<aside className="nt-selection" aria-label="Selected account"><button className="nt-close" aria-label="Close account details" onClick={()=>setSelected(null)}><X size={15}/></button>
      <div className="nt-person">{chosen.avatar&&<img src={chosen.avatar} alt="" referrerPolicy="no-referrer"/>}<div><h2>{chosen.name}</h2><a href={chosen.member.profileUrl} target="_blank" rel="noreferrer">@{chosen.handle}</a></div></div>
      <ul className="nt-niches">{chosen.member.niches.map(n=><li key={n.slug}><span>{n.label}</span><b>{Math.round(n.affinity*100)}%</b></li>)}</ul>
      <p className="nt-summary">{chosen.member.personaSummary}</p>
      <span className="nt-eyebrow">{chosen.member.postCount} POSTS SCRAPED · {(chosen.member.engagementRate*100).toFixed(1)}% ENGAGEMENT</span>
    </aside>}
    <div className="nt-controls">{replay?<SimStatus replay={replay}/>:<span className="nt-reached" aria-live="polite">{reached} of {network.nodes.length} reached</span>}<button className="nt-icon-button" aria-label="Zoom in" onClick={()=>setZoomStep(n=>n+1)}><Plus size={16}/></button><button className="nt-icon-button" aria-label="Zoom out" onClick={()=>setZoomStep(n=>n-1)}><Minus size={16}/></button><button className="nt-icon-button" aria-label="Reset network view" onClick={resetView}><RotateCcw size={14}/></button>{!finished&&<button className="nt-icon-button" aria-label={playing?'Pause cascade':'Play cascade'} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>}<button className="nt-replay" onClick={replayCascade}><RotateCcw size={14}/> Replay</button></div>
    <span className="nt-hint" title="Nearby people share niche interests or have recorded reply/mention connections. Distances are approximate, not geographic.">Closer = shared interests or connections · drag to {view==='2d'?'pan':'orbit'} · scroll to zoom</span>
  </main>;
}

function SimStatus({replay}:{replay:Replay}) {
  const {run,tick,error}=replay;
  if(error)return <span className="nt-reached" role="alert">{error}</span>;
  if(!run||run.status==='scoring')return <span className="nt-reached" aria-live="polite">Scoring every twin with Claude…</span>;
  let engaged=0,seen=0;
  run.nodes.forEach(n=>{if(n.seenTick!=null&&n.seenTick<=tick)seen++;if(n.engagedTick!=null&&n.engagedTick<=tick)engaged++;});
  return <span className="nt-reached" aria-live="polite">likely reach {run.reachP10}–{run.reachP90} (median {run.reachP50}) · this run: {engaged} engaged, {seen} saw it</span>;
}
