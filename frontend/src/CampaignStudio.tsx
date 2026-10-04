import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, Image, LoaderCircle, Moon, MoreHorizontal, Pencil, Plus, RotateCcw, Sun, X } from 'lucide-react';
import { RippleMark, initialTheme } from './App';
import { RippleWorkspaceNav } from './components/ui/floating-dock';
import { Loader } from './components/ui/loader';
import { useCreative } from './creative/useCreative';
import { audienceSegments, BRANDS, RATIOS, type Brief, type Campaign, type CreativeHandoff, type Job, type Variant } from './creative/model';
import { saveCampaignDrafts } from './creative/handoff';
import { listActiveBrands } from './history/historyData';
import './lab/lab.css';
import './studio.css';

type CreativeData = ReturnType<typeof useCreative>;
type Recording = { campaign: Campaign; briefs: Brief[]; variants: Variant[] };
type ModalState = { kind: 'new' } | { kind: 'brief'; brief: Brief } | { kind: 'variant'; variant: Variant } | null;
type Action = (task: () => Promise<unknown>) => Promise<void>;
type CampaignBrand = { id: string; handle: string; name: string };
const initialBrand = (): CampaignBrand => {
  const handle = new URLSearchParams(location.search).get('brand')?.toLowerCase();
  return BRANDS.find(b => b.handle === handle) ?? (handle ? { id: '', handle, name: `@${handle}` } : BRANDS[0]);
};

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="campaign-dialog" onCancel={close} onClick={event => {
    if (event.target === event.currentTarget) {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }
  }}>
    <header><h2>{title}</h2><button className="lab-icon" aria-label="Close" onClick={close}><X size={16} /></button></header>
    {children}
  </dialog>;
}

function BriefEditor({ brief, data, action, disabled, close }: { brief: Brief; data: CreativeData; action: Action; disabled: boolean; close: () => void }) {
  const [angle, setAngle] = useState(brief.messageAngle);
  const [tone, setTone] = useState(brief.tone);
  const [cta, setCta] = useState(brief.cta);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      await data.run(conn => conn.reducers.editBrief({
        briefId: brief.briefId, audienceLabel: brief.audienceLabel, tone, messageAngle: angle,
        cta, valueProps: brief.valueProps, headlineOptions: brief.headlineOptions,
        visualCues: brief.visualCues, visualAvoid: brief.visualAvoid, format: brief.format,
      }));
      close();
    });
  };
  return <form className="campaign-form" onSubmit={submit}>
    <label>Message<textarea rows={3} maxLength={500} required value={angle} onChange={e => setAngle(e.target.value)} /></label>
    <label>Tone<textarea rows={2} maxLength={300} required value={tone} onChange={e => setTone(e.target.value)} /></label>
    <label>Call to action<input maxLength={60} required value={cta} onChange={e => setCta(e.target.value)} /></label>
    <button className="lab-primary" disabled={disabled}>Save brief</button>
  </form>;
}

function VariantEditor({ variant, versions, onVersion, data, action, disabled, close }: {
  variant: Variant; versions: Variant[]; onVersion: (id: string) => void;
  data: CreativeData; action: Action; disabled: boolean; close: () => void;
}) {
  const [headline, setHeadline] = useState(variant.headline);
  const [cta, setCta] = useState(variant.cta);
  const [instruction, setInstruction] = useState('');
  const [prompt, setPrompt] = useState(variant.imagePrompt);
  const [ratio, setRatio] = useState(variant.aspectRatio);
  const changed = headline !== variant.headline || cta !== variant.cta;
  const saveCopy = async () => {
    if (changed) await data.run(conn => conn.reducers.setVariantCopy({ variantId: variant.variantId, headline, cta }));
  };
  const request = (kind: string, edit?: string, aspect?: string) => action(async () => {
    await saveCopy();
    await data.run(conn => conn.reducers.requestCreative({
      campaignId: variant.campaignId, kind, targetId: variant.variantId, instruction: edit, aspectRatio: aspect,
    }));
    close();
  });
  return <div className="campaign-form">
    <form onSubmit={event => { event.preventDefault(); void action(async () => { await saveCopy(); close(); }); }}>
      <label>Headline<textarea rows={2} maxLength={100} value={headline} onChange={e => setHeadline(e.target.value)} /></label>
      <label>Call to action<input maxLength={60} value={cta} onChange={e => setCta(e.target.value)} /></label>
      <button className="lab-primary" disabled={disabled || !changed}>Save copy</button>
    </form>
    <div className="campaign-edit-image">
      <label>Image edit<textarea rows={2} maxLength={300} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Simplify the background…" /></label>
      <button className="lab-secondary" disabled={disabled || !instruction.trim()} onClick={() => void request('edit', instruction)}>Apply edit</button>
    </div>
    <details className="campaign-details"><summary>More options</summary>
      <label>Image prompt<textarea rows={5} maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="lab-secondary" disabled={disabled || !prompt.trim()} onClick={() => void request('tweak_prompt', prompt)}>Generate from prompt</button>
      <label>Format<select value={ratio} onChange={e => setRatio(e.target.value)}>{RATIOS.map(r => <option key={r}>{r}</option>)}</select></label>
      <div className="campaign-inline-actions">
        <button className="lab-secondary" disabled={disabled || ratio === variant.aspectRatio} onClick={() => void request('resize', undefined, ratio)}>Resize</button>
        <button className="lab-secondary" disabled={disabled} onClick={() => void request('regenerate')}><RotateCcw size={13} /> Regenerate</button>
      </div>
      {versions.length > 1 && <div className="campaign-versions" aria-label="Concept versions">{versions.map(v => <button key={v.variantId} aria-pressed={v.variantId === variant.variantId}
        onClick={() => { onVersion(v.variantId); close(); }}><span>{v.imageUrl && <img src={v.imageUrl} alt="" />}</span>Version {v.depth + 1}</button>)}</div>}
    </details>
  </div>;
}

export default function CampaignStudio() {
  const [theme, setTheme] = useState(initialTheme);
  const [brandId, setBrandId] = useState<string>(initialBrand().id);
  const [brands, setBrands] = useState<CampaignBrand[]>([...BRANDS]);
  const requestedBrand = useRef(initialBrand());
  const [campaignId, setCampaignId] = useState<string | null>(() => new URLSearchParams(location.search).get('campaign'));
  const [modal, setModal] = useState<ModalState>(null);
  const [goal, setGoal] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [ratio, setRatio] = useState('1:1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recorded, setRecorded] = useState(() => new URLSearchParams(location.search).get('demo') === '1');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [demoSelection, setDemoSelection] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now);
  const restored = useRef('');
  const data = useCreative(brandId, campaignId);
  const brand = brands.find(b => b.id === brandId) ?? requestedBrand.current;
  const audience = useMemo(() => audienceSegments(brandId, data.audience, data.affinities, data.catalog),
    [brandId, data.audience, data.affinities, data.catalog]);
  const campaigns = data.campaigns.filter(c => c.brandUserId === brandId);
  const active = recorded ? recording?.campaign : campaigns.find(c => c.campaignId === campaignId);
  const shared = Boolean(!recorded && active && active.createdBy.toHexString() !== data.identity);
  const briefs = recorded ? recording?.briefs ?? [] : data.briefs;
  const variants = recorded ? recording?.variants ?? [] : data.variants;
  const latestBriefs = [...briefs.reduce((map, brief) => {
    const previous = map.get(brief.segment);
    if (!previous || previous.version < brief.version) map.set(brief.segment, brief);
    return map;
  }, new Map<string, Brief>()).values()];
  const roots = [...new Set(variants.map(v => v.rootVariantId))];
  const concepts = roots.map(root => {
    const takes = variants.filter(v => v.rootVariantId === root).sort((a, b) => b.depth - a.depth);
    return takes.find(v => v.variantId === versions[root]) ?? takes.find(v => v.approved) ?? takes[0];
  });
  const selected = concepts.filter(v => recorded || shared ? demoSelection.includes(v.variantId) : v.approved);
  const jobs = data.jobs.filter(j => ['pending', 'running'].includes(j.status));
  const stalled = jobs.some(j => {
    const timed = j as Job & { createdAt?: { microsSinceUnixEpoch: bigint }; claimedAt?: { microsSinceUnixEpoch: bigint } };
    const at = j.status === 'running' ? timed.claimedAt : timed.createdAt;
    return at && now - Number(at.microsSinceUnixEpoch / 1000n) > 120_000;
  });
  const disabled = busy || !data.ready;
  const kit = data.brandKits.find(k => k.brandUserId === brandId);

  useEffect(() => {
    const controller = new AbortController();
    void listActiveBrands(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      const next = [...BRANDS, ...rows.filter(row => row.userId && !BRANDS.some(b => b.id === row.userId))
        .map(row => ({ id: row.userId!, handle: row.handle, name: row.label }))];
      setBrands(next);
      const selected = next.find(b => b.handle === requestedBrand.current.handle);
      if (selected) setBrandId(selected.id);
      else setError(`@${requestedBrand.current.handle}'s audience is not ready yet.`);
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = 'Campaigns — Ripple';
    try { localStorage.setItem('ripple-theme', theme); } catch { /* optional */ }
  }, [theme]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data.ready || !data.identity || recorded || !brandId || (campaignId && !data.campaignReady)) return;
    const key = 'ripple-active-campaign:' + data.identity + ':' + brandId;
    if (restored.current === key) return;
    restored.current = key;
    try {
      const saved = campaignId ?? localStorage.getItem(key) ?? localStorage.getItem('ripple-active-campaign:' + data.identity);
      const previous = campaigns.find(c => c.campaignId === saved) ?? campaigns[0];
      setCampaignId(previous?.campaignId ?? null);
    } catch { /* history is still available */ }
  }, [data.ready, data.identity, data.campaignReady, brandId, recorded]);
  useEffect(() => {
    if (!data.ready || !data.identity || recorded || !brandId) return;
    try {
      const key = 'ripple-active-campaign:' + data.identity + ':' + brandId;
      if (campaignId) localStorage.setItem(key, campaignId);
    } catch { /* optional */ }
    const q = new URLSearchParams({ brand: brand.handle, ...(campaignId ? { campaign: campaignId } : {}) });
    history.replaceState(null, '', '/campaigns?' + q);
  }, [campaignId, data.ready, data.identity, recorded, brand.handle, brandId]);
  useEffect(() => {
    if (!recorded) return;
    const controller = new AbortController();
    setError('');
    fetch('/rehearsal/campaign.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The saved demo is unavailable.');
      const file = await response.json();
      if (!file.campaign || !Array.isArray(file.briefs) || !Array.isArray(file.variants)) throw new Error('The saved demo is incomplete.');
      const next = { ...file, variants: file.variants.map((v: Variant & { costUsdTicks: string }) => ({ ...v, costUsdTicks: BigInt(v.costUsdTicks) })) } as Recording;
      setRecording(next);
      setBrandId(next.campaign.brandUserId);
      setDemoSelection([]);
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)); });
    return () => controller.abort();
  }, [recorded]);

  const action: Action = async task => {
    if (busy) return;
    setBusy(true); setError(''); data.clearError();
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const newCampaign = () => {
    setGoal(''); setRatio('1:1'); setSegments(audience.segments.slice(0, 1).map(s => s.slug));
    setError(''); setModal({ kind: 'new' });
  };
  const switchBrand = (id: string) => { setBrandId(id); setCampaignId(null); setVersions({}); setError(''); setModal(null); };
  const create = (event: FormEvent) => {
    event.preventDefault();
    const id = crypto.randomUUID();
    void action(async () => {
      await data.run(conn => conn.reducers.createCampaign({ campaignId: id, brandUserId: brandId,
        name: goal.trim().slice(0, 100), goal: goal.trim(), channel: brand.handle.includes('.') ? 'bluesky' : 'x',
        aspectRatio: ratio, segments, variantsPerBrief: 2 }));
      setCampaignId(id); setVersions({}); setModal(null);
    });
  };
  const select = (variant: Variant) => {
      if (recorded || shared) {
      setDemoSelection(ids => ids.includes(variant.variantId) ? ids.filter(id => id !== variant.variantId)
        : ids.length < 2 ? [...ids, variant.variantId] : ids);
      return;
    }
    void action(async () => {
      if (!variant.approved) {
        for (const previous of variants.filter(v => v.rootVariantId === variant.rootVariantId && v.approved)) {
          await data.run(conn => conn.reducers.approveVariant({ variantId: previous.variantId, approved: false }));
        }
      }
      await data.run(conn => conn.reducers.approveVariant({ variantId: variant.variantId, approved: !variant.approved }));
    });
  };
  const handoff = () => void action(async () => {
    if (!active || selected.length !== 2) return;
    if (!recorded && !shared && active.status !== 'handed_off') await data.run(conn => conn.reducers.handoffCampaign({ campaignId: active.campaignId }));
    const input: CreativeHandoff = { campaign: active, recordedRehearsal: recorded,
      variants: selected.map(v => ({ ...v, brief: briefs.find(b => b.briefId === v.briefId),
        segment: briefs.find(b => b.briefId === v.briefId)?.segment ?? '' })) };
    const id = saveCampaignDrafts(input);
    location.assign('/lab-v2?' + new URLSearchParams({ brand: brand.handle, handoff: id }));
  });

  return <main className="lab-page campaign-page">
    <header className="lab-header">
      <a className="brand" href="/" aria-label="Ripple home"><RippleMark size={26} /><span>Ripple</span></a>
      <span className="lab-crumb">Campaigns</span>
      <RippleWorkspaceNav brand={brand.handle} />
      <nav className="lab-brands" aria-label="Audience">{[...brands].reverse().map(b =>
        <button key={b.id} disabled={recorded} aria-current={b.id === brandId ? 'page' : undefined} onClick={() => switchBrand(b.id)}>
          {b.handle === 'spacetimedb' ? '@spacetimedb' : b.name}
        </button>)}</nav>
      <button className="lab-icon" aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
    </header>
    <div className="campaign-main">
      <div className="campaign-toolbar">
        <div><h1>{active?.name ?? 'Campaigns'}</h1>{recorded && <span className="campaign-recorded">Recorded demo</span>}</div>
        <div className="campaign-inline-actions">
          {recorded ? <button className="lab-secondary" onClick={() => { setRecorded(false); setRecording(null); setVersions({}); }}>Return to campaigns</button>
            : <button className="lab-secondary" disabled={busy} onClick={newCampaign}><Plus size={14} /> New campaign</button>}
          <details className="campaign-menu"><summary aria-label="Campaign options"><MoreHorizontal size={18} /></summary>
            <button onClick={() => { setRecorded(true); setVersions({}); setModal(null); }}>Saved demo</button>
          </details>
        </div>
      </div>
      {(error || (!recorded && data.error)) && <div className="campaign-error" role="alert">
        <span>{error || (data.status === 'disconnected' ? 'Could not connect to campaigns.' : data.error)}</span>
        {!recorded && data.status !== 'connected' && <button className="lab-secondary" onClick={data.reconnect}>Try again</button>}
      </div>}
      {recorded && !recording ? <div className="lab-state" role="status"><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" /><p>Opening the demo…</p></div>
        : !recorded && !data.ready ? <div className="lab-state" role="status">
          {data.status === 'disconnected' ? <><p>Campaigns are unavailable.</p><button className="lab-secondary" onClick={data.reconnect}>Try again</button></>
            : <><Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" /><p>Loading campaigns…</p></>}
        </div> : !active ? <div className="campaign-empty">
          <div className="campaign-empty-previews" aria-hidden="true"><span><Image size={26} /></span><span><Image size={26} /></span></div>
          <h2>Your next campaign.</h2><p>Create two concepts for your audience.</p>
          <button className="lab-primary" onClick={newCampaign}><Plus size={14} /> New campaign</button>
        </div> : !recorded && !data.campaignReady ? <div className="lab-state" role="status"><p>Opening campaign…</p></div> : <>
          <div className="campaign-briefs">{latestBriefs.map(brief => <section className="campaign-brief" key={brief.briefId}>
            <div className="campaign-brief-heading"><h2>{brief.audienceLabel}</h2>
              <span>{brief.twinCount} people</span>
              {!recorded && !shared && <button className="campaign-text-button" disabled={disabled} onClick={() => setModal({ kind: 'brief', brief })}><Pencil size={13} /> Edit brief</button>}
            </div>
            <p>{brief.messageAngle}</p>
            <div className="campaign-brief-bottom">
              <details className="campaign-details"><summary>Audience insights</summary>
                <ul>{brief.keyInterests.map((t, i) => <li key={i}>{t.text}</li>)}</ul>
                {brief.avoid.length > 0 && <><span className="campaign-muted">Avoid</span><ul>{brief.avoid.map((t, i) => <li key={i}>{t.text}</li>)}</ul></>}
              </details>
              {!recorded && !shared && !variants.some(v => v.briefId === brief.briefId) && <button className="lab-primary"
                disabled={disabled || jobs.some(j => j.targetId === brief.briefId)} onClick={() => void action(() =>
                  data.run(conn => conn.reducers.requestCreative({ campaignId: brief.campaignId, kind: 'generate', targetId: brief.briefId })))}>
                {jobs.some(j => j.targetId === brief.briefId) ? 'Generating…' : 'Generate concepts'}<ArrowRight size={13} />
              </button>}
            </div>
          </section>)}</div>
          {!recorded && jobs.length > 0 && <div className="campaign-progress" role="status"><LoaderCircle size={14} className="campaign-spin" />
            {stalled ? 'This is taking longer than expected. Your work is saved.' : latestBriefs.length ? 'Generating concepts…' : 'Preparing your brief…'}
          </div>}
          {!recorded && data.jobs.filter(j => j.status === 'failed').map(j => <div className="campaign-error" role="alert" key={String(j.jobId)}>
            <span>{j.error || 'Generation failed. Try a new campaign.'}</span></div>)}
          <div className="campaign-grid">{concepts.map((v, index) => {
            const picked = selected.some(s => s.variantId === v.variantId);
            const ready = v.status === 'ready' && !!v.imageUrl;
            const brief = briefs.find(b => b.briefId === v.briefId);
            return <article className={'campaign-concept' + (picked ? ' is-selected' : '')} key={v.rootVariantId}>
              <div className="campaign-concept-header"><span>Concept {String.fromCharCode(65 + index)}</span><span>{brief?.audienceLabel}</span></div>
              <div className="campaign-image" style={{ aspectRatio: v.aspectRatio.replace(':', '/') }}>
                {ready ? <img src={v.imageUrl} alt={'Concept ' + String.fromCharCode(65 + index) + ': ' + v.headline} />
                  : <div role="status">{['queued', 'generating'].includes(v.status) ? <><LoaderCircle size={24} className="campaign-spin" />Generating…</>
                    : <><Image size={24} />{v.error || 'Image unavailable'}</>}</div>}
              </div>
              <div className="campaign-concept-content"><h3>{v.headline}</h3><p>{v.cta}</p>
                <div className="campaign-concept-actions">
                  {!recorded && !shared && <button className="lab-secondary" disabled={disabled || !ready || jobs.length > 0} onClick={() => setModal({ kind: 'variant', variant: v })}><Pencil size={13} /> Edit</button>}
                  <button className={picked ? 'lab-primary' : 'lab-secondary'} aria-pressed={picked}
                    disabled={!ready || busy || (!recorded && !data.ready) || (!picked && selected.length >= 2)}
                    onClick={() => select(v)}>{picked ? <Check size={14} /> : <Plus size={14} />}{picked ? 'Selected' : 'Select'}</button>
                </div>
              </div>
            </article>;
          })}</div>
          {concepts.length > 0 && <div className="campaign-handoff">
            <span>{selected.length === 2 ? 'Two concepts selected' : 'Select two concepts to compare'}</span>
            <button className="lab-primary" disabled={busy || selected.length !== 2 || (!recorded && (!data.ready || jobs.length > 0))}
              onClick={handoff}>Open in Lab v2<ArrowRight size={14} /></button>
          </div>}
        </>}
    </div>
    {!recorded && <nav className="lab-dock" aria-label="Campaign history">
      <button className="lab-dock-new" aria-label="New campaign" onClick={newCampaign}><Plus size={16} /> New</button>
      {campaigns.map(c => <button key={c.campaignId} aria-current={c.campaignId === campaignId ? 'true' : undefined} title={c.name}
        onClick={() => { setCampaignId(c.campaignId); setVersions({}); setError(''); }}>
        <i className="lab-dock-dot" /><span className="lab-dock-title">{c.name}</span>
      </button>)}
    </nav>}
    {modal?.kind === 'new' && <Modal title="New campaign" close={() => setModal(null)}>
      <form className="campaign-form" onSubmit={create}>
        <label>Campaign goal<textarea rows={3} maxLength={600} required value={goal} onChange={e => setGoal(e.target.value)}
          placeholder={'What are you launching for ' + brand.name + '?'} /></label>
        <fieldset><legend>Audience</legend><div className="campaign-segments">{audience.segments.map(s => <label key={s.slug}>
          <input type="checkbox" checked={segments.includes(s.slug)} disabled={!segments.includes(s.slug) && segments.length >= 4}
            onChange={e => setSegments(ids => e.target.checked ? [...ids, s.slug] : ids.filter(id => id !== s.slug))} />
          <span>{s.label}</span><small>{s.count} people</small>
        </label>)}</div></fieldset>
        <details className="campaign-details"><summary>Format</summary><div className="campaign-ratios">{RATIOS.map(r =>
          <button type="button" key={r} aria-pressed={ratio === r} onClick={() => setRatio(r)}>{r}</button>)}</div></details>
        {data.ready && !audience.segments.length && <p className="campaign-muted">No audience segments are ready yet.</p>}
        {data.ready && !kit && <p className="campaign-muted">This audience needs a brand kit before generating.</p>}
        {error && <p className="campaign-error" role="alert">{error}</p>}
        <button className="lab-primary" disabled={disabled || !goal.trim() || !segments.length || !kit}>{busy ? 'Creating…' : 'Create brief'}<ArrowRight size={14} /></button>
      </form>
    </Modal>}
    {modal?.kind === 'brief' && <Modal title="Edit brief" close={() => setModal(null)}>
      {error && <p className="campaign-error" role="alert">{error}</p>}
      <BriefEditor key={modal.brief.briefId} brief={modal.brief} data={data} action={action} disabled={disabled} close={() => setModal(null)} />
    </Modal>}
    {modal?.kind === 'variant' && <Modal title="Edit concept" close={() => setModal(null)}>
      {error && <p className="campaign-error" role="alert">{error}</p>}
      <VariantEditor key={modal.variant.variantId} variant={modal.variant} data={data} action={action} disabled={disabled}
        versions={variants.filter(v => v.rootVariantId === modal.variant.rootVariantId)}
        onVersion={id => setVersions(prev => ({ ...prev, [modal.variant.rootVariantId]: id }))} close={() => setModal(null)} />
    </Modal>}
  </main>;
}
