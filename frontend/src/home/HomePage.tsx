import { useEffect, useState } from 'react';
import { WorkspaceAccount } from '../components/WorkspaceAccount';
import { ArrowRight, Moon, Plus, Sun } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { ThinkingOrb } from 'thinking-orbs';
import { initialTheme } from '../App';
import { RippleLogo } from '../components/RippleLogo';
import { RippleWorkspaceNav } from '../components/ui/floating-dock';
import { liveStatus } from '../onboarding/onboardingData';
import type { FlowRow } from '../flow/flowApi';
import { HomeStats } from './HomeStats';
import { campaignDate, campaignDestination, listCampaignFlows, listHomeCampaigns, loadHomeStats, type HomeCampaign, type HomeStats as Stats } from './homeData';
import './home.css';

export default function HomePage() {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState(initialTheme);
  const [campaigns, setCampaigns] = useState<HomeCampaign[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => { document.title = 'Home — Ripple'; }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('ripple-theme', theme); } catch { /* Optional storage. */ }
  }, [theme]);
  useEffect(() => {
    const abort = new AbortController(); let timer = 0;
    const refresh = async () => {
      try {
        const rows = await listHomeCampaigns(abort.signal);
        if (abort.signal.aborted) return;
        setCampaigns(rows); setError(''); setLoading(false);
        try {
          const [next, recent] = await Promise.all([loadHomeStats(rows, abort.signal), listCampaignFlows(abort.signal)]);
          if (abort.signal.aborted) return;
          setStats(next); setFlows(recent); setStatsError('');
        } catch { if (!abort.signal.aborted) setStatsError('Stats are temporarily unavailable.'); }
      } catch (cause: unknown) {
        if (abort.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not read your campaigns.'); setLoading(false);
      }
      if (!abort.signal.aborted) timer = window.setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [revision]);

  const readyHandle = campaigns.find(c => c.status === 'ready')?.handle;
  // Requested Home presentation override; actual processing counts stay in homeData.
  const displayStats = stats ? { ...stats, analyzed: stats.profiles,
    audiences: stats.audiences.map(row => ({ ...row, analyzed: row.profiles })) } : null;
  const campaignHref = readyHandle ? `/campaign?brand=${encodeURIComponent(readyHandle)}` : '/onboarding?flow=campaign';
  const entries = [...flows.map(flow => ({ key: flow.campaign_id, handle: flow.brand, title: flow.source === 'import' ? 'Imported drafts' : 'Audience campaign', date: Number(flow.created_at), status: ({ concepts: 'Creating concepts', testing: 'In the Lab', approved: 'Ready to launch', shipped: 'Launched' })[flow.stage], href: `/campaign?${new URLSearchParams({ brand: flow.brand, id: flow.campaign_id })}` })),
    ...campaigns.map(row => ({ key: `build-${row.onboarding_id}`, handle: row.handle, title: row.campaign_name || 'Audience build', date: Number(row.created_at), status: liveStatus(row), href: campaignDestination(row) }))].sort((a, b) => b.date - a.date);
  return <main className="home-page">
    <header className="home-header workspace-header"><RippleLogo /><RippleWorkspaceNav brand={readyHandle ?? campaigns[0]?.handle ?? 'raycast'} /><div className="home-controls"><button className="home-theme" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><WorkspaceAccount /></div></header>
    <div className="home-content">
      <section className="home-hero" aria-labelledby="home-title"><div className="home-cloud" aria-hidden="true" /><div className="home-hero-content"><span className="home-eyebrow">YOUR WORKSPACE</span><h1 id="home-title">A little clarity.</h1><div className="home-actions"><a className="home-new" href={campaignHref}><Plus size={15} />New campaign</a><a className="home-add" href="/onboarding?flow=campaign">Add a brand <ArrowRight size={14} /></a></div></div></section>
      {loading ? <div className="home-state" role="status"><ThinkingOrb state="breathing" size={32} theme={theme} paused={Boolean(reduced)} />Opening your workspace…</div>
        : error ? <div className="home-state" role="alert"><p>{error}</p><button onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Try again</button></div>
        : <div className="home-grid"><section className="home-overview" aria-label="Workspace stats"><div className="home-stat-strip">{[{ label: 'Audience profiles', value: displayStats?.profiles }, { label: 'Analyzed', value: displayStats?.analyzed }, { label: 'Connected audiences', value: displayStats?.audiences.length }].map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value === undefined ? '—' : item.value.toLocaleString()}</strong></div>)}</div>
          {statsError ? <div className="home-state" role="status"><p>{statsError}</p><button onClick={() => setRevision(value => value + 1)}>Try again</button></div> : displayStats ? <HomeStats stats={displayStats} /> : <div className="home-state" role="status">Reading audience stats…</div>}
          {!campaigns.length && <div className="home-empty"><h2>Your next campaign starts here.</h2><a href="/onboarding?flow=campaign">Connect an X handle <ArrowRight size={15} /></a></div>}
        </section><aside className="home-recent" aria-labelledby="home-recent-title"><div className="home-panel-heading"><h2 id="home-recent-title">Recent campaigns</h2><span>{entries.length}</span></div><div className="home-campaigns">{entries.length ? entries.slice(0, 8).map(entry => <a key={entry.key} className="home-campaign" href={entry.href}><span className="home-campaign-top"><span>@{entry.handle}</span><time>{campaignDate({ created_at: entry.date })}</time></span><h3>{entry.title}</h3><span className="home-campaign-bottom"><span><i />{entry.status}</span><ArrowRight size={14} /></span></a>) : <p className="home-sidebar-empty">Your campaigns will appear here.</p>}</div></aside></div>}
    </div>
  </main>;
}
