import { listExperiments, loadExperiment, requestExperiment, type LabExperiment } from './labData';

export function mediaSource(id: string): string {
  const params = new URLSearchParams(location.search), source = params.get('source');
  if (params.get('exp') === id && source && /^\d+$/.test(source)) return source;
  try { const saved = localStorage.getItem(`ripple-lab-media-source:${id}`); if (saved && /^\d+$/.test(saved)) return saved; } catch { /* Optional persistence. */ }
  return id;
}
export async function resimulate(experiment: LabExperiment, signal: AbortSignal): Promise<string> {
  const before = new Set((await listExperiments(experiment.brand, signal)).map(row => row.id));
  await requestExperiment({ brand: experiment.brand, title: experiment.title, draftA: experiment.draftA, draftB: experiment.draftB });
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await listExperiments(experiment.brand, signal);
    for (const created of rows.filter(row => !before.has(row.id))) {
      const candidate = await loadExperiment(created.id, signal);
      if (candidate.draftA !== experiment.draftA || candidate.draftB !== experiment.draftB || candidate.brand !== experiment.brand) { before.add(created.id); continue; }
      const source = mediaSource(experiment.id);
      try { localStorage.setItem(`ripple-lab-media-source:${created.id}`, source); } catch { /* The URL also carries the media source. */ }
      return created.id;
    }
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 500);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  throw new Error('Simulation queued. Refresh to open it once it appears.');
}
