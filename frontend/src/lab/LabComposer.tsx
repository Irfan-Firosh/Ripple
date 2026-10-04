import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listActiveBrands, type ActiveBrand } from '../history/historyData';
import { requestExperiment } from './labData';

const MAX = 1000;
const MAX_TITLE = 80;

interface LabComposerProps {
  brand: string;
  onClose: () => void;
  onQueued: (brand: string) => void;
}

export function LabComposer({ brand: initialBrand, onClose, onQueued }: LabComposerProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [brands, setBrands] = useState<ActiveBrand[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    listActiveBrands(controller.signal).then(setBrands).catch(() => {});
    return () => controller.abort();
  }, []);
  const [title, setTitle] = useState('');
  const [draftA, setDraftA] = useState('');
  const [draftB, setDraftB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusables = [...dialog.current.querySelectorAll<HTMLElement>('button, select, input, textarea')].filter(el => !el.hasAttribute('disabled'));
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { last?.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first?.focus(); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const problem = (d: string) => (!d.trim() ? 'required' : d.length > MAX ? `at most ${MAX} characters` : null);
  const invalid = problem(draftA) || problem(draftB) || title.length > MAX_TITLE;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || busy) return;
    setBusy(true); setError(null);
    try {
      await requestExperiment({ brand, title: title.trim(), draftA, draftB });
      onQueued(brand);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The experiment could not be queued.');
    } finally { setBusy(false); }
  };
  const field = (label: 'Draft A' | 'Draft B', value: string, set: (v: string) => void) => {
    const issue = value ? problem(value) : null;
    return <label className="lab-field"><span className="lab-field-label">{label}<em className={value.length > MAX ? 'lab-over' : ''}>{value.length}/{MAX}</em></span>
      <textarea aria-label={label} rows={4} value={value} onChange={e => set(e.target.value)} placeholder="What's happening?" />
      {issue && issue !== 'required' && <span className="lab-field-error">Drafts can be {issue}.</span>}
    </label>;
  };
  return <div className="lab-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} className="lab-dialog" role="dialog" aria-modal="true" aria-label="New experiment">
      <header><h2>New experiment</h2><button className="lab-icon" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
      <form onSubmit={submit}>
        <label className="lab-field"><span className="lab-field-label">Audience</span>
          <select value={brand} onChange={e => setBrand(e.target.value)}>{!BRANDS.some(b => b.handle === initialBrand) && <option value={initialBrand}>@{initialBrand}</option>}{BRANDS.map(b => <option key={b.handle} value={b.handle}>{b.label}</option>)}</select>
        </label>
        <label className="lab-field"><span className="lab-field-label">Title <em>optional</em></span>
          <input value={title} maxLength={MAX_TITLE} onChange={e => setTitle(e.target.value)} placeholder="e.g. Windows launch" />
        </label>
        {field('Draft A', draftA, setDraftA)}
        {field('Draft B', draftB, setDraftB)}
        {error && <p className="lab-field-error" role="alert">{error}</p>}
        <button className="lab-primary" type="submit" disabled={Boolean(invalid) || busy}>{busy ? 'Queuing…' : 'Run in Lab'}</button>
        <p className="lab-hint">Every follower sees both drafts; reposts carry them further. Results stream in live.</p>
      </form>
    </div>
  </div>;
}
