import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import type { LabRun } from './labData';
import { Avatar } from './Tweet';

export type ReactionView = 'comments' | 'likes' | 'reposts';
export function LabReactions({ draft, handle, run, tick, view, onView }: { draft: 'A' | 'B'; handle: string; run: LabRun | null; tick: number; view: ReactionView; onView: (view: ReactionView) => void }) {
  const comments = (run?.comments ?? []).filter(row => row.tick <= tick);
  // Twins first, then the real followers a linear projection adds (run.projected).
  const events = [...(run?.events ?? []), ...(run?.projected ?? [])].filter(row => row.tick <= tick);
  const likes = events.filter(row => row.signal === 'like');
  const reposts = events.filter(row => row.signal === 'repost' || row.signal === 'quote');
  const written = view === 'comments' ? comments : view === 'reposts' ? comments.filter(row => row.kind === 'quote') : [];
  const actors = view === 'likes' ? likes : view === 'reposts' ? reposts.filter(row => !written.some(comment => comment.userId === row.userId && row.signal === 'quote')) : [];
  return <section className="lab-reaction-browser" aria-label={`Draft ${draft} reactions`}>
    <div className="lab-reaction-tabs" role="tablist" aria-label={`Draft ${draft} reactions`}>{([{ id: 'comments', label: 'Comments', icon: MessageCircle }, { id: 'likes', label: 'Likes', icon: Heart }, { id: 'reposts', label: 'Reposts', icon: Repeat2 }] as const).map(item => <button key={item.id} id={`reaction-tab-${draft}-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls={`reactions-${draft}`} tabIndex={view === item.id ? 0 : -1} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const options: ReactionView[] = ['comments', 'likes', 'reposts'];
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (options.indexOf(view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      onView(options[index]); document.getElementById(`reaction-tab-${draft}-${options[index]}`)?.focus();
    }} onClick={() => onView(item.id)}><item.icon size={14} />{item.label}</button>)}</div>
    <div id={`reactions-${draft}`} className="lab-replies" role="tabpanel" aria-labelledby={`reaction-tab-${draft}-${view}`} aria-live="polite">
      {!written.length && !actors.length && <p className="lab-reaction-empty">No {view} yet.</p>}
      {written.map(row => <article key={`${row.userId}:${row.kind}:${row.tick}`} className="lab-reply" aria-label={`Reply from @${row.handle}`}><Avatar src={row.avatar} name={row.name || row.handle} size={34} /><div className="lab-tweet-body"><header><b>{row.name || row.handle}</b><span className="lab-muted">@{row.handle}</span>{row.kind === 'quote' && <span className="lab-quote-tag"><Quote size={11} />quoted</span>}</header>{row.kind === 'reply' && <p className="lab-replying">Replying to <span>@{handle}</span></p>}<p className="lab-text">{row.text}</p></div></article>)}
      {actors.map(row => <article key={`${row.userId}:${row.signal}:${row.tick}`} className="lab-reaction-person" aria-label={`${row.name || row.handle} ${view === 'likes' ? 'liked' : row.signal === 'quote' ? 'quoted' : 'reposted'} draft ${draft}`}><Avatar src={row.avatar} name={row.name || row.handle} size={34} /><div><b>{row.name || row.handle}</b><span>@{row.handle}</span>{row.projected && <span className="lab-projected-tag" title="Real follower, projected from the simulated audience">projected</span>}</div>{view === 'likes' ? <Heart size={14} /> : <Repeat2 size={14} />}</article>)}
    </div>
  </section>;
}
