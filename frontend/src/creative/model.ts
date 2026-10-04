export const BRANDS = [
  { id: 'did:plc:w2wcqqbevx536r4vau7f2pae', handle: 'raycast.com', name: 'Raycast' },
  { id: '1532160930284417024', handle: 'spacetimedb', name: 'SpacetimeDB' },
] as const;
export const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export type Theme = { text: string; support: number; twinIds: string[]; evidenceCount?: number };
export type Brief = {
  briefId: string; campaignId: string; segment: string; version: number;
  audienceLabel: string; share: number; twinCount: number; keyInterests: Theme[]; avoid: Theme[];
  tone: string; messageAngle: string; valueProps: string[]; headlineOptions: string[]; cta: string;
  visualCues: string[]; visualAvoid: string[]; format: string; editedByUser: boolean; model: string;
};
export type Variant = {
  variantId: string; campaignId: string; briefId: string; parentVariantId?: string; rootVariantId: string;
  depth: number; operation: string; instruction?: string; imagePrompt: string; headline: string; cta: string;
  aspectRatio: string; status: string; imageUrl?: string; costUsdTicks: bigint; error?: string;
  starred: boolean; approved: boolean; model: string; quality: string;
};
export type Campaign = {
  campaignId: string; brandUserId: string; name: string; goal: string; offer?: string; channel: string;
  aspectRatio: string; segments: string[]; variantsPerBrief: number; status: string;
  createdBy: { toHexString(): string };
};
export type Job = { jobId: bigint; campaignId: string; kind: string; targetId: string; status: string; error?: string };
export type BrandKit = { brandUserId: string; displayName: string; productDescription: string; valueProps: string[]; palette: string[]; visualStyle: string; bannedClaims: string[]; referenceImageUrls: string[] };
export type Segment = { slug: string; label: string; description: string; count: number; share: number };
export type CreativeHandoff = { campaign: Campaign; variants: (Variant & { brief?: Brief; segment: string })[]; recordedRehearsal?: boolean; recordedAt?: string };

export const MIN_SEGMENT = 1; // matches MIN_SEGMENT_TWINS in the module

export function audienceSegments(
  brandId: string,
  audience: readonly { brandUserId: string; userId: string }[],
  affinities: readonly { userId: string; niche: string; affinity: number }[],
  catalog: readonly { slug: string; label: string; description: string }[],
): { total: number; segments: Segment[] } {
  const members = new Set(audience.filter(row => row.brandUserId === brandId).map(row => row.userId));
  const main = new Map<string, { niche: string; affinity: number }>();
  for (const row of affinities) {
    if (!members.has(row.userId)) continue;
    const previous = main.get(row.userId);
    if (!previous || row.affinity > previous.affinity || (row.affinity === previous.affinity && row.niche < previous.niche)) main.set(row.userId, row);
  }
  const counts = new Map<string, number>();
  for (const row of main.values()) counts.set(row.niche, (counts.get(row.niche) ?? 0) + 1);
  return { total: members.size, segments: catalog
    .filter(row => !['other', 'politics_society'].includes(row.slug) && (counts.get(row.slug) ?? 0) >= MIN_SEGMENT)
    .map(row => ({ ...row, count: counts.get(row.slug)!, share: counts.get(row.slug)! / members.size }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug)) };
}
export const money = (ticks: bigint) => `$${(Number(ticks) / 10_000_000_000).toFixed(2)}`;
