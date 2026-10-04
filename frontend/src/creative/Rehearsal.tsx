import { useEffect, useState } from 'react';
import { ArrowRight, Check, Image, LoaderCircle, RotateCcw } from 'lucide-react';
import { money, type BrandKit, type Brief, type Campaign, type CreativeHandoff, type Theme, type Variant } from './model';

type Recording = { recordedAt: string; campaign: Campaign; brandKit: BrandKit; briefs: Brief[]; variants: Variant[] };
type RecordingFile = Omit<Recording, 'campaign' | 'variants'> & { campaign: Omit<Campaign, 'createdBy'>; variants: (Omit<Variant, 'costUsdTicks'> & { costUsdTicks: string })[] };
function Evidence({ themes, avoid = false }: { themes: Theme[]; avoid?: boolean }) {
  return <div className={`studio-themes${avoid ? ' studio-avoid' : ''}`}>{themes.map((theme, index) => <span key={`${theme.text}-${index}`} tabIndex={0} title={`${Math.round(theme.support * 100)}% support · cites ${theme.evidenceCount ?? theme.twinIds.length} synthetic personas in the recorded brief.`}>{theme.text}<small>{Math.round(theme.support * 100)}%</small></span>)}</div>;
}

export default function Rehearsal({ onReturn, onHandoff }: { onReturn: () => void; onHandoff: (handoff: CreativeHandoff) => void }) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [takeId, setTakeId] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/rehearsal/campaign.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The saved rehearsal is unavailable. Return to the live studio to start a campaign.');
      const file = await response.json() as RecordingFile;
      if (!file.recordedAt || !file.campaign || !Array.isArray(file.briefs) || !Array.isArray(file.variants)) throw new Error('The saved rehearsal file is incomplete.');
      const variants = file.variants.map(variant => ({ ...variant, costUsdTicks: BigInt(variant.costUsdTicks) }));
      setRecording({ ...file, campaign: { ...file.campaign, createdBy: { toHexString: () => '' } }, variants });
      setSelected(variants.filter(variant => variant.approved && variant.status === 'ready').map(variant => variant.variantId));
      setTakeId(variants[0]?.variantId ?? '');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, []);
  const send = () => {
    if (!recording) return;
    onHandoff({ recordedRehearsal: true, recordedAt: recording.recordedAt, campaign: recording.campaign,
      variants: recording.variants.filter(variant => selected.includes(variant.variantId)).map(variant => {
        const brief = recording.briefs.find(item => item.briefId === variant.briefId);
        return { ...variant, approved: true, brief, segment: brief?.segment ?? '' };
      }) });
  };
  return <section className="studio-rehearsal">
    <div className="studio-status"><span className="studio-recorded-label">Recorded rehearsal · Grok-generated creative</span><span>Synthetic audience personas</span><button className="dash-secondary" onClick={onReturn}><RotateCcw size={12} /> Return to live studio</button></div>
    <div className="dash-notice" role="status">{recording ? `Recorded ${new Date(recording.recordedAt).toLocaleString()}. These saved images and prompts came from a real Grok run. No live generation calls.` : 'Opening the saved rehearsal. No live generation calls.'}</div>
    {error ? <div className="dash-card studio-loading studio-error" role="alert"><Image size={24} /><p>{error}</p><button className="dash-secondary" onClick={onReturn}>Return to live studio</button></div> : !recording ? <div className="dash-card studio-loading" role="status"><LoaderCircle className="studio-spin" size={22} /><p>Loading recorded creative…</p></div> : <>
      <section className="dash-card studio-recorded-anchor"><div><span className="dash-eyebrow">SAVED CAMPAIGN · {recording.brandKit?.displayName ?? 'BRAND'}</span><h2>{recording.campaign.name}</h2><p>{recording.campaign.goal}</p><span className="dash-chip">{recording.campaign.channel} · {recording.campaign.aspectRatio}</span></div><strong>Recorded image cost {money(recording.variants.reduce((sum, variant) => sum + variant.costUsdTicks, 0n))}</strong></section>
      <div className="studio-section-head"><div><span className="dash-eyebrow">THE RECORDED DIRECTION</span><h2>An audience-backed brief.</h2></div><span className="dash-chip">Read only · saved evidence</span></div>
      <div className="studio-brief-list">{recording.briefs.filter(brief => !recording.briefs.some(other => other.segment === brief.segment && other.version > brief.version)).map(brief => <article className="dash-card studio-recorded-brief" key={brief.briefId}>
        <div className="dash-card-head"><div><span className="dash-eyebrow">{brief.segment.replaceAll('_', ' ').toUpperCase()} · BRIEF V{brief.version}</span><h2>{brief.audienceLabel}</h2></div><span className="dash-chip">{brief.twinCount} personas · {Math.round(brief.share * 100)}%</span></div><p className="studio-angle">{brief.messageAngle}</p><span className="studio-label">WHAT RESONATES · RECORDED SUPPORT</span><Evidence themes={brief.keyInterests} /><span className="studio-label">AVOID</span><Evidence themes={brief.avoid} avoid /><details className="studio-details"><summary>View saved creative brief</summary><p><strong>Tone:</strong> {brief.tone}</p><p><strong>Value propositions:</strong> {brief.valueProps.join(' · ')}</p><p><strong>Visual cues:</strong> {brief.visualCues.join(' · ')}</p><p><strong>Visual avoids:</strong> {brief.visualAvoid.join(' · ')}</p><small>{brief.model} · {brief.editedByUser ? 'Edited during the recorded run' : 'Generated brief'}</small></details>
      </article>)}</div>
      <div className="studio-section-head studio-takes-head"><div><span className="dash-eyebrow">THE RECORDED TAKES</span><h2>See how the idea changed.</h2></div><span className="dash-chip">{recording.variants.length} saved takes</span></div>
      <div className="studio-variant-grid">{recording.variants.map(variant => {
        const brief = recording.briefs.find(item => item.briefId === variant.briefId);
        const takes = recording.variants.filter(take => take.rootVariantId === variant.rootVariantId).sort((a, b) => a.depth - b.depth);
        return <article key={variant.variantId} data-recorded-take={variant.variantId} className={`dash-card studio-recorded-variant${takeId === variant.variantId ? ' is-selected' : ''}`}>
          <div className="studio-variant-heading"><span>{brief?.segment.replaceAll('_', ' ')} · Take {variant.depth + 1}</span><span className="dash-chip">Recorded {variant.operation}</span></div>
          <div className="studio-art" style={{ aspectRatio: variant.aspectRatio.replace(':', '/') }}>{variant.imageUrl ? <><img src={variant.imageUrl} alt={`Recorded ${brief?.audienceLabel ?? 'campaign'} creative, take ${variant.depth + 1}`} /><div className="studio-copy studio-recorded-copy"><strong>{variant.headline}</strong><span>{variant.cta}</span></div></> : <div className="studio-art-state"><Image size={24} /><strong>No saved image for this take</strong></div>}</div>
          <div className="studio-copy-save"><span>{variant.aspectRatio} · Recorded cost {money(variant.costUsdTicks)}</span><button className="dash-secondary" aria-pressed={selected.includes(variant.variantId)} disabled={variant.status !== 'ready' || !variant.imageUrl} onClick={() => setSelected(previous => previous.includes(variant.variantId) ? previous.filter(id => id !== variant.variantId) : [...previous, variant.variantId])}><Check size={12} />{selected.includes(variant.variantId) ? 'Selected for draft lab' : 'Select for draft lab'}</button></div>
          <details className="studio-details"><summary>View recorded image prompt</summary><p className="studio-recorded-prompt">{variant.imagePrompt}</p>{variant.instruction && <p><strong>Recorded edit:</strong> {variant.instruction}</p>}</details>
          <div className="studio-lineage" aria-label="Recorded take history">{takes.map(take => <button key={take.variantId} aria-pressed={take.variantId === takeId} title={`${take.parentVariantId ? `Child of ${take.parentVariantId}` : 'Root take'} · ${take.operation}`} onClick={() => { setTakeId(take.variantId); requestAnimationFrame(() => document.querySelector(`[data-recorded-take="${CSS.escape(take.variantId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }}>{take.imageUrl ? <img src={take.imageUrl} alt="" /> : <Image size={14} />}<span>{take.depth === 0 ? 'Root' : '→'} Take {take.depth + 1}<small>{take.operation}</small></span></button>)}</div>
        </article>;
      })}</div>
      <div className="dash-card studio-handoff"><div><h3>Explore the saved creative.</h3><p>Your selections stay local. The draft lab keeps the recorded label and uses its existing sample comparison.</p></div><button className="dash-primary" disabled={!selected.length} onClick={send}>Send {selected.length} recorded {selected.length === 1 ? 'take' : 'takes'} to draft lab <ArrowRight size={14} /></button></div>
    </>}
  </section>;
}
