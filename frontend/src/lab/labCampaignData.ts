import { sql } from '../audience/liveAudience';
import { listCampaignFlows } from '../home/homeData';
import type { FlowRow } from '../flow/flowApi';

export type LabCampaign = FlowRow & { title: string };
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function listLabCampaigns(signal: AbortSignal): Promise<LabCampaign[]> {
  const flows = await listCampaignFlows(signal);
  return Promise.all(flows.map(async flow => {
    const rows = await sql<{ name: string }>(`SELECT name FROM campaign WHERE campaign_id = ${quote(flow.campaign_id)}`, signal);
    const importedTitle = flow.draft_a?.trim().split('\n')[0]?.slice(0, 80);
    return { ...flow, title: rows[0]?.name || importedTitle || `@${flow.brand} campaign` };
  }));
}
