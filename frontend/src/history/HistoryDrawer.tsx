import { ArrowUpRight, Check, History, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ThinkingOrb } from 'thinking-orbs';
import { listHistory, type HistoryEntry, type HistoryKind } from './historyData';
import './history.css';

export function HistoryDrawer({ kind, activeId, onClose, onSelect }: { kind: HistoryKind; activeId?: string | null; onClose: () => void; onSelect: (entry: HistoryEntry) => void }) {
  const [tab, setTab] = useState(kind);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const triggerLabel = previous?.getAttribute('aria-label');
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard, true);
      // A live map can replace its loading header while this drawer is open.
      const trigger = previous?.isConnected ? previous : [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button => triggerLabel && button.getAttribute('aria-label') === triggerLabel);
      trigger?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer = 0; setEntries(null); setError('');
    const poll = async () => {
      try { const rows = await listHistory(tab, controller.signal); if (!controller.signal.aborted) { setEntries(rows); timer = window.setTimeout(poll, 5000); } }
      catch (cause: unknown) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load history.'); }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [tab, attempt]);
  const visible = entries?.filter(entry => `${entry.brand} ${entry.title}`.toLowerCase().includes(query.toLowerCase()));
  return createPortal(<div className="history-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header><div><span className="history-kicker">YOUR WORKSPACE</span><h2 id="history-title"><History size={20} /> History</h2></div><button className="history-close" aria-label="Close history" onClick={onClose}><X size={18} /></button></header>
      <div className="history-tabs" role="tablist" aria-label="History section">{(['audience', 'lab'] as const).map(section => <button key={section} role="tab" aria-selected={tab === section} onClick={() => { setTab(section); setQuery(''); }}>{section === 'audience' ? 'Audience maps' : 'Lab experiments'}</button>)}</div>
      <label className="history-search"><Search size={15} /><input aria-label="Search history" placeholder="Search by brand or title" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="history-content" role="tabpanel" aria-label={tab === 'audience' ? 'Audience maps' : 'Lab experiments'}>
        {error ? <div className="history-state" role="alert"><p>Couldn’t load history.</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
          : !visible ? <div className="history-state" role="status"><ThinkingOrb state="breathing" size={64} /><span>Loading history</span></div>
          : !visible.length ? <div className="history-state"><History size={26} /><p>{query ? 'No matching history.' : tab === 'audience' ? 'No saved audience maps yet.' : 'No experiments yet.'}</p></div>
          : visible.map((entry, index) => {
            const date = new Date(entry.createdAt / 1000), day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const previousDay = index ? new Date(visible[index - 1].createdAt / 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            const active = tab === kind && activeId === entry.id;
            return <div key={entry.id}>{day !== previousDay && <h3 className="history-date">{day}</h3>}<button className="history-entry" aria-current={active ? 'true' : undefined} onClick={() => onSelect(entry)}>
              <span className={`history-symbol history-${entry.status}`}>{active ? <Check size={17} /> : tab === 'lab' && entry.winner ? entry.winner === 'tie' ? '=' : entry.winner : <History size={17} />}</span>
              <span className="history-entry-copy"><strong>{entry.title || 'Untitled experiment'}</strong><span>@{entry.brand} · {entry.detail}</span></span><ArrowUpRight size={15} />
            </button></div>;
          })}
      </div>
      <footer>{tab === 'audience' ? 'Saved versions stay available when an audience is refreshed.' : 'Drafts, results, and replies from previous experiments.'}</footer>
    </section>
  </div>, document.body);
}
