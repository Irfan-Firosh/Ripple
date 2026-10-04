import { useEffect, useState } from 'react';
import { FlaskConical, PenLine, X } from 'lucide-react';
import { requestDraftVideo, requestVideoEdit, scriptOf, type Draft, type DraftVideos, type ScriptBeat, type VideoRow } from './flowApi';
import { VideoCard } from './FlowSteps';
import { ClientTweetCard } from '@/registry/magicui/client-tweet-card';
import type { TweetAuthor } from '../components/ui/tweet-card';
import { useBrandAuthor, useVideoOff } from './useFlowMeta';

export type DraftCopy = { text: string; image?: string; writing?: boolean };

function VideoEditor({ video, onClose, onSaved }: { video: VideoRow; onClose: () => void; onSaved: () => void }) {
  const original = scriptOf(video);
  const [beats, setBeats] = useState<ScriptBeat[]>(original);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i: number, key: keyof ScriptBeat, value: string) => setBeats(b => b.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  const changed = beats.some((b, i) => b.on_screen !== original[i]?.on_screen || b.voiceover !== original[i]?.voiceover);
  const save = async () => {
    setBusy(true); setError('');
    try { await requestVideoEdit(video.video_id, ask, changed ? beats : []); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="flow-editor" role="dialog" aria-label="Edit video">
    <header><b>Edit video</b><button className="flow-icon" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
    <label className="flow-ask"><span>Tell Opus what to change</span>
      <textarea rows={2} maxLength={600} value={ask} placeholder="e.g. slower opening, bigger product UI" onChange={e => setAsk(e.target.value)} /></label>
    <ol className="flow-beats">{beats.map((b, i) => <li key={i}>
      <input aria-label={`Beat ${i + 1} on screen`} value={b.on_screen} maxLength={80} onChange={e => set(i, 'on_screen', e.target.value)} />
      <textarea aria-label={`Beat ${i + 1} voiceover`} rows={2} value={b.voiceover} maxLength={200} onChange={e => set(i, 'voiceover', e.target.value)} />
    </li>)}</ol>
    {error && <p className="flow-error" role="alert">{error}</p>}
    <button className="flow-primary" disabled={busy || (!changed && !ask.trim())} onClick={() => void save()}>Make new version</button>
  </div>;
}

function DraftColumn({ campaignId, draft, copy, video, author, onSaved, videoOff, imagePreview = false }: { campaignId: string; draft: Draft; copy: DraftCopy; video: VideoRow | null; author: TweetAuthor; onSaved: () => void; videoOff: boolean; imagePreview?: boolean }) {
  const [editing, setEditing] = useState(false);
  const retry = () => void requestDraftVideo(campaignId, draft, copy.text).then(onSaved).catch(() => undefined);
  return <section className="flow-draft">
    <span className="flow-draft-label">Draft {draft}</span>
    <ClientTweetCard className="flow-tweet" label={`Draft ${draft}`} scrollable busy={copy.writing}
      draft={{ author, text: copy.text }}>
      {copy.writing && <span className="flow-writing" role="status">Writing the tweet…</span>}
      {imagePreview && copy.image ? <img className="flow-still" src={copy.image} alt="" /> : videoOff && !video ? copy.image && <img className="flow-still" src={copy.image} alt="" /> : <VideoCard video={video} poster={copy.image} />}
    </ClientTweetCard>
    {video?.status === 'failed' && <button className="flow-secondary flow-edit" onClick={retry}>Try again</button>}
    {video?.status === 'done' && !editing && <button className="flow-secondary flow-edit" onClick={() => setEditing(true)}><PenLine size={14} />Edit video</button>}
    {editing && video && <VideoEditor video={video} onClose={() => setEditing(false)} onSaved={onSaved} />}
  </section>;
}

export function DraftsStep({ brand, brandId, campaignId, a, b, videos, busy, waiting, onTest, onSaved, preview = false }: {
  brand: string; brandId: string; campaignId: string; a: DraftCopy | null; b: DraftCopy | null; videos: DraftVideos; busy: boolean; waiting: string; onTest: () => void; onSaved: () => void; preview?: boolean;
}) {
  const author = useBrandAuthor(brand, brandId);
  const videoOff = useVideoOff();
  return <div className="flow-drafts-step">
    {waiting && <p className="flow-waiting" role="status">{waiting}</p>}
    <div className="flow-pair">
      {a && <DraftColumn campaignId={campaignId} draft="A" copy={a} video={videos.A} author={author} onSaved={onSaved} videoOff={videoOff} imagePreview={preview} />}
      {b && <DraftColumn campaignId={campaignId} draft="B" copy={b} video={videos.B} author={author} onSaved={onSaved} videoOff={videoOff} />}
    </div>
    <button className="flow-primary" disabled={busy || !a || !b || a.writing || b.writing} onClick={onTest}><FlaskConical size={15} />Test A vs B</button>
  </div>;
}
