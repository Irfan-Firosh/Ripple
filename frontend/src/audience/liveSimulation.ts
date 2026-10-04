// Reads one simulation run (written by the Simulation agent + the cascade reducers) from SpacetimeDB.
import { sql } from './liveAudience';

export type SimNodeState = { seenTick: number | null; engagedTick: number | null; engagedShare: number };
export type SimRunState = {
  runId: string; status: string; replayTick: number; replayMaxTick: number;
  reachP10: number; reachP50: number; reachP90: number; people: number; nodes: Map<string, SimNodeState>;
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function loadSimRun(runId: string, signal?: AbortSignal): Promise<SimRunState> {
  const [runs, nodes] = await Promise.all([
    sql(`SELECT * FROM sim_run WHERE run_id = ${q(runId)}`, signal),
    sql(`SELECT * FROM sim_node WHERE run_id = ${q(runId)}`, signal),
  ]);
  const run = runs[0];
  if (!run) throw new Error(`Simulation ${runId} was not found.`);
  if (run.status === 'failed') throw new Error(`Simulation ${runId} failed: ${run.error ?? 'unknown error'}`);
  return {
    // SpacetimeDB snake-cases reachP10 as reach_p_10.
    runId, status: run.status, replayTick: run.replay_tick, replayMaxTick: run.replay_max_tick,
    reachP10: run.reach_p_10, reachP50: run.reach_p_50, reachP90: run.reach_p_90, people: run.people,
    nodes: new Map(nodes.map(n => [n.user_id as string, {
      seenTick: n.replay_seen_tick ?? null, engagedTick: n.replay_engaged_tick ?? null, engagedShare: n.engaged_share,
    }])),
  };
}
