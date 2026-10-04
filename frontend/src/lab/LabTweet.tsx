import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Heart, Repeat2, MessageCircle, Quote, ArrowUpRight } from 'lucide-react';
import { TweetCard, TweetAvatar, type TweetAuthor } from '../components/ui/tweet-card';
import { SIGNALS, SIGNAL_LABEL, type LabEvent, type LabRun, type Signal } from './labData';
import type { LabComment } from './labComments';
import { formatCount } from './SignalRow';
import { experimentDate } from './labTime';

type LabTweetProps = {
  draft: 'A' | 'B'; author: TweetAuthor; text: string; createdAt: number; run: LabRun | null;
  counts: Record<Signal, number> | null; comments: LabComment[]; members?: Set<string>;
  winner: boolean; replaying: boolean; commentsError: string; onRetryComments: () => void;
};
const icons = { like: Heart, repost: Repeat2, reply: MessageCircle, quote: Quote };
const verbs = { like: 'liked this draft', repost: 'reposted this draft', reply: 'replied to this draft', quote: 'quoted this draft' };
type ThreadItem = { id: string; actor: TweetAuthor; signal: Signal; tick: number; text?: string };

export function LabTweet({ draft, author, text, createdAt, run, counts, comments, members, winner, replaying, commentsError, onRetryComments }: LabTweetProps) {
  const reduced = useReducedMotion();
  const tick = run?.replayTick ?? -1;
  const written = comments.filter(c => c.runId === run?.runId && c.tick <= tick && (!members || members.has(c.userId)));
  const events = run?.events.filter(e => e.tick <= tick && (!members || members.has(e.userId))) ?? [];
  const people = new Map<string, LabEvent>(run?.events.map(e => [e.userId, e]) ?? []);
  const actor = (id: string): TweetAuthor => {
    const person = people.get(id);
    return { name: person?.name || person?.handle || 'Audience member', handle: person?.handle || id, avatar: person?.avatar };
  };
  const writtenPairs = new Set(written.map(c => `${c.userId}:${c.kind}`));
  const items: ThreadItem[] = [
    ...written.map(c => ({ id: `comment:${c.id}`, actor: actor(c.userId), signal: c.kind, tick: c.tick, text: c.text })),
    ...events.filter(e => !writtenPairs.has(`${e.userId}:${e.signal}`)).map(e => ({ id: `event:${e.userId}:${e.signal}:${e.tick}`, actor: actor(e.userId), signal: e.signal, tick: e.tick })),
  ].sort((a, b) => b.tick - a.tick || a.id.localeCompare(b.id)).slice(0, 40);
  const date = experimentDate(createdAt);
  const timestamp = Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return <section className={`lab-post-column lab-draft-${draft.toLowerCase()}`} aria-labelledby={`lab-post-${draft}`} data-replay-tick={tick}>
    <div className="lab-post-label"><h2 id={`lab-post-${draft}`}><span className="lab-draft-badge">{draft}</span>Draft {draft}</h2><span>{winner ? 'Leading draft' : replaying ? 'Replaying reactions' : run?.status === 'scoring' ? 'Scoring…' : 'Audience simulation'}</span></div>
    <TweetCard author={author} text={text} metadata={<>{timestamp && <span title={`Experiment created ${date.toLocaleString()}`}>{timestamp}<span aria-hidden="true"> · </span></span>}<span>{run?.status === 'done' ? 'Simulated · Median forecast' : 'Simulated · Recorded trial'}</span></>}>
      <div className="lab-tweet-metrics" aria-label={`Draft ${draft} engagement`}>
        {SIGNALS.map(signal => {
          const Icon = icons[signal], value = counts?.[signal] ?? null, range = run?.signals?.[signal];
          return <div key={signal} className={`lab-tweet-metric lab-metric-${signal}`} aria-label={`${SIGNAL_LABEL[signal]}: ${formatCount(value)}`} title={range ? `${SIGNAL_LABEL[signal]} forecast range: ${range.p10}–${range.p90}${members ? ' (whole audience)' : ''}` : undefined}>
            <Icon size={18} strokeWidth={1.6} aria-hidden="true" /><span className={value === null ? 'is-pending' : ''} key={formatCount(value)}>{formatCount(value)}</span><small>{SIGNAL_LABEL[signal]}</small>
          </div>;
        })}
      </div>
    </TweetCard>
    <section className="lab-thread" aria-label={`Draft ${draft} audience reactions`}>
      <div className="lab-thread-heading"><span>Audience reactions</span><span className="lab-thread-live"><i className={run?.status === 'replaying' || replaying ? 'is-running' : ''} aria-hidden="true" />{run?.status === 'replaying' ? 'Live' : replaying ? 'Replay' : 'Recorded'}</span></div>
      {!items.length && <div className="lab-thread-empty"><MessageCircle size={20} strokeWidth={1.4} /><p>{run?.status === 'scoring' ? 'The audience is considering your draft.' : !run ? 'Reactions will appear when the simulation starts.' : 'No reactions in this audience yet.'}</p></div>}
      <ul aria-live="polite" aria-relevant="additions text"><AnimatePresence initial={false}>{items.map(item => {
        const Icon = icons[item.signal];
        return <motion.li key={item.id} data-reaction-kind={item.signal} data-reaction-tick={item.tick} data-user-id={item.actor.handle} initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
          <TweetAvatar key={item.actor.avatar || item.actor.handle} author={item.actor} size={30} />
          <div className="lab-reaction-content"><div><strong>{item.actor.name}</strong><span>@{item.actor.handle.replace(/^@/, '')}</span></div>{item.text !== undefined ? <><span className="lab-reaction-context">{item.signal === 'quote' ? 'Quoted your draft' : 'Replying to your draft'}</span><p>{item.text}</p></> : <p className="lab-reaction-verb">{verbs[item.signal]}</p>}</div><Icon className={`lab-reaction-icon lab-metric-${item.signal}`} size={14} strokeWidth={1.5} aria-hidden="true" />
        </motion.li>;
      })}</AnimatePresence></ul>
    </section>
    {commentsError && <div className="lab-thread-notice"><span>Written responses are temporarily unavailable.</span><button onClick={onRetryComments} title="Retry loading written responses">Try again <ArrowUpRight size={10} /></button></div>}
  </section>;
}
