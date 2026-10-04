import { RippleLogo } from '../components/RippleLogo';
import { LabAnalysis } from './LabAnalysis';
import { mediaSource, resimulate } from './labResimulate';
import './lab-analysis.css';
import { ArrowLeft, History, Moon, RotateCcw, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initialTheme } from '../App';
import { Loader } from '../components/ui/loader';
import { RippleWorkspaceNav } from '../components/ui/floating-dock';
import { listActiveBrands, type ActiveBrand } from '../history/historyData';
import { listExperiments, loadBrand, useLabExperiment, type LabBrand, type LabExperimentSummary } from './labData';
import { LabCampaignPicker, useLabCampaigns } from './LabCampaignPicker';
import type { LabCampaign } from './labCampaignData';
import { LabDock } from './LabDock';
import { Tweet } from './Tweet';
import { useReplayTick } from './useReplayTick';
import './lab.css';
import './lab-history.css';
import { HistoryDrawer } from '../history/HistoryDrawer';
import { DEFAULT_BRAND } from '../snapshot';

const params = () => new URLSearchParams(location.search);
const initialBrand = () => params().get('brand')?.toLowerCase() || DEFAULT_BRAND;

function useExperiments(brand: string, refreshKey: number) {
  const [list, setList] = useState<LabExperimentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setList(null); setError(null);
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
  const [brands, setBrands] = useState<ActiveBrand[]>([]);
  const [expId, setExpId] = useState<string | null>(() => params().get('exp'));
  const [analyzing, setAnalyzing] = useState(false);
  const [resimulating, setResimulating] = useState(false);
  const [simulationError, setSimulationError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const closeAnalysis = useCallback(() => setAnalyzing(false), []);
  useEffect(() => () => pending.current?.abort(), [brand, expId]);
  const [choosingCampaign, setChoosingCampaign] = useState(false);
  const { campaigns, error: campaignError, retry: retryCampaigns } = useLabCampaigns();
  const createCampaignHref = `/campaign?brand=${encodeURIComponent(brand)}`;
  const campaignAction = campaigns?.length === 0 && !campaignError ? 'Create new campaign' : 'Select campaign';
  const closeCampaignPicker = useCallback(() => setChoosingCampaign(false), []);
  const [showHistory, setShowHistory] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [profile, setProfile] = useState<LabBrand | null>(null);
  const { list, error: listError } = useExperiments(brand, refresh);
  const { experiment, error } = useLabExperiment(expId);
  const a = useReplayTick(experiment?.a ?? null);
  const b = useReplayTick(experiment?.b ?? null);
  useEffect(() => {
    const controller = new AbortController();
    listActiveBrands(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setBrands(rows);
      if (!params().has('brand') && rows.length && !rows.some(row => row.handle === brand)) setBrand(rows[0].handle);
    }).catch(() => { /* Experiments and their history remain readable independently. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme; document.title = 'Ripple';
    try { localStorage.setItem('ripple-theme', theme); } catch { /* optional */ }
  }, [theme]);
  useEffect(() => {
    const abort = new AbortController(); setProfile(null);
    loadBrand(brand, abort.signal).then(next => { if (!abort.signal.aborted) setProfile(next); }).catch(() => { if (!abort.signal.aborted) setProfile(null); });
    return () => abort.abort();
  }, [brand]);
  useEffect(() => {
    if (!list?.length) return;
    if (!expId || !list.some(x => x.id === expId)) setExpId(list[0].id);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams({ brand, ...(expId ? { exp: expId } : {}) });
    if (expId && mediaSource(expId) !== expId) q.set('source', mediaSource(expId));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [brand, expId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list?.length || choosingCampaign || analyzing || (e.key !== '[' && e.key !== ']')) return;
      const at = list.findIndex(x => x.id === expId);
      const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === ']' ? 1 : -1)))];
      if (next) setExpId(next.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list, expId, choosingCampaign, analyzing]);

  const switchBrand = (handle: string) => { setBrand(handle); setExpId(null); };
  const openCampaigns = () => {
    if (campaignAction === 'Create new campaign') location.assign(createCampaignHref);
    else setChoosingCampaign(true);
  };
  const selectCampaign = (campaign: LabCampaign) => {
    setChoosingCampaign(false);
    if (Number(campaign.experiment_id) > 0) { setBrand(campaign.brand); setExpId(String(campaign.experiment_id)); }
    else location.assign(`/campaign?${new URLSearchParams({ brand: campaign.brand, id: campaign.campaign_id })}`);
  };
  const rerun = async () => {
    if (!experiment || resimulating) return;
    const abort = new AbortController(); pending.current = abort;
    setResimulating(true); setSimulationError('');
    try {
      const id = await resimulate(experiment, abort.signal);
      if (!abort.signal.aborted) { setExpId(id); setRefresh(n => n + 1); }
    } catch (cause: unknown) {
      if (!abort.signal.aborted) setSimulationError(cause instanceof Error ? cause.message : 'Could not start a new simulation.');
    } finally { setResimulating(false); }
  };
  const bothDone = experiment?.status === 'done' && a.finished && b.finished;
  const winnerLine = experiment && bothDone
    ? experiment.winner === 'tie' ? 'Too close to call' : `${experiment.winner} wins · ${experiment.lift > 0 ? '+' : ''}${Math.round(Math.abs(experiment.lift) * 100)}% expected engagement`
    : null;

  return <main className="lab-page">
    <header className="lab-header workspace-header">
      <RippleLogo />
      <span className="lab-crumb">Lab</span>
      <RippleWorkspaceNav brand={brand} />
      <nav className="lab-brands" aria-label="Audience">{[...brands, ...(!brands.some(x => x.handle === brand) ? [{ handle: brand, label: `@${brand}` }] : [])].map(x => <button key={x.handle} aria-current={x.handle === brand ? 'page' : undefined} onClick={() => switchBrand(x.handle)}>{x.label}</button>)}</nav>
      <div className="lab-header-actions">
        <button className="lab-icon" aria-label="Open history" onClick={() => setShowHistory(true)}><History size={16} /></button>
        <a className="lab-icon" href="/dashboard" aria-label="Back to dashboard"><ArrowLeft size={15} /></a>
        <button className="lab-icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      <WorkspaceAccount /></div>
    </header>

    <div className="lab-workspace">
    <LabDock experiments={list ?? []} activeId={expId} onSelect={setExpId} onCampaigns={openCampaigns} campaignAction={campaignAction} loadingCampaigns={campaigns === null && !campaignError} />
    <div className="lab-workspace-content">{listError || error ? <div className="lab-state" role="alert">{listError ?? error}<button className="lab-secondary" onClick={() => setRefresh(n => n + 1)}><RotateCcw size={14} /> Try again</button></div>
      : list === null || (expId && !experiment) ? <div className="lab-state" role="status"><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true" /><p>Opening the Lab…</p></div>
      : !list.length ? <div className="lab-state"><h2>No experiments for @{brand} yet</h2><a className="lab-primary" href={createCampaignHref}>Create new campaign</a></div>
      : experiment && profile && <>
        <div className="lab-toolbar">
          <h2>{experiment.title}</h2>
          {winnerLine && <span className={`lab-verdict lab-draft-${experiment.winner}`}>{winnerLine}</span>}
          {experiment.status === 'failed' && <span className="lab-verdict lab-failed" role="alert">{experiment.error ?? 'This experiment failed.'}</span>}
          {(experiment.status === 'queued') && <span className="lab-verdict" role="status">Queued — waiting for the simulator…</span>}
          <div className="lab-simulation-actions"><button className="lab-primary lab-action lab-action-primary" onClick={() => setAnalyzing(true)} disabled={experiment.status !== 'done'}>Analysis</button><button className="lab-secondary lab-action" onClick={() => void rerun()} disabled={resimulating || experiment.status === 'queued' || experiment.status === 'running'}>{resimulating ? 'Resimulating…' : 'Resimulate'}</button></div>
        </div>
        {simulationError && <p className="lab-resim-error" role="alert">{simulationError}</p>}
        {experiment.status === 'queued' || experiment.status === 'running' ? <div className="lab-state lab-simulating" role="status" aria-live="polite">
          <Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true" />
          <p>Simulating your audience…</p><span>Results appear when both drafts are finished.</span>
        </div> : <div className="lab-columns">
          <Tweet label="A" brand={profile} draft={experiment.draftA} run={experiment.a} tick={a.tick} finished={a.finished} winner={Boolean(bothDone && experiment.winner === 'A')} />
          <Tweet label="B" brand={profile} draft={experiment.draftB} run={experiment.b} tick={b.tick} finished={b.finished} winner={Boolean(bothDone && experiment.winner === 'B')} />
        </div>}
      </>}</div></div>

    {analyzing && experiment && <LabAnalysis experiment={experiment} tickA={a.tick} tickB={b.tick} onClose={closeAnalysis} />}
    {showHistory && <HistoryDrawer kind="lab" activeId={expId} onClose={() => setShowHistory(false)} onSelect={entry => {
      if (entry.kind === 'audience') location.assign(`/dashboard?brand=${encodeURIComponent(entry.brand)}&snapshot=${encodeURIComponent(entry.id)}`);
      else { setBrand(entry.brand); setExpId(entry.id); setShowHistory(false); }
    }} />}
    {choosingCampaign && <LabCampaignPicker campaigns={campaigns} error={campaignError} createHref={createCampaignHref} onRetry={retryCampaigns} onClose={closeCampaignPicker} onSelect={selectCampaign} />}
  </main>;
}
import { WorkspaceAccount } from '../components/WorkspaceAccount';
