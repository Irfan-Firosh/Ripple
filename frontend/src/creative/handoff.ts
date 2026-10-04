import type { CreativeHandoff } from './model';

const PREFIX = 'ripple-campaign-handoff:';
export type CampaignDrafts = CreativeHandoff & { savedAt: number };

export function saveCampaignDrafts(handoff: CreativeHandoff): string {
  if (handoff.variants.length !== 2) throw new Error('Choose two concepts to compare.');
  const id = crypto.randomUUID();
  // BigInt costs are metadata; this transfer never contains credentials.
  sessionStorage.setItem(PREFIX + id, JSON.stringify({ ...handoff, savedAt: Date.now() },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  return id;
}

export function loadCampaignDrafts(id: string | null): CampaignDrafts | null {
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.campaign || !Array.isArray(data.variants) || data.variants.length !== 2
      || !Number.isFinite(data.savedAt) || Date.now() - data.savedAt > 3_600_000) return null;
    if (data.variants.some((v: { headline?: unknown; cta?: unknown }) =>
      typeof v.headline !== 'string' || typeof v.cta !== 'string')) return null;
    return data as CampaignDrafts;
  } catch { return null; }
}

