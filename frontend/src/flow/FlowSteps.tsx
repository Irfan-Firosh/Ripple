import { useEffect, useState } from 'react';
import { listActiveBrands, type ActiveBrand } from '../history/historyData';
import { ArrowRight, Check, Download, FlaskConical, Import, Send, Sparkles } from 'lucide-react';
import type { Variant } from '../creative/model';
import { MAX_POST, shipIntent, type BrandPost, type ExperimentRow, type VideoRow } from './flowApi';
import { ClientTweetCard } from '@/registry/magicui/client-tweet-card';
import { useBrandAuthor } from './useFlowMeta';

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued', research: 'Researching the brand', brief: 'Writing the brief', voice: 'Recording the voiceover',
  film: 'Writing the film', stills: 'Checking stills', revise: 'Fixing what the critic found', render: 'Rendering',
  thumbnail: 'Making the thumbnail', done: 'Ready', failed: 'Failed',
};

// Pick the project (a brand with an analysed audience) the campaign is for; switching reloads the page for that brand.
function ProjectPicker({ brand }: { brand: string }) {
  const [brands, setBrands] = useState<ActiveBrand[] | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    listActiveBrands(abort.signal).then(list => {
      setBrands(list);
      if (list.length && !list.some(b => b.handle.toLowerCase() === brand)) open(list[0].handle, true);
    }).catch(() => setBrands([]));
    return () => abort.abort();
  }, [brand]);
  const open = (handle: string, replace = false) => {
    const url = `/campaign?${new URLSearchParams({ brand: handle })}`;
    if (replace) location.replace(url); else location.assign(url);
  };
  return <label className="flow-project"><span className="flow-eyebrow">PROJECT</span>
    <select value={brand} disabled={!brands} onChange={e => e.target.value === '__add' ? location.assign('/onboarding?flow=campaign') : open(e.target.value)}>
      {!brands && <option value={brand}>Loading projects…</option>}
      {brands?.map(b => <option key={b.handle} value={b.handle.toLowerCase()}>@{b.handle}</option>)}
      {brands && <option value="__add">+ Add a project</option>}
    </select></label>;
}

export function StartChoice({ brand, busy, onGenerate, onImport }: { brand: string; busy: boolean; onGenerate: () => void; onImport: () => void }) {
  return <><ProjectPicker brand={brand} /><div className="flow-start">
    <button className="flow-choice flow-choice-primary" disabled={busy} onClick={onGenerate}>
      <Sparkles size={14} />Generate new campaign</button>
    <button className="flow-choice" disabled={busy} onClick={onImport}>
      <Import size={14} />Import drafts</button>
  </div></>;
}

export function ImportStep({ brand, posts, busy, onSubmit }: { brand: string; posts: BrandPost[]; busy: boolean; onSubmit: (a: string, b: string) => void }) {
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const fill = (text: string) => (a.trim() ? setB(text.slice(0, MAX_POST)) : setA(text.slice(0, MAX_POST)));
  return <form className="flow-import" onSubmit={e => { e.preventDefault(); onSubmit(a, b); }}>
    <div className="flow-drafts">{([{ label: 'A', value: a, set: setA }, { label: 'B', value: b, set: setB }]).map(({ label, value, set }) =>
      <label className="flow-compose-card" key={label}><span className="flow-compose-header"><span className="flow-compose-avatar">{brand.charAt(0).toUpperCase()}</span><span><b>@{brand}</b><small>Draft {label}</small></span><span className="flow-compose-badge">{label}</span></span>
        <textarea aria-label={`Draft ${label}`} rows={5} maxLength={MAX_POST} value={value} placeholder="What do you want to share?"
          onChange={e => set(e.target.value)} />
        <span className="flow-compose-footer">Post on X<i>{value.length}/{MAX_POST}</i></span></label>)}</div>
    {posts.length > 0 && <div className="flow-posts"><span className="flow-eyebrow">RECENT POSTS</span>
      {posts.map(p => <button type="button" key={p.post_id} onClick={() => fill(p.text)}>{p.text}</button>)}</div>}
    <button className="flow-primary" disabled={busy || !a.trim() || !b.trim()}>Use these drafts<ArrowRight size={15} /></button>
  </form>;
}

export function VideoCard({ video, note = '', poster }: { video: VideoRow | null; note?: string; poster?: string }) {
  if (video?.status === 'done') return <div className="flow-video"><video src={video.video_url} poster={video.thumbnail_url}
    controls playsInline preload="metadata" /></div>;
  const label = video ? (video.status === 'failed' ? `Video failed: ${video.error}` : STAGE_LABEL[video.status] ?? video.status) : note || 'Queuing the video…';
  return <div className="flow-video flow-video-pending" role={video?.status === 'failed' ? 'alert' : 'status'}>
    {poster && <img src={poster} alt="" />}
    <div className="flow-video-progress"><span>{label}</span>
      {video && video.status !== 'failed' && <div className="flow-bar"><i style={{ width: `${Math.round(video.progress * 100)}%` }} /></div>}</div>
  </div>;
}

export type Concept = { key: string; text: string; image?: string; variant?: Variant };

export function ConceptsStep({ concepts, picked, onPick, video, busy, onTest, waiting, videoNote = '' }: {
  concepts: Concept[]; picked: string[]; onPick: (key: string) => void; video: VideoRow | null; busy: boolean;
  onTest: () => void; waiting: string; videoNote?: string;
}) {
  return <div className="flow-concepts">
    {waiting && <p className="flow-waiting" role="status">{waiting}</p>}
    <div className="flow-grid">{concepts.map(c => {
      const slot = picked.indexOf(c.key);
      return <button key={c.key} className="flow-concept" data-picked={slot >= 0} onClick={() => onPick(c.key)}>
        {slot >= 0 && <span className="flow-slot">{slot === 0 ? 'A' : 'B'}</span>}
        {c.image && <img src={c.image} alt="" />}<p>{c.text}</p></button>;
    })}</div>
    <div className="flow-side"><span className="flow-eyebrow">VIDEO · 16:9</span><VideoCard video={video} note={videoNote} />
      <button className="flow-primary" disabled={busy || picked.length !== 2} onClick={onTest}>
        <FlaskConical size={15} />Test A vs B in the Lab</button></div>
  </div>;
}

export function TestStep({ experiment, labHref, busy, onApprove }: {
  experiment: ExperimentRow | null; labHref: string; busy: boolean; onApprove: (draft: 'A' | 'B') => void;
}) {
  const done = experiment?.status === 'done';
  const pick = experiment?.winner === 'B' ? 'B' : 'A';
  return <div className="flow-test">
    {!done ? <p role="status">{experiment?.status === 'failed' ? `The test failed: ${experiment.error}` : 'Every follower twin is seeing both drafts…'}</p>
      : <h2>{experiment.winner === 'tie' ? 'A and B are tied.' : `${experiment.winner} wins, ${experiment.lift >= 0 ? '+' : ''}${Math.round(Math.abs(experiment.lift) * 100)}% expected engagement.`}</h2>}
    <a className="flow-link" href={labHref}>Watch it play out in the Lab<ArrowRight size={14} /></a>
    {done && <div className="flow-row">
      <button className="flow-primary" disabled={busy} onClick={() => onApprove(pick)}><Check size={15} />Approve {pick}</button>
      <button className="flow-secondary" disabled={busy} onClick={() => onApprove(pick === 'A' ? 'B' : 'A')}>Approve {pick === 'A' ? 'B' : 'A'} instead</button>
    </div>}
  </div>;
}

export function LaunchStep({ brand, brandId, text, onText, video, shipped, busy, onShip }: {
  brand: string; brandId: string; text: string; onText: (t: string) => void; video: VideoRow | null; shipped: boolean; busy: boolean; onShip: () => void;
}) {
  const author = useBrandAuthor(brand, brandId);
  // The post exactly as it will look (same card as the Lab), with the text editable underneath.
  return <div className="flow-launch">
    <ClientTweetCard className="flow-tweet flow-launch-preview" label="Post preview" draft={{ author, text }}>
      {video?.status === 'done' && <VideoCard video={video} />}
    </ClientTweetCard>
    <label className="flow-post"><span className="flow-eyebrow">EDIT THE POST</span><textarea rows={4} maxLength={MAX_POST} value={text} onChange={e => onText(e.target.value)} />
      <i>{text.length}/{MAX_POST}</i></label>
    <div className="flow-row">
      <a className="flow-primary" href={shipIntent(text)} target="_blank" rel="noreferrer"
        onClick={() => { if (!busy) onShip(); }}><Send size={15} />{shipped ? 'Post again on X' : 'Ship it to X'}</a>
      {video?.status === 'done' && <>
        <a className="flow-secondary" href={video.video_url} download><Download size={14} />Video</a>
        <a className="flow-secondary" href={video.thumbnail_url} download><Download size={14} />Thumbnail</a></>}
    </div>
    <p className="flow-note">X opens with your post ready. Attach the video, then post.</p>
  </div>;
}
