import { BarChart3, Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { countsAt, viewsAt, type LabBrand, type LabComment, type LabEvent, type LabRun, type Signal } from './labData';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const initials = (name: string) => (name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).map(w => w[0]).join('') || '?').slice(0, 2).toUpperCase();

export function Avatar({ src, name, size = 40 }: { src: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img className="lab-avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="lab-avatar lab-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">{initials(name)}</span>;
}

function Verified() {
  return <svg className="lab-verified" viewBox="0 0 22 22" aria-label="Verified account" role="img"><path fill="currentColor" d="M20.4 11c0-1.3-.8-2.5-2-3 .3-1.3-.1-2.6-1-3.5-.9-.9-2.3-1.3-3.5-1-.5-1.2-1.7-2-3-2s-2.5.8-3 2c-1.3-.3-2.6.1-3.5 1-.9.9-1.3 2.3-1 3.5-1.2.5-2 1.7-2 3s.8 2.5 2 3c-.3 1.3.1 2.6 1 3.5.9.9 2.2 1.3 3.5 1 .5 1.2 1.7 2 3 2s2.5-.8 3-2c1.3.3 2.6-.1 3.5-1 .9-.9 1.3-2.2 1-3.5 1.2-.5 2-1.7 2-3zm-11 4.6L5.6 11.8l1.4-1.4 2.4 2.4 5.6-5.7 1.4 1.4-7 7.1z" /></svg>;
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
  // While the replay plays, counters follow the replayed run; once it ends they settle on the median outcome.
  const live = run ? countsAt(run, undefined, tick) : { like: 0, repost: 0, reply: 0, quote: 0 };
  const median = run?.signals;
  const counts = finished && median ? { like: median.like.p50, repost: median.repost.p50, reply: median.reply.p50, quote: median.quote.p50 } : live;
  const views = finished && run?.views ? run.views.p50 : run ? viewsAt(run, tick) : 0;
  const people = (run?.events ?? []).filter(e => e.tick <= tick);
  const comments = (run?.comments ?? []).filter(c => c.tick <= tick);
  const likers = people.filter(e => e.signal === 'like');
  const reposters = people.filter(e => e.signal === 'repost' || e.signal === 'quote');
  const latest = [...people].reverse().slice(0, 4);
  const scoring = !run || run.status === 'scoring';
  const metric = (key: string, icon: React.ReactNode, value: number, title: string) =>
    <span className={`lab-metric lab-metric-${key}`} data-metric={key} title={title} aria-label={`${fmt(value)} ${key}`}>{icon}<Count value={value} /></span>;
  return <section className="lab-column">
    <div className="lab-column-head"><span className={`lab-draft-tag lab-draft-${label}`}>Draft {label}</span>{winner && <span className="lab-winner-tag">Winner</span>}</div>
    <article className="lab-tweet" aria-label={`Draft ${label}`} aria-busy={scoring}>
      <Avatar src={brand.avatar} name={brand.name} />
      <div className="lab-tweet-body">
        <header><b>{brand.name}</b>{brand.verified && <Verified />}<span className="lab-muted">@{brand.handle} · now</span></header>
        <p className="lab-text">{draft}</p>
        {reposters.length > 0 && <p className="lab-social-proof"><Repeat2 size={13} /> {reposters[0].name || `@${reposters[0].handle}`}{reposters.length > 1 ? ` and ${reposters.length - 1} others` : ''} reposted</p>}
        <footer className="lab-metrics" aria-live="polite">
          {metric('replies', <MessageCircle size={17} />, counts.reply, median ? `Likely ${median.reply.p10}–${median.reply.p90}` : 'Replies')}
          {metric('reposts', <Repeat2 size={17} />, counts.repost + counts.quote, median ? `Reposts ${median.repost.p10}–${median.repost.p90}, quotes ${median.quote.p10}–${median.quote.p90}` : 'Reposts and quotes')}
          {metric('likes', <Heart size={17} />, counts.like, median ? `Likely ${median.like.p10}–${median.like.p90}` : 'Likes')}
          {metric('views', <BarChart3 size={17} />, views, run?.views ? `Likely ${fmt(run.views.p10)}–${fmt(run.views.p90)}` : 'Views')}
        </footer>
      </div>
    </article>
    {scoring && <p className="lab-status" role="status">Simulating {run?.people ? fmt(run.people) : 'every'} followers with Claude…</p>}
    {likers.length > 0 && <p className="lab-liked-by"><Heart size={13} /> Liked by <b>{likers[0].name || `@${likers[0].handle}`}</b>{likers.length > 1 && <> and {fmt(Math.max(counts.like, likers.length) - 1)} others</>}</p>}
    <ul className="lab-activity" aria-label={`Live activity on draft ${label}`}>
      {latest.map((e: LabEvent) => <li key={`${e.userId}:${e.signal}`} className="lab-activity-row">
        <Avatar src={e.avatar} name={e.name || e.handle} size={20} /><span><b>@{e.handle}</b> {VERB[e.signal]}</span>
      </li>)}
      {run && finished && run.outsideShare > 0 && <li className="lab-activity-row lab-outside">{Math.round(run.outsideShare * 100)}% of engagement came from reposts reaching people beyond @{brand.handle}'s followers</li>}
    </ul>
    <div className="lab-replies">
      {comments.map((c: LabComment) => <article key={`${c.userId}:${c.kind}`} className="lab-reply" aria-label={`Reply from @${c.handle}`}>
        <Avatar src={c.avatar} name={c.name || c.handle} size={34} />
        <div className="lab-tweet-body">
          <header><b>{c.name || c.handle}</b><span className="lab-muted">@{c.handle}</span>{c.kind === 'quote' && <span className="lab-quote-tag"><Quote size={11} /> quoted</span>}</header>
          {c.kind === 'reply' && <p className="lab-replying">Replying to <span>@{brand.handle}</span></p>}
          <p className="lab-text">{c.text}</p>
        </div>
      </article>)}
    </div>
  </section>;
}
