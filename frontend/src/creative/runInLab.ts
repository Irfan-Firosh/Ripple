import { sql } from '../audience/liveAudience';
import { requestExperiment } from '../lab/labData';
type ExperimentRow = { experiment_id: string | number; title: string; draft_a: string; draft_b: string };

// Use main's existing reducer and simulator. No new simulation model or tables.
export async function runInLab(input: { brand: string; title: string; draftA: string; draftB: string }): Promise<string> {
  if ([input.draftA, input.draftB].some(d => !d.trim() || d.length > 1000)) throw new Error('Each draft needs 1–1000 characters.');
  if (input.title.length > 80) throw new Error('Keep the comparison title under 80 characters.');
  const query = "SELECT experiment_id, title, draft_a, draft_b FROM lab_experiment WHERE brand = '"
    + input.brand.replaceAll("'", "''") + "'";
  const before = new Set((await sql<ExperimentRow>(query)).map(r => String(r.experiment_id)));
  await requestExperiment(input);
  for (let attempt = 0; attempt < 5; attempt++) {
    // Once accepted, a failed read must not invite a duplicate submission.
    let rows: ExperimentRow[];
    try { rows = await sql<ExperimentRow>(query); } catch { break; }
    const created = rows.filter(r => !before.has(String(r.experiment_id))
      && r.draft_a === input.draftA && r.draft_b === input.draftB
      && r.title === (input.title.trim() || input.draftA.trim().slice(0, 60)));
    if (created.length) {
      created.sort((a, b) => Number(b.experiment_id) - Number(a.experiment_id));
      return '/lab?' + new URLSearchParams({ brand: input.brand, exp: String(created[0].experiment_id) });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  // The request was accepted; main automatically opens the latest experiment.
  return '/lab?' + new URLSearchParams({ brand: input.brand });
}
