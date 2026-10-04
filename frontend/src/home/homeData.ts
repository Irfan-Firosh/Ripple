import { DbConnection } from '../module_bindings';
import { sql } from '../audience/liveAudience';
import { CREATIVE_TOKEN_KEY, type FlowRow } from '../flow/flowApi';
import { onboardingToken, type OnboardingRow } from '../onboarding/onboardingData';

export type HomeCampaign = OnboardingRow & { created_at: number | string };
const owners = new Map<string, Promise<string>>();

// Use the existing onboarding database identity, rather than other users' public builds.
function sessionOwner(token: string): Promise<string> {
  const cached = owners.get(token);
  if (cached) return cached;
  const promise = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => { connection.disconnect(); reject(new Error('Could not connect. Try again.')); }, 12000);
    const connection = DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName('ripple-mhacks').withToken(token)
      .onConnect((context, identity) => { clearTimeout(timer); resolve(identity.toHexString()); context.disconnect(); })
      .onConnectError((context, error) => { clearTimeout(timer); context.disconnect(); reject(error); }).build();
  }).then(identity => {
    if (!/^[a-f\d]{64}$/i.test(identity)) throw new Error('Could not identify your workspace. Try again.');
    return identity;
  }).catch(error => { owners.delete(token); throw error; });
  owners.set(token, promise);
  return promise;
}

export async function listHomeCampaigns(signal: AbortSignal): Promise<HomeCampaign[]> {
  const identity = await sessionOwner(await onboardingToken());
  if (!/^[a-f\d]{64}$/i.test(identity)) throw new Error('Could not identify your workspace. Try again.');
  const rows = await sql<HomeCampaign>(`SELECT * FROM onboarding WHERE requested_by = 0x${identity}`, signal);
  return rows.sort((a, b) => Number(b.onboarding_id) - Number(a.onboarding_id));
}

export function campaignDestination(row: HomeCampaign): string {
  return row.status === 'ready' ? `/dashboard?brand=${encodeURIComponent(row.handle)}`
    : `/onboarding?flow=campaign&build=${row.onboarding_id}`;
}
export function campaignDate(row: Pick<HomeCampaign, 'created_at'>): string {
  const timestamp = Number(row.created_at) / 1000;
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export type AudienceStat = { handle: string; profiles: number; analyzed: number };
export type HomeStats = { audiences: AudienceStat[]; profiles: number; analyzed: number };
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function loadHomeStats(campaigns: HomeCampaign[], signal: AbortSignal): Promise<HomeStats> {
  const brands = new Map<string, string>();
  for (const row of campaigns) if (row.brand_user_id && !brands.has(row.brand_user_id)) brands.set(row.brand_user_id, row.handle);
  const profiles = new Set<string>(), analyzed = new Set<string>();
  const audiences = await Promise.all([...brands].map(async ([id, handle]) => {
    const [members, ready] = await Promise.all([
      sql<{ follower_user_id: string }>(`SELECT follower_user_id FROM audience_membership WHERE brand_user_id = ${quote(id)}`, signal),
      sql<{ user_id: string }>(`SELECT user_id FROM twin_audience WHERE brand_user_id = ${quote(id)}`, signal),
    ]);
    const found = new Set(members.map(row => row.follower_user_id));
    const complete = new Set(ready.map(row => row.user_id).filter(id => found.has(id)));
    found.forEach(id => profiles.add(id)); complete.forEach(id => analyzed.add(id));
    return { handle, profiles: found.size, analyzed: complete.size };
  }));
  return { audiences: audiences.filter(row => row.profiles > 0), profiles: profiles.size, analyzed: analyzed.size };
}

export async function listCampaignFlows(signal: AbortSignal): Promise<FlowRow[]> {
  let token: string | null = null;
  try { token = localStorage.getItem(CREATIVE_TOKEN_KEY); } catch { /* Optional storage. */ }
  if (!token) return [];
  const identity = await sessionOwner(token);
  return (await sql<FlowRow>(`SELECT * FROM campaign_flow WHERE requested_by = 0x${identity}`, signal))
    .sort((a, b) => Number(b.created_at) - Number(a.created_at));
}
