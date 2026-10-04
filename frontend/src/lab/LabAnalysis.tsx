import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LabExperiment } from './labData';
import { LabAudienceSpread } from './LabAudienceSpread';
import { LabTimeline } from './LabTimeline';

export function LabAnalysis({ experiment, onClose }: { experiment: LabExperiment; tickA?: number; tickB?: number; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video[controls], [tabindex="0"]') ?? [])];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="lab-analysis-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={ref} className="lab-analysis lab-analysis-with-audience" role="dialog" aria-modal="true" aria-labelledby="lab-analysis-title"><header><div><span className="lab-analysis-eyebrow">A / B</span><h2 id="lab-analysis-title">Analysis</h2></div><button className="lab-icon" aria-label="Close analysis" onClick={onClose}><X size={17} /></button></header>
    <LabAudienceSpread key={experiment.id} experiment={experiment} />
    <LabTimeline a={experiment.a} b={experiment.b} />
  </section></div>;
}
