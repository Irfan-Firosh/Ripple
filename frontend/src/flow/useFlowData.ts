import { useEffect, useState } from 'react';
import { campaignVideo, draftCopies, draftVideos, experimentRow, flowRow, type DraftCopies, type DraftVideos, type ExperimentRow, type FlowRow, type VideoRow } from './flowApi';

const POLL_MS = 3000;
export type FlowData = { flow: FlowRow | null; video: VideoRow | null; drafts: DraftVideos; copies: DraftCopies; experiment: ExperimentRow | null; error: string; loaded: boolean };
const NONE: DraftVideos = { A: null, B: null };
const NO_COPY: DraftCopies = { A: null, B: null };

/** Live view of one campaign's flow row, its video and its Lab experiment (polled; all three change server-side). */
export function useFlowData(campaignId: string | null, revision: number): FlowData {
  const [data, setData] = useState<FlowData>({ flow: null, video: null, drafts: NONE, copies: NO_COPY, experiment: null, error: '', loaded: false });
  useEffect(() => {
    if (!campaignId) { setData({ flow: null, video: null, drafts: NONE, copies: NO_COPY, experiment: null, error: '', loaded: true }); return; }
    const abort = new AbortController();
    let timer = 0;
    const tick = async () => {
      try {
        const flow = await flowRow(campaignId, abort.signal);
        const [video, drafts, copies, experiment] = await Promise.all([
          campaignVideo(campaignId, abort.signal), draftVideos(campaignId, abort.signal), draftCopies(campaignId, abort.signal),
          experimentRow(Number(flow?.experiment_id ?? 0), abort.signal)]);
        if (!abort.signal.aborted) setData({ flow, video, drafts, copies, experiment, error: '', loaded: true });
      } catch (cause: unknown) {
        if (!abort.signal.aborted) setData(prev => ({ ...prev, loaded: true, error: cause instanceof Error ? cause.message : 'Could not read this campaign.' }));
      }
      if (!abort.signal.aborted) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [campaignId, revision]);
  return data;
}
