import { ArrowRight, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listLabCampaigns, type LabCampaign } from './labCampaignData';
import './lab-campaigns.css';

export function useLabCampaigns() {
  const [campaigns, setCampaigns] = useState<LabCampaign[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let timer = 0;
    const poll = async () => {
      try {
        const rows = await listLabCampaigns(abort.signal);
        if (!abort.signal.aborted) { setCampaigns(rows); setError(''); timer = window.setTimeout(() => void poll(), 5000); }
      } catch (cause: unknown) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load campaigns.');
      }
    };
    void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [attempt]);
  return { campaigns, error, retry: () => setAttempt(n => n + 1) };
}

const stageLabel = { concepts: 'Drafts in progress', testing: 'In the Lab', approved: 'Approved', shipped: 'Posted' } as const;
export function LabCampaignPicker({ campaigns, error, createHref, onRetry, onClose, onSelect }: {
  campaigns: LabCampaign[] | null; error: string; createHref: string; onRetry: () => void; onClose: () => void; onSelect: (campaign: LabCampaign) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const targets = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])];
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [onClose]);
  return <div className="lab-campaign-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="lab-campaign-picker" role="dialog" aria-modal="true" aria-labelledby="lab-campaign-title">
      <header><h2 id="lab-campaign-title">Select campaign</h2><button className="lab-icon" aria-label="Close campaign selector" onClick={onClose}><X size={16} /></button></header>
      {error ? <div className="lab-campaign-state" role="alert"><p>Couldn’t load campaigns.</p><button className="lab-secondary" onClick={onRetry}>Try again</button></div>
        : campaigns === null ? <p className="lab-campaign-state" role="status">Loading campaigns…</p>
        : !campaigns.length ? <p className="lab-campaign-state">No campaigns yet.</p>
        : <div className="lab-campaign-list">{campaigns.map(campaign => <button key={campaign.campaign_id} onClick={() => onSelect(campaign)}>
          <span><strong>{campaign.title}</strong><small>@{campaign.brand} · {stageLabel[campaign.stage]}</small></span><ArrowRight size={16} />
        </button>)}</div>}
      <a className="lab-campaign-create" href={createHref}><Plus size={15} />Create new campaign<ArrowRight size={15} /></a>
    </section>
  </div>;
}
