import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart, Repeat2 } from 'lucide-react';
import { project, type Reaction, type SpreadScene, type SpreadTrial } from './spreadScene';
import type { PreviewPerson } from './previewAudience';

function ProfilePhoto({ person }: { person: PreviewPerson }) {
  const [broken, setBroken] = useState(false);
  return person.avatar && !broken ? <img src={person.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="spread-photo-fallback">{(person.name || person.handle).charAt(0).toUpperCase()}</span>;
}

export function ReactionPopup({ scene, trial, time, angle, inspect, reduced, automaticEvent }: {
  scene: SpreadScene; trial: SpreadTrial; time: number; angle: number; inspect: number | null; reduced: boolean; automaticEvent?: Reaction | null;
}) {
  const recent = trial.events.filter(event => event.featured && event.at <= time && time - event.at < 2.2);
  const event = inspect === null ? automaticEvent !== undefined ? automaticEvent : [...recent].reverse().find(item => item.action === 'repost') ?? recent.at(-1)
    : [...trial.events].reverse().find(item => item.person === inspect && item.at <= time);
  const person = scene.people[inspect ?? event?.person ?? -1];
  const visible = Boolean(person && (inspect !== null || event));
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0, popupWidth: 220, popupHeight: 140 });
  useLayoutEffect(() => {
    const popup = ref.current, stage = popup?.parentElement;
    if (!popup || !stage || !visible) return;
    const measure = () => {
      const next = { width: stage.clientWidth, height: stage.clientHeight, popupWidth: popup.offsetWidth, popupHeight: popup.offsetHeight };
      setBounds(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(stage); observer.observe(popup);
    return () => observer.disconnect();
  }, [visible, person?.id, event?.id, inspect]);
  const anchor = person ? project(person, angle) : { x: 280, y: 230 };
  const x = anchor.x / 560 * bounds.width, y = anchor.y / 490 * bounds.height;
  const clamp = (value: number, max: number) => Math.max(18, Math.min(max - 18, value));
  const left = clamp(x - bounds.popupWidth / 2, bounds.width - bounds.popupWidth);
  const above = y - bounds.popupHeight - 18;
  const top = clamp(above >= 18 ? above : y + 18, bounds.height - bounds.popupHeight);
  const group = person ? scene.communities[person.group] : null;
  return <AnimatePresence>{visible && person && group && <motion.div key={inspect === null ? event?.id : `inspect-${person.id}`}
    ref={ref} className="spread-popup" data-action={event?.action ?? 'profile'} data-user-id={person.userId}
    initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: reduced ? 0 : .1 }}
    style={{ left, top }}>
    <ProfilePhoto key={person.userId} person={person} /><div className="spread-popup-copy"><strong>{person.name || person.handle}</strong>
      <a href={person.profileUrl} target="_blank" rel="noreferrer">@{person.handle}</a>
      <span className="spread-popup-action">{event?.action === 'repost' ? <Repeat2 size={12} /> : event ? <Heart size={12} /> : null}{event?.action === 'repost' ? 'Reposted' : event ? 'Liked' : 'Audience profile'}<small>· preview</small></span>
      <span className="spread-popup-niche">{group.label}{event?.target !== undefined && <> → {scene.communities[event.target].label}</>}</span>
    </div>
  </motion.div>}</AnimatePresence>;
}
