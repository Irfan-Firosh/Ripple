import { useEffect, useRef, useState } from 'react';
import { sql } from '../audience/liveAudience';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { OnboardingAvatar } from './OnboardingAvatar';
import { stages, type BuildSnapshot, type OnboardingRow } from './onboardingData';

const DEFAULT_TWINS = 60; // used until the /ops twins-per-brand setting loads

// One number for the whole build: scraping 5-45%, analyzing 45-90%, map 90-99%, ready 100%.
function buildProgress(snapshot: BuildSnapshot | null, row: OnboardingRow, twins: number): number {
  const share = (n: number, of: number) => Math.min(1, n / Math.max(1, of));
  switch (row.status) {
    case 'ready': return 1;
    case 'graph': return 0.93;
    case 'twins': return 0.45 + 0.45 * share(snapshot?.ready ?? 0, Math.min(twins, snapshot?.followers || twins));
    case 'scraping': return 0.05 + 0.4 * share(snapshot?.followers ?? 0, snapshot?.requested ?? 0);
    default: return 0.02;
  }
}

export function BuildView({ snapshot, row, theme, onRetry }: { snapshot: BuildSnapshot | null; row: OnboardingRow; theme: 'dark' | 'light'; onRetry: () => void }) {
  const reduced = useReducedMotion();
  const completed = stages(snapshot, row);
  const loading = !['ready', 'failed'].includes(row.status);
  const active = row.status === 'graph' ? 2 : row.status === 'twins' ? 1 : 0;
  const [twins, setTwins] = useState(DEFAULT_TWINS);
  useEffect(() => {
    void sql<{ twins_per_brand: number }>("SELECT * FROM sim_settings WHERE key = 'global'")
      .then(rows => { if (rows[0]?.twins_per_brand) setTwins(rows[0].twins_per_brand); }).catch(() => undefined);
  }, []);
  const best = useRef(0); // never moves backwards between polls
  best.current = row.status === 'failed' ? best.current : Math.max(best.current, buildProgress(snapshot, row, twins));
  const percent = Math.round(best.current * 100);
  return <div className="on-build">
    <div className="on-build-agent"><OnboardingAvatar size={64} theme={theme} working={loading} /></div>
    <ul className="on-stages" aria-label="Build stages">
      {['Followers', 'Analyzing your audience', 'Audience map'].map((label, index) => <li key={label} data-complete={completed[index]} aria-busy={loading && index === active}>
        <span className="on-stage-dot" aria-label={completed[index] ? 'Complete' : loading && index === active ? 'In progress' : 'Waiting'} /><span>{label}</span>
        <span className="on-stage-loading">{loading && index === active && <ThinkingOrb state="breathing" size={32} theme={theme} paused={Boolean(reduced)} aria-label="Building your audience" />}</span>
      </li>)}
    </ul>
    <div className="on-build-progress" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-done={row.status === 'ready'} data-failed={row.status === 'failed'}>
      <span className="on-progress-track"><i style={{ width: `${percent}%` }} /></span><b>{row.status === 'ready' ? 'Done' : `${percent}%`}</b>
    </div>
    <div className="on-avatars" aria-label="Discovered followers">{snapshot?.avatars.map(profile => <motion.img key={profile.user_id} src={profile.profile_image_url ?? ''} alt={`@${profile.username}`} referrerPolicy="no-referrer" width={28} height={28}
      initial={reduced ? false : { opacity: 0, scale: .7, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .25 }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />)}</div>
    {row.status === 'failed' ? <><p className="on-error" role="alert">{row.error || 'Build failed.'}</p><button className="on-primary" type="button" onClick={onRetry}>Try again <ArrowRight size={14} /></button></>
      : <button className="on-primary" type="button" disabled={row.status !== 'ready'} onClick={() => location.assign(`/dashboard?brand=${encodeURIComponent(row.handle)}`)}>See your audience <ArrowRight size={14} /></button>}
  </div>;
}
