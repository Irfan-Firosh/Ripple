import { RippleLogo } from '../components/RippleLogo';
import { WorkspaceAccount } from '../components/WorkspaceAccount';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Moon, Plus, Sun } from 'lucide-react';
import { initialTheme } from '../App';
import { RippleWorkspaceNav } from '../components/ui/floating-dock';
import { audienceSegments } from '../creative/model';
import { useCreative } from '../creative/useCreative';
import { brandUserId, call, recentPosts, requestDraftCopy, requestDraftVideo, testInLab, tweetText, type BrandPost } from './flowApi';
import { ImportStep, LaunchStep, StartChoice, TestStep } from './FlowSteps';
import { DraftsStep, type DraftCopy } from './FlowDrafts';
import { useFlowData } from './useFlowData';
import { CampaignResearch } from './CampaignResearch';
import './flow.css';
import { DEFAULT_BRAND, SHOWCASE_CAMPAIGN, SHOWCASE_LAB_HREF, STATIC_SNAPSHOT } from '../snapshot';

const params = () => new URLSearchParams(location.search);
const STEPS = ['Audience', 'Concepts', 'Test', 'Launch'] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function CampaignFlowPage({ preview = false }: { preview?: boolean }) {
  const brand = (params().get('brand') || DEFAULT_BRAND).toLowerCase().replace(/^@/, '');
  const [campaignId, setCampaignId] = useState<string | null>(params().get('id') ?? SHOWCASE_CAMPAIGN);
  const [mode, setMode] = useState<'choose' | 'import'>(params().get('start') === 'import' ? 'import' : 'choose');
  const [theme, setTheme] = useState(initialTheme);
  const [brandId, setBrandId] = useState('');
  const [posts, setPosts] = useState<BrandPost[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [post, setPost] = useState('');
  const creative = useCreative(brandId, campaignId);
  // The Lab is where results live: fetch its code while the campaign is on screen so the jump is instant.
  useEffect(() => { void import('../lab/LabPage'); }, []);
  const { flow, video, drafts, copies, experiment } = useFlowData(campaignId, revision);
  const requested = useRef(false);
  const autoStart = useRef(params().get('start') === 'generate'); // "Generate" on the map is one click
  const nextTry = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const [waitingAudience, setWaitingAudience] = useState(false);

  useEffect(() => { document.title = 'Ripple'; }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ripple-theme', theme); } catch { /* optional */ } }, [theme]);
  useEffect(() => {
    const abort = new AbortController();
    brandUserId(brand, abort.signal).then(id => { setBrandId(id ?? ''); return id ? recentPosts(id, abort.signal) : []; })
      .then(setPosts).catch(() => undefined);
    return () => abort.abort();
  }, [brand]);
  useEffect(() => { // keep the URL shareable and reload-safe
    const q = new URLSearchParams({ brand, ...(campaignId ? { id: campaignId } : {}) });
    history.replaceState(null, '', `/campaign?${q}`);
  }, [brand, campaignId]);

  const act = async (fn: () => Promise<void>) => {
    if (preview) return;
    setBusy(true); setError('');
    try { await fn(); setRevision(r => r + 1); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  // Generate: campaign on the map's biggest segment -> brief (worker) -> 2 concepts (worker) + Opus video (worker).
  const generate = () => act(async () => {
    if (!brandId) throw new Error(`@${brand}'s audience is not ready yet.`);
    const top = audienceSegments(brandId, creative.audience, creative.affinities, creative.catalog).segments[0];
    if (!top) { // audience still building: wait quietly, then try again
      autoStart.current = true; nextTry.current = Date.now() + 8000; setWaitingAudience(true);
      window.setTimeout(() => setRetryTick(t => t + 1), 8000);
      return;
    }
    setWaitingAudience(false);
    const goal = `Grow @${brand}'s reach with ${top.label.toLowerCase()} on X`;
    const id = crypto.randomUUID();
    await creative.run(conn => conn.reducers.createCampaign({ campaignId: id, brandUserId: brandId, name: `@${brand} · ${top.label}`,
      goal, channel: 'x', aspectRatio: '16:9', segments: [top.slug], variantsPerBrief: 2 }));
    await call('start_campaign_flow', [id, brand, 'generate', '', '']);
    requested.current = false;
    setCampaignId(id);
  });
  const importDrafts = (a: string, b: string) => act(async () => {
    const id = `import-${crypto.randomUUID()}`;
    await call('start_campaign_flow', [id, brand, 'import', a, b]);
    requested.current = false;
    setCampaignId(id);
  });

  useEffect(() => {
    if (preview || !autoStart.current || campaignId || !brandId || !creative.ready || busy || Date.now() < nextTry.current) return;
    autoStart.current = false;
    void generate();
  }, [brandId, creative.ready, campaignId, busy, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the brief lands, ask for the two concepts (once).
  const brief = creative.briefs[0];
  useEffect(() => {
    if (preview || !brief || requested.current || creative.variants.length || creative.jobs.some(j => j.kind === 'generate')) return;
    requested.current = true;
    void creative.run(conn => conn.reducers.requestCreative({ campaignId: brief.campaignId, kind: 'generate', targetId: brief.briefId }))
      .catch(e => setError(errorText(e)));
  }, [brief, creative]);

  // A and B: imported drafts, or the two generated concepts (copy + Grok image).
  const ready = creative.variants.filter(v => v.status === 'ready');
  // Generated drafts: the concept headline becomes a real tweet in the brand's voice (draft_copy); imports are final.
  const generatedCopy = (d: 'A' | 'B', i: number): DraftCopy | null => {
    const v = ready[i];
    if (!v) return null;
    const c = copies[d];
    return { text: c?.status === 'done' && c.text ? c.text : v.headline, image: v.imageUrl,
             writing: !c || c.status === 'queued' || c.status === 'writing' };
  };
  const copyA: DraftCopy | null = flow?.source === 'import' ? { text: flow.draft_a } : generatedCopy('A', 0);
  const copyB: DraftCopy | null = flow?.source === 'import' ? { text: flow.draft_b } : generatedCopy('B', 1);
  const askedCopy = useRef('');
  useEffect(() => {
    if (preview || !campaignId || flow?.source !== 'generate' || ready.length < 2) return;
    const key = `${campaignId}:${ready[0].variantId}:${ready[1].variantId}:${copies.A?.status}:${copies.B?.status}`;
    if (askedCopy.current === key) return;
    const need = (['A', 'B'] as const).filter(d => !copies[d] || copies[d]?.status === 'failed');
    if (!need.length) return;
    askedCopy.current = key;
    void Promise.all(need.map(d => requestDraftCopy(campaignId, d, ready[d === 'A' ? 0 : 1].headline)))
      .then(() => setRevision(r => r + 1)).catch(e => setError(errorText(e)));
  }, [campaignId, flow?.source, ready, copies]);

  // Every draft gets its own video, written from its own copy (requested once; edits make new versions).
  const askedFor = useRef('');
  useEffect(() => {
    if (preview || !campaignId || !flow || !copyA || !copyB || copyA.writing || copyB.writing || flow.stage === 'shipped') return;
    const key = `${campaignId}:${drafts.A ? 1 : 0}${drafts.B ? 1 : 0}`;
    if (drafts.A && drafts.B) return;
    if (askedFor.current === key) return;
    askedFor.current = key;
    (async () => {
      for (const [d, c] of [['A', copyA], ['B', copyB]] as const) if (!drafts[d]) await requestDraftVideo(campaignId, d, c.text);
      setRevision(r => r + 1);
    })().catch(e => { if (!/already queued|already being made/.test(errorText(e))) setError(errorText(e)); else askedFor.current = ''; });
  }, [campaignId, flow, copyA, copyB, drafts, revision]);

  const test = () => act(async () => {
    if (!copyA || !copyB) return;
    const id = await testInLab(brand, `@${brand} campaign`, copyA.text, copyB.text);
    for (const d of ['A', 'B'] as const) {
      const v = drafts[d];
      if (v?.status === 'done') await call('attach_lab_draft_media', [id, d, v.video_id]).catch(() => undefined);
    }
    await call('update_campaign_flow', [campaignId, 'testing', id, '', '']);
  });
  const approve = (draft: 'A' | 'B') => act(async () => {
    const text = draft === 'A' ? experiment?.draft_a ?? '' : experiment?.draft_b ?? '';
    setPost(text);
    await call('update_campaign_flow', [campaignId, 'approved', 0, drafts[draft]?.video_id ?? '', text]);
  });
  const ship = () => void act(async () => { await call('update_campaign_flow', [campaignId, 'shipped', 0, '', post || flow?.winner_text || '']); });

  // Videos (~5 min) often finish after the Lab test (~1 min): each one goes on its own draft's tweet when done.
  const attached = useRef(new Set<string>());
  useEffect(() => {
    const exp = Number(flow?.experiment_id ?? 0);
    if (preview || !exp) return;
    for (const d of ['A', 'B'] as const) {
      const v = drafts[d];
      const key = `${exp}:${d}:${v?.video_id}`;
      if (v?.status !== 'done' || attached.current.has(key)) continue;
      attached.current.add(key);
      void call('attach_lab_draft_media', [exp, d, v.video_id]).catch(() => undefined);
    }
  }, [flow?.experiment_id, drafts]);
  const winnerVideo = flow?.video_id ? [drafts.A, drafts.B, video].find(v => v?.video_id === flow.video_id) ?? null : null;

  const stage = flow?.stage ?? null;
  const step = preview || !campaignId ? 1 : stage === 'testing' ? 2 : stage === 'approved' || stage === 'shipped' ? 3 : 1;
  const waiting = flow?.source === 'generate' && (!copyA || !copyB)
    ? (creative.briefs.length ? 'Grok is painting two concepts…' : 'Reading your audience and writing the brief…') : '';

  return <main className="flow-page">
    <header className="flow-header workspace-header">
      <RippleLogo />
      <RippleWorkspaceNav brand={brand} />
      <div className="workspace-header-controls"><button className="flow-theme" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><WorkspaceAccount /></div>
    </header>
    <section className="flow-content">
      <section className="flow-hero" aria-labelledby="campaign-title">
        <div className="flow-cloud" aria-hidden="true" />
        <div className="flow-hero-content">
          <span className="flow-eyebrow">@{brand} · CAMPAIGN</span>
          <h1 id="campaign-title">Make your next move.</h1>
          <p>From your audience to a campaign worth sharing.</p>
          <a className="flow-hero-link" href={`/dashboard?brand=${encodeURIComponent(brand)}`}>Explore your audience <ArrowRight size={14} /></a>
        </div>
        {campaignId && !STATIC_SNAPSHOT && <button className="flow-secondary flow-new" disabled={busy} onClick={() => { setCampaignId(null); setMode('choose'); setError(''); requested.current = false; }}><Plus size={15} />New campaign</button>}
      </section>
      {!campaignId && <StartChoice brand={brand} busy={busy} onGenerate={() => void generate()} onImport={() => setMode('import')} />}
      <div className="flow-workspace"><div className="flow-workspace-main">
      <ol className="flow-steps" aria-label="Campaign workflow">{STEPS.map((label, i) => <li key={label} data-state={i < step ? 'done' : i === step ? 'active' : 'next'}>
        {i < step ? <Check size={13} /> : <span>{i + 1}</span>}{label}</li>)}</ol>
      {error && <p className="flow-error" role="alert">{error}</p>}
      {!campaignId && (busy || waitingAudience) && <><h1>Starting your campaign…</h1><p className="flow-waiting" role="status">Reading @{brand}'s audience.</p></>}
      {!campaignId && !busy && !waitingAudience && mode === 'import' && <><div className="flow-section-heading"><h2>Bring your drafts.</h2><button className="flow-text-button" onClick={() => setMode('choose')}><ArrowLeft size={14} />Back</button></div><ImportStep brand={brand} posts={posts} busy={busy} onSubmit={importDrafts} /></>}
      {campaignId && step === 1 && <><h1>Your two drafts.</h1>
        <DraftsStep brand={brand} brandId={brandId} campaignId={campaignId} a={copyA} b={copyB} videos={drafts} busy={busy} waiting={waiting} preview={preview} onTest={() => void test()} onSaved={() => setRevision(r => r + 1)} /></>}
      {campaignId && step === 2 && <><h1>{experiment?.status === 'done' ? 'Results are in.' : 'Testing on your audience.'}</h1>
        <TestStep experiment={experiment} labHref={`/lab?brand=${brand}&exp=${flow?.experiment_id}`} busy={busy} onApprove={d => void approve(d)} /></>}
      {campaignId && step === 3 && <><h1>{stage === 'shipped' ? 'Shipped.' : 'Ready to ship.'}</h1>
        <LaunchStep brand={brand} brandId={brandId} text={post || flow?.winner_text || ''} onText={setPost} video={winnerVideo ?? video} shipped={stage === 'shipped'} busy={busy} onShip={ship}
          labHref={STATIC_SNAPSHOT ? SHOWCASE_LAB_HREF : Number(flow?.experiment_id ?? 0) > 0 ? `/lab?brand=${brand}&exp=${flow?.experiment_id}` : undefined} /></>}
      </div>
      <CampaignResearch brand={brand} campaignId={campaignId} flow={flow} campaigns={creative.campaigns ?? []} brief={brief} jobs={creative.jobs}
        onSelect={id => { requested.current = false; setCampaignId(id); setError(''); }} />
      </div>
    </section>
  </main>;
}
