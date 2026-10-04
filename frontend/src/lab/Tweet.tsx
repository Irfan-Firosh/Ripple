import { LabReactions, type ReactionView } from './LabReactions';
import { shipIntent } from '../flow/flowApi';
import { ClientTweetCard } from '@/registry/magicui/client-tweet-card';
import { LabDraftVideo } from './LabDraftVideo';
import './lab-media.css';
import { BarChart3, Heart, MessageCircle, Repeat2, Send, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { finalCounts, countsAt, viewsAt, type LabBrand, type LabEvent, type LabRun, type Signal } from './labData';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const initials = (name: string) => (name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).map(w => w[0]).join('') || '?').slice(0, 2).toUpperCase();

export function Avatar({ src, name, size = 40 }: { src: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img className="lab-avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="lab-avatar lab-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">{initials(name)}</span>;
}

// A count that pops whenever it changes, like X's live counters.
function Count({ value }: { value: number }) {
  const [pop, setPop] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value; setPop(true);
    const t = window.setTimeout(() => setPop(false), 260);
    return () => clearTimeout(t);
  }, [value]);
  return <span data-count={Math.round(value)} className={pop ? 'lab-count lab-pop' : 'lab-count'}>{fmt(value)}</span>;
}

const VERB: Record<Signal, string> = { like: 'liked', repost: 'reposted', reply: 'replied', quote: 'quoted' };

type Props = { label: 'A' | 'B'; brand: LabBrand; draft: string; run: LabRun | null; tick: number; finished: boolean; winner: boolean };

export function Tweet({ label, brand, draft, run, tick, finished, winner }: Props) {
  const [view, setView] = useState<ReactionView>('comments');
  useEffect(() => setView('comments'), [run?.runId]);
  // While the replay plays, counters follow the replayed run; once it ends they settle on the median outcome.
  const live = run ? countsAt(run, undefined, tick) : { like: 0, repost: 0, reply: 0, quote: 0 };
  const median = run?.signals;
  const final = run && finished && median ? finalCounts(run) : null;
  const counts = final ? { like: final.like, repost: final.repost, reply: final.reply, quote: final.quote } : live;
  const views = final && run?.views ? final.views : run ? viewsAt(run, tick) : 0;
  // Twins first, then the real followers a linear projection adds, so likes/reposts show many people, not a few.
  const people = [...(run?.events ?? []), ...(run?.projected ?? [])].filter(e => e.tick <= tick).sort((x, y) => x.tick - y.tick);
  const likers = people.filter(e => e.signal === 'like');
  const reposters = people.filter(e => e.signal === 'repost' || e.signal === 'quote');
  const latest = [...people].reverse().slice(0, 4);
  const scoring = !run || run.status === 'scoring';
  const metric = (key: string, icon: React.ReactNode, value: number, title: string) => {
    const common = { className: `lab-metric lab-metric-${key}`, 'data-metric': key, title, 'aria-label': `${fmt(value)} ${key}` };
    return key === 'views' ? <span {...common}>{icon}<Count value={value} /></span> : <button type="button" onClick={() => setView(key === 'replies' ? 'comments' : key as ReactionView)} {...common}>{icon}<Count value={value} /></button>;
  };
  return <section className="lab-column">
    <div className="lab-column-head"><span className={`lab-draft-tag lab-draft-${label}`}>Draft {label}</span>{winner && <span className="lab-winner-tag"><Trophy size={13} aria-hidden="true" />Winner</span>}
      <a className="lab-share" href={shipIntent(draft)} target="_blank" rel="noopener noreferrer" aria-label={`Share draft ${label} on X`}><Send size={12} />Share on X</a></div>
    <ClientTweetCard className="lab-tweet" label={`Draft ${label}`} scrollable busy={scoring} draft={{ author: { name: brand.name, handle: brand.handle, avatar: brand.avatar }, text: draft, verified: brand.verified }} footer={
        <footer className="lab-metrics" aria-live="polite">
          {metric('replies', <MessageCircle size={17} />, counts.reply, median ? `Likely ${median.reply.p10}–${median.reply.p90}` : 'Replies')}
          {metric('reposts', <Repeat2 size={17} />, counts.repost + counts.quote, median ? `Reposts ${median.repost.p10}–${median.repost.p90}, quotes ${median.quote.p10}–${median.quote.p90}` : 'Reposts and quotes')}
          {metric('likes', <Heart size={17} />, counts.like, median ? `Likely ${median.like.p10}–${median.like.p90}` : 'Likes')}
          {metric('views', <BarChart3 size={17} />, views, run?.views ? `Likely ${fmt(run.views.p10)}–${fmt(run.views.p90)}` : 'Views')}
        </footer>
    }>
      <LabDraftVideo draft={label} text={draft} />
        {reposters.length > 0 && <p className="lab-social-proof"><Repeat2 size={13} /> {reposters[0].name || `@${reposters[0].handle}`}{reposters.length > 1 ? ` and ${reposters.length - 1} others` : ''} reposted</p>}

    </ClientTweetCard>
    <div className="lab-column-rest">
    {likers.length > 0 && <p className="lab-liked-by"><Heart size={13} /> Liked by <b>{likers[0].name || `@${likers[0].handle}`}</b>{likers.length > 1 && <> and {fmt(Math.max(counts.like, likers.length) - 1)} others</>}</p>}
    <ul className="lab-activity" aria-label={`Live activity on draft ${label}`}>
      {latest.map((e: LabEvent) => <li key={`${e.userId}:${e.signal}`} className="lab-activity-row">
        <Avatar src={e.avatar} name={e.name || e.handle} size={20} /><span><b>@{e.handle}</b> {VERB[e.signal]}</span>
      </li>)}
      {run && finished && run.projection?.mode !== 'linear' && run.outsideShare > 0 && <li className="lab-activity-row lab-outside">{Math.round(run.outsideShare * 100)}% of engagement came from reposts reaching people beyond @{brand.handle}'s followers</li>}
    </ul>
    <LabReactions draft={label} handle={brand.handle} run={run} tick={tick} view={view} onView={setView} />
    </div>
  </section>;
}
