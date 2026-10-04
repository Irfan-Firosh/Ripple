import { useEffect, useState } from 'react';
import { listCampaignFlows } from '../home/homeData';
import type { FlowRow } from './flowApi';
import type { ResearchSnapshot } from './researchTypes';
import { STATIC_SNAPSHOT } from '../snapshot';

export function useCampaignResearch(brand: string, campaignId: string | null) {
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [research, setResearch] = useState<ResearchSnapshot | null>(null);
  const [flowError, setFlowError] = useState('');
  const [researchError, setResearchError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let timer = 0;
    setFlows(null); setResearch(null); setFlowError(''); setResearchError('');
    async function refresh() {
      await Promise.all([
        listCampaignFlows(abort.signal).then(rows => {
          if (!abort.signal.aborted) { setFlows(rows.filter(row => row.brand === brand)); setFlowError(''); }
        }).catch(() => { if (!abort.signal.aborted) setFlowError('Could not read your campaigns.'); }),
        (async () => {
          try {
            const response = await fetch(STATIC_SNAPSHOT ? `/research-snapshot/${encodeURIComponent(brand)}.json`
              : `/api/campaign-research?${new URLSearchParams({ brand })}`, { signal: abort.signal });
            if (!response.ok) throw new Error('Research unavailable');
            const snapshot: ResearchSnapshot = await response.json();
            if (!Array.isArray(snapshot.sources) || !Array.isArray(snapshot.calls)) throw new Error('Research unavailable');
            if (!abort.signal.aborted) { setResearch(snapshot); setResearchError(''); }
          } catch { if (!abort.signal.aborted) setResearchError('Research activity is unavailable.'); }
        })(),
      ]);
      if (!abort.signal.aborted) timer = window.setTimeout(() => void refresh(), 3000);
    }
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [brand, campaignId, revision]);
  return { flows, research, flowError, researchError, retry: () => setRevision(value => value + 1) };
}
