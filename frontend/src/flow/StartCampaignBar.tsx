import { ArrowRight, Import, Sparkles } from 'lucide-react';
import './start-bar.css';

/** Shown on the finished audience map: the next step is always a campaign (Generate or Import). */
export function StartCampaignBar() {
  if (location.pathname.replace(/\/$/, '') !== '/dashboard') return null;
  const brand = new URLSearchParams(location.search).get('brand') || 'raycast';
  const href = (start: string) => `/campaign?${new URLSearchParams({ brand, start })}`;
  return <nav className="start-bar" aria-label="Start a campaign">
    <span>Audience ready. <b>Start a campaign</b><ArrowRight size={14} /></span>
    <a className="start-bar-generate" href={href('generate')}><Sparkles size={15} />Generate</a>
    <a className="start-bar-import" href={href('import')}><Import size={15} />Import</a>
  </nav>;
}
