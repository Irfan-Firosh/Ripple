import { useCallback, useEffect, useRef, useState } from 'react';
import type { LabRun } from './labData';

export const REPLAY_STEP_MS = 700; // same pace as the cascade_tick reducer

// The tick a tweet shows. While the cascade is replaying on the server, follow the server's tick; a run that already
// finished shows its final state; `restart` replays it from tick 0 on request.
export function useReplayTick(run: LabRun | null): { tick: number; live: boolean; finished: boolean; restart: () => void } {
  const [tick, setTick] = useState(0);
  const [restarts, setRestarts] = useState(0);
  const watchedLive = useRef(false);
  const status = run?.status;
  const maxTick = run?.replayMaxTick ?? 0;
  const serverTick = run?.replayTick ?? 0;
  useEffect(() => {
    if (!run || status === 'scoring' || status === 'failed') { setTick(0); return; }
    if (status === 'replaying') { watchedLive.current = true; setTick(serverTick); return; }
    if (restarts === 0) { setTick(maxTick); return; } // finished results show final, at once; replay only on request
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setTick(maxTick); return; }
    setTick(0);
    const timer = window.setInterval(() => setTick(t => (t >= maxTick ? t : t + 1)), REPLAY_STEP_MS);
    return () => clearInterval(timer);
  }, [run?.runId, status, serverTick, maxTick, restarts]); // eslint-disable-line react-hooks/exhaustive-deps
  const restart = useCallback(() => { watchedLive.current = false; setRestarts(n => n + 1); }, []);
  return { tick, live: status === 'replaying', finished: status === 'done' && tick >= maxTick, restart };
}
