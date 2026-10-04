import { useEffect, useState } from 'react';
import { Image as ImageIcon, Film } from 'lucide-react';
import { sql } from '../audience/liveAudience';
import { mediaSource } from './labResimulate';
import { tweetText } from '../flow/flowApi';

type Video = { video_url: string; thumbnail_url: string; title: string; status: string };
type Image = { variant_id: string; image_url: string | null; headline: string; cta: string; status: string };
type Media = { video: Video | null; image: Image | null };
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Media is read from the experiment's actual campaign; no placeholder creatives are used. */
export function LabDraftVideo({ draft, text }: { draft: 'A' | 'B'; text?: string }) {
  const exp = new URLSearchParams(location.search).get('exp');
  const sourceParam = new URLSearchParams(location.search).get('source');
  const source = exp ? (sourceParam && /^\d+$/.test(sourceParam) ? sourceParam : mediaSource(exp)) : null;
  const [media, setMedia] = useState<Media | null>(null);
  const [choice, setChoice] = useState<'image' | 'video'>('image');
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setMedia(null); setBroken(false); setChoice('image');
    if (!exp || !/^\d+$/.test(exp)) return;
    const abort = new AbortController(); let timer = 0;
    const load = async () => {
      try {
        const [links, flows] = await Promise.all([
          sql<{ video_id: string }>(`SELECT video_id FROM lab_draft_media WHERE media_id = '${source}:${draft}'`, abort.signal),
          sql<{ campaign_id: string; video_id: string; source: string }>(`SELECT campaign_id, video_id, source FROM campaign_flow WHERE experiment_id = ${source}`, abort.signal),
        ]);
        const flow = flows[0], videoId = links[0]?.video_id || flow?.video_id;
        const [videos, variants] = await Promise.all([
          videoId ? sql<Video>(`SELECT video_url, thumbnail_url, title, status FROM campaign_video WHERE video_id = ${quote(videoId)}`, abort.signal) : Promise.resolve([]),
          flow?.source === 'generate' && text ? sql<Image>(`SELECT variant_id, image_url, headline, cta, status FROM ad_variant WHERE campaign_id = ${quote(flow.campaign_id)}`, abort.signal) : Promise.resolve([]),
        ]);
        const matches = variants.filter(image => image.status === 'ready' && image.image_url && tweetText(image.headline, image.cta) === text);
        if (!abort.signal.aborted) setMedia({ video: videos[0] ?? null, image: matches.length === 1 ? matches[0] : null });
      } catch { /* Optional media never prevents the real draft and reactions from rendering. */ }
      if (!abort.signal.aborted) timer = window.setTimeout(() => void load(), 5000);
    };
    void load();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [exp, source, draft, text]);
  if (!media?.video && !media?.image) return null;
  const video = media.video, image = media.image;
  const showVideo = Boolean(video && (!image || choice === 'video'));
  return <div className="lab-generated-media">
    {image && video && <div className="lab-media-tabs" aria-label={`Draft ${draft} media`}><button aria-pressed={!showVideo} onClick={() => { setChoice('image'); setBroken(false); }}><ImageIcon size={12} />Image</button><button aria-pressed={showVideo} onClick={() => { setChoice('video'); setBroken(false); }}><Film size={12} />Video</button></div>}
    <div className="lab-tweet-media">
      {broken ? <div className="lab-media-pending"><span>Media could not load.</span><button onClick={() => setBroken(false)}>Try again</button></div> : showVideo && video ? video.status === 'done' && video.video_url
        ? <video key={video.video_url} src={video.video_url} poster={video.thumbnail_url || undefined} controls playsInline preload="metadata" aria-label={video.title || `Draft ${draft} video`} onError={() => setBroken(true)} />
        : <div className="lab-media-pending" role="status"><Film size={20} /><span>{video.status === 'failed' ? 'Video generation failed.' : 'Generating campaign video…'}</span></div>
        : image?.image_url ? <img key={image.image_url} src={image.image_url} alt={image.headline || `Draft ${draft} campaign creative`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : null}
    </div>
  </div>;
}
