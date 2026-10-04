import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { OnboardingAvatar } from './OnboardingAvatar';
import { stages, type BuildSnapshot, type OnboardingRow } from './onboardingData';

export function BuildView({ snapshot, row, theme, onRetry }: { snapshot: BuildSnapshot | null; row: OnboardingRow; theme: 'dark' | 'light'; onRetry: () => void }) {
  const reduced = useReducedMotion();
  const completed = stages(snapshot, row);
  const loading = !['ready', 'failed'].includes(row.status);
  const active = row.status === 'graph' ? 2 : row.status === 'twins' ? 1 : 0;
  return <div className="on-build">
    <div className="on-build-agent"><OnboardingAvatar size={96} theme={theme} working={loading} /></div>
    <ul className="on-stages" aria-label="Build stages">
      {['Followers', 'Twins', 'Audience map'].map((label, index) => <li key={label} data-complete={completed[index]} aria-busy={loading && index === active}>
        <span className="on-stage-dot" aria-label={completed[index] ? 'Complete' : loading && index === active ? 'In progress' : 'Waiting'} /><span>{label}</span>
        <span className="on-stage-loading">{loading && index === active && <ThinkingOrb state="breathing" size={32} theme={theme} paused={Boolean(reduced)} aria-label="Building your audience" />}</span>
      </li>)}
    </ul>
    <div className="on-avatars" aria-label="Discovered followers">{snapshot?.avatars.map(profile => <motion.img key={profile.user_id} src={profile.profile_image_url ?? ''} alt={`@${profile.username}`} referrerPolicy="no-referrer" width={28} height={28}
      initial={reduced ? false : { opacity: 0, scale: .7, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .25 }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />)}</div>
    {row.status === 'failed' ? <><p className="on-error" role="alert">{row.error || 'Build failed.'}</p><button className="on-primary" type="button" onClick={onRetry}>Try again <ArrowRight size={14} /></button></>
      : <button className="on-primary" type="button" disabled={row.status !== 'ready'} onClick={() => location.assign(`/dashboard?brand=${encodeURIComponent(row.handle)}`)}>See your audience <ArrowRight size={14} /></button>}
  </div>;
}
