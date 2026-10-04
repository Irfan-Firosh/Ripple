import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { LabExperimentSummary } from './labData';

interface LabDockProps {
  experiments: LabExperimentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCampaigns: () => void;
  campaignAction: 'Select campaign' | 'Create new campaign';
  loadingCampaigns: boolean;
}

const BADGE = { A: 'A', B: 'B', tie: '=', '': '' } as const;

// Saved experiments, newest first. Arrow keys move focus; Enter opens one.
export function LabDock({ experiments, activeId, onSelect, onCampaigns, campaignAction, loadingCampaigns }: LabDockProps) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeId]);
  const move = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const tiles = [...(nav.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    tiles[Math.max(0, Math.min(tiles.length - 1, at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    e.preventDefault();
  };
  return <nav ref={nav} className="lab-history" aria-label="Experiments" onKeyDown={move}>
    <div className="lab-history-heading"><h2>History</h2><span>{experiments.length}</span></div>
    <button className="lab-history-new" aria-label={campaignAction} aria-haspopup={campaignAction === 'Select campaign' ? 'dialog' : undefined} disabled={loadingCampaigns} onClick={onCampaigns}>{campaignAction === 'Select campaign' ? <ChevronDown size={15} /> : <Plus size={15} />}{campaignAction}</button>
    <div className="lab-history-list">{experiments.map(x => <button key={x.id} className={`lab-history-tile lab-dock-${x.status}`} aria-current={x.id === activeId ? 'true' : undefined}
      title={`${x.title} · ${new Date(x.createdAt / 1000).toLocaleString()}`} onClick={() => onSelect(x.id)}>
      <i className="lab-dock-dot" aria-hidden="true" />
      <span className="lab-history-copy"><span className="lab-dock-title">{x.title}</span><time>{new Date(x.createdAt / 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></span>
      {x.status === 'done' && x.winner && <span className={`lab-dock-badge lab-draft-${x.winner}`}>{BADGE[x.winner]}</span>}
    </button>)}{!experiments.length && <p>No saved tests yet.</p>}</div>
  </nav>;
}
