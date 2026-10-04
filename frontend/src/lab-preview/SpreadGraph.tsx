import { useId, useState } from 'react';
import { project, type Point, type Reaction, type SpreadScene } from './spreadScene';
import { ReactionPopup } from './ReactionPopup';

type Props = { scene: SpreadScene; draft: 'A' | 'B'; time: number; reduced: boolean; brandLabel?: string; minimal?: boolean; automaticEvent?: Reaction | null };
const source: Point = { x: -20, y: 120, z: 150 };

export function SpreadGraph({ scene, draft, time, reduced, brandLabel = 'TryCua', minimal = false, automaticEvent }: Props) {
  const id = useId().replaceAll(':', '');
  const [pinned, setPinned] = useState<number | null>(null);
  const [brandBroken, setBrandBroken] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const trial = draft === 'A' ? scene.a : scene.b;
  const angle = .32 + (reduced ? 0 : Math.sin(time * .12) * .14);
  const post = project(source, angle);
  const centers = scene.communities.map(point => project(point, angle));
  const people = scene.people.map(person => ({ ...person, ...project(person, angle), arrival: trial.arrivals[person.id] }));
  const active = people.filter(person => person.arrival <= time).length;
  return <div className="spread-stage">
    <svg className="spread-graph" viewBox="0 0 560 490" role="img" aria-label={`Draft ${draft} ${brandLabel} audience spread`} data-active={active} data-total={people.length} data-time={time.toFixed(2)} data-duration={scene.duration} data-motion={reduced ? 'still' : 'animated'}>
      <defs><filter id={`glow-${id}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter>
        <radialGradient id={`surface-${id}`}><stop stopColor="var(--spread-color)" stopOpacity=".09" /><stop offset="1" stopColor="var(--spread-color)" stopOpacity="0" /></radialGradient></defs>
      <circle cx={280} cy={230} r={210} fill={`url(#surface-${id})`} />
      {scene.links.map(link => <line key={`${link.a}-${link.b}`} x1={centers[link.a].x} y1={centers[link.a].y} x2={centers[link.b].x} y2={centers[link.b].y} stroke="var(--line)" strokeWidth={.6 + link.strength * 1.3} opacity={.6} />)}
      {trial.handoffs.map(handoff => {
        const from = handoff.from === null ? post : centers[handoff.from], to = centers[handoff.to];
        const progress = Math.min(1, Math.max(0, (time - handoff.at) / (handoff.arrives - handoff.at)));
        return <g key={`${handoff.from}-${handoff.to}`} className="spread-connection" data-active={time >= handoff.arrives} data-actor={handoff.actor ?? draft}>
          {handoff.from === null && <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--line)" strokeDasharray="2 5" />}
          {progress > 0 && <line x1={from.x} y1={from.y} x2={from.x + (to.x - from.x) * progress} y2={from.y + (to.y - from.y) * progress} stroke="var(--spread-color)" strokeWidth={1 + handoff.strength * 1.5} opacity={.7} />}
          {progress > 0 && progress < 1 && <circle cx={from.x + (to.x - from.x) * progress} cy={from.y + (to.y - from.y) * progress} r={3} fill="var(--spread-color)" />}
          {time >= handoff.arrives && <circle cx={to.x} cy={to.y} r={Math.min(75, 20 + (time - handoff.arrives) * 22)} fill="none" stroke="var(--spread-color)" opacity={Math.max(0, .35 - (time - handoff.arrives) * .14)} />}
        </g>;
      })}
      {people.map(person => <line key={`line-${person.id}`} x1={centers[person.group].x} y1={centers[person.group].y} x2={person.x} y2={person.y} stroke={person.arrival <= time ? 'var(--spread-color)' : 'var(--line)'} strokeWidth={.6} opacity={person.arrival <= time ? .35 : .35} />)}
      {[...people].sort((a, b) => a.depth - b.depth).map(person => {
        const lit = person.arrival <= time, radius = 6.8 * person.scale, fresh = lit && time - person.arrival < .6;
        const clipping = `profile-${id}-${person.id}`;
        return <g key={person.id} className="spread-person" data-active={lit} data-user-id={person.userId}>
          <title>{`${person.name || person.handle} · @${person.handle} · ${scene.communities[person.group].label}`}</title>
          {fresh && <circle cx={person.x} cy={person.y} r={radius + 6} fill="var(--spread-color)" opacity={.4} filter={`url(#glow-${id})`} />}
          <clipPath id={clipping}><circle cx={person.x} cy={person.y} r={radius} /></clipPath>
          <circle cx={person.x} cy={person.y} r={radius} fill="var(--panel)" />
          {person.avatar && !broken.has(person.userId)
            ? <foreignObject x={person.x - radius} y={person.y - radius} width={radius * 2} height={radius * 2} clipPath={`url(#${clipping})`} style={{ opacity: lit ? 1 : .45, pointerEvents: 'none' }}><img src={person.avatar} alt="" width="100%" height="100%" style={{ objectFit: 'cover', borderRadius: '50%' }} referrerPolicy="no-referrer" onError={() => setBroken(previous => new Set([...previous, person.userId]))} /></foreignObject>
            : <text className="spread-initial" x={person.x} y={person.y + 2.5} textAnchor="middle">{(person.name || person.handle).charAt(0).toUpperCase()}</text>}
          <circle role="button" tabIndex={0} aria-label={`Inspect @${person.handle} in ${scene.communities[person.group].label}`} cx={person.x} cy={person.y} r={radius + .5} fill="transparent" stroke={lit ? 'var(--spread-color)' : 'var(--muted)'} strokeWidth={lit ? 1.5 : .5} opacity={lit ? 1 : .55}
            onMouseEnter={() => setInspect(person.id)} onMouseLeave={() => setInspect(null)} onFocus={() => setInspect(person.id)} onBlur={() => setInspect(null)} onClick={() => setPinned(previous => previous === person.id ? null : person.id)} onKeyDown={event => { if (event.key === 'Escape') { setInspect(null); setPinned(null); } if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPinned(person.id); } }} />
        </g>;
      })}
      {scene.communities.map((community, i) => <g key={community.slug} className="spread-niche" data-size={community.size} data-sample={community.sampleSize} data-active={trial.handoffs.some(handoff => handoff.to === i && handoff.arrives <= time)}>
        <title>{minimal ? community.label : `${community.label} · ${community.share}% of ${brandLabel} audience · ${community.sampleSize} sampled from ${community.size}`}</title>
        <text x={centers[i].x} y={centers[i].y + community.radius * centers[i].scale + 16} textAnchor="middle">{community.label.length > 25 ? community.label.slice(0, 23) + '…' : community.label}</text>
        {!minimal && <text className="spread-share" x={centers[i].x} y={centers[i].y + community.radius * centers[i].scale + 30} textAnchor="middle">{community.share}%</text>}
      </g>)}
      <g className="spread-post" data-draft={draft} transform={`translate(${post.x},${post.y})`}>
        <title>{`${brandLabel} · draft ${draft}`}</title><circle r={20} fill="var(--frame)" stroke="var(--spread-color)" strokeWidth={1.5} />
        {scene.brandAvatar && !brandBroken ? <foreignObject x={-15} y={-15} width={30} height={30}><img src={scene.brandAvatar} alt={`${brandLabel} logo`} width="100%" height="100%" style={{ objectFit: 'cover', borderRadius: '50%' }} referrerPolicy="no-referrer" onError={() => setBrandBroken(true)} /></foreignObject>
          : <text className="spread-brand-fallback" y={4} textAnchor="middle">{brandLabel.replace(/^@/, '').charAt(0).toUpperCase()}</text>}
        <text className="spread-source-label" y={36} textAnchor="middle">{draft}</text>
      </g>
    </svg>
    <ReactionPopup scene={scene} trial={trial} time={time} angle={angle} inspect={pinned ?? inspect} reduced={reduced} automaticEvent={automaticEvent} />
  </div>;
}
