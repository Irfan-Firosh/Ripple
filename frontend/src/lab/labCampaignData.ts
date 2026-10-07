import { sql } from '../audience/liveAudience';
import { listCampaignFlows } from '../home/homeData';
import type { FlowRow } from '../flow/flowApi';
import { DEMO_BRAND } from '../snapshot';
import { campaignReplayOn } from '../flow/flowApi';

export type LabCampaign = FlowRow & { title: string };
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function listLabCampaigns(signal: AbortSignal): Promise<LabCampaign[]> {
  const [all, demo] = await Promise.all([listCampaignFlows(signal), campaignReplayOn()]);
  const brandFlows = all.filter(flow => flow.brand === DEMO_BRAND); // the demo shows one brand
  const flows = demo ? brandFlows.slice(0, 1) : brandFlows; // demo: only the newest campaign
  return Promise.all(flows.map(async flow => {
    const rows = await sql<{ name: string }>(`SELECT name FROM campaign WHERE campaign_id = ${quote(flow.campaign_id)}`, signal);
    const importedTitle = flow.draft_a?.trim().split('\n')[0]?.slice(0, 80);
    return { ...flow, title: rows[0]?.name || importedTitle || `@${flow.brand} campaign` };
  }));
}
