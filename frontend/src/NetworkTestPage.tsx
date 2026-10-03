import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Moon, Sun, Pause, Play, RotateCcw, Plus, Minus, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { RippleMark, initialTheme } from './App';
import { Loader } from './components/ui/loader';
import { loadAudience } from './audience/liveAudience';
import { buildLiveNetwork, type CascadeNetwork } from './visuals/liveNetwork';
import { CascadeCanvas } from './visuals/CascadeCanvas';
import './network-test.css';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; network: CascadeNetwork };

// Loads the scraped audience from SpacetimeDB. There is no sample fallback: if the database can't be read, say so.
function useAudienceNetwork() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadAudience(controller.signal)
      .then(audience => setState({ status: 'ready', network: buildLiveNetwork(audience) }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : 'SpacetimeDB could not be reached.' });
      });
    return () => controller.abort();
  }, [attempt]);
  return { state, retry: useCallback(() => setAttempt(n => n + 1), []) };
}

export default function NetworkTestPage({workspace=false}:{workspace?:boolean}) {
  const [theme,setTheme]=useState(initialTheme);
  const { state, retry } = useAudienceNetwork();
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.title=workspace?'Dashboard — Ripple':'Network playground — Ripple';
    try{localStorage.setItem('ripple-theme',theme);}catch{/* Optional. */}
  },[theme,workspace]);
  const toggleTheme=<button className="nt-icon-button" aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;
  const header=(subtitle:string)=><header className="nt-header"><a className="brand" href="/" aria-label="Ripple home"><RippleMark size={27}/><span>Ripple</span></a><span className="nt-page-name">{workspace?'Workspace':'Network playground'} <i/> {subtitle}</span><div><a href={workspace?'/':'/dashboard'} aria-label={workspace?'Back to home':'Back to workspace'}><ArrowLeft size={15}/></a>{toggleTheme}</div></header>;
  if(state.status!=='ready') return <main className="network-test">
    {header('Live audience')}
    <div className="nt-state" role="status" aria-live="polite">
      {state.status==='loading'
        ? <><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true"/><p>Reading the audience from SpacetimeDB…</p></>
        : <><p>Couldn't load the audience. {state.message}</p><button className="nt-replay" onClick={retry}><RotateCcw size={14}/> Try again</button></>}
    </div>
  </main>;
  return <AudienceView network={state.network} theme={theme} header={header(`@${state.network.source.handle} audience · ${state.network.nodes.length} people`)}/>;
}

function AudienceView({network,theme,header}:{network:CascadeNetwork;theme:'dark'|'light';header:React.ReactNode}) {
  const [playing,setPlaying]=useState(true);
  const [elapsed,setElapsed]=useState(0);
  const [selected,setSelected]=useState<number|null>(null);
  const [focus,setFocus]=useState<number|null>(null);
  const [zoomStep,setZoomStep]=useState(0);
  const [reset,setReset]=useState(0);
  const reduced=useReducedMotion();
  const time=useRef(0);
  const duration=network.duration;
  const effectiveTime=reduced?duration:elapsed;
  const finished=effectiveTime>=duration;
  useEffect(()=>{
    if(!playing||reduced)return;
    let frame=0,last=0;
    const tick=(now:number)=>{
      if(last&&!document.hidden)time.current=Math.min(duration,time.current+Math.min((now-last)/1000,.08));
      last=now;setElapsed(time.current);
      if(time.current<duration)frame=requestAnimationFrame(tick);else setPlaying(false);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,reduced,duration]);
  const replay=()=>{time.current=0;setElapsed(0);setPlaying(true);};
  const resetView=()=>{setFocus(null);setReset(n=>n+1);};
  const chosen=selected===null?null:network.nodes[selected];
  const reached=network.arrivals.filter(a=>a.id!==network.sourceId&&a.at<=effectiveTime).length;
  return <main className="network-test">
    {header}
    <aside className="nt-index" aria-label="Niche index"><span className="nt-eyebrow">THE AUDIENCE · BY NICHE</span><div className="nt-community-index">{network.communities.map((community,index)=><button key={community.slug} aria-pressed={focus===index} onClick={()=>{setFocus(index);setSelected(null);}}><span className="nt-index-number">{String(index+1).padStart(2,'0')}</span><i style={{background:community.color}}/><span>{community.name}</span><span className="nt-index-count">{community.size}</span></button>)}</div><button className="nt-all" onClick={resetView} aria-pressed={focus===null}>All niches <ArrowLeft size={12}/></button></aside>
    <section className="nt-stage" aria-label="Network visualization"><CascadeCanvas network={network} elapsed={effectiveTime} theme={theme} selected={selected} focus={focus} zoomStep={zoomStep} reset={reset} onSelect={setSelected}/></section>
    {chosen&&<aside className="nt-selection" aria-label="Selected account"><button className="nt-close" aria-label="Close account details" onClick={()=>setSelected(null)}><X size={15}/></button>
      <div className="nt-person">{chosen.avatar&&<img src={chosen.avatar} alt="" referrerPolicy="no-referrer"/>}<div><h2>{chosen.name}</h2><a href={`https://x.com/${chosen.handle}`} target="_blank" rel="noreferrer">@{chosen.handle}</a></div></div>
      <ul className="nt-niches">{chosen.member.niches.map(n=><li key={n.slug}><span>{n.label}</span><b>{Math.round(n.affinity*100)}%</b></li>)}</ul>
      <p className="nt-summary">{chosen.member.personaSummary}</p>
      <span className="nt-eyebrow">{chosen.member.postCount} POSTS SCRAPED · {(chosen.member.engagementRate*100).toFixed(1)}% ENGAGEMENT</span>
    </aside>}
    <div className="nt-controls"><span className="nt-reached" aria-live="polite">{reached} of {network.nodes.length} reached</span><button className="nt-icon-button" aria-label="Zoom in" onClick={()=>setZoomStep(n=>n+1)}><Plus size={16}/></button><button className="nt-icon-button" aria-label="Zoom out" onClick={()=>setZoomStep(n=>n-1)}><Minus size={16}/></button><button className="nt-icon-button" aria-label="Reset network view" onClick={resetView}><RotateCcw size={14}/></button>{!finished&&<button className="nt-icon-button" aria-label={playing?'Pause cascade':'Play cascade'} onClick={()=>setPlaying(!playing)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button>}<button className="nt-replay" onClick={replay}><RotateCcw size={14}/> Replay</button></div>
    <span className="nt-hint">Drag to orbit · scroll to zoom · click a person</span>
  </main>;
}
