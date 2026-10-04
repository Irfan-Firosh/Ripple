// Static deploys (Vercel) read a recorded snapshot instead of the live database.
// VITE_SNAPSHOT=1     every SQL read is answered from /snapshot.json; writes are refused.
// VITE_SNAPSHOT_RECORD=1 (dev only) live reads are scoped to the showcase brand and saved through the dev server.
export const STATIC_SNAPSHOT = import.meta.env.VITE_SNAPSHOT === '1';
const RECORDING = import.meta.env.DEV && import.meta.env.VITE_SNAPSHOT_RECORD === '1';

// What the static site shows: one brand, its latest Lab and its latest campaign.
const SHOWCASE = {
  brand: 'trycua',
  brandUserId: '1883205292596359168',
  experimentId: 32,
  campaignId: '26654684-3c5e-4a79-b751-f2a4258c91ff',
};

// Pages opened without ?brand= show this brand.
export const DEFAULT_BRAND = STATIC_SNAPSHOT ? SHOWCASE.brand : 'raycast';

type Row = Record<string, unknown>;
// "My campaigns" reads are keyed by the browser's identity; the snapshot answers every viewer with the showcase.
const VIEWER = /requested_by\s*=\s*0x[0-9a-f]+/i;
const key = (query: string) => query.replace(VIEWER, 'requested_by = :viewer').replace(/\s+/g, ' ').trim();
// A placeholder identity for pages that need one before reading (the static site has no accounts).
export const SNAPSHOT_VIEWER = '0'.repeat(64);

// While recording, a viewer-scoped read fetches every row; scope() then keeps the showcase brand's.
export const liveQuery = (query: string) => (RECORDING ? query.replace(/\s+WHERE\s+requested_by\s*=\s*0x[0-9a-f]+/i, '') : query);

let recorded: Promise<Record<string, Row[]>> | null = null;

export async function snapshotRows<T>(query: string): Promise<T[]> {
  recorded ??= fetch('/snapshot.json').then(res => (res.ok ? res.json() : {})).catch(() => ({}));
  const rows = (await recorded)[key(query)];
  if (!rows && import.meta.env.DEV) console.warn('[snapshot] not recorded:', key(query));
  return (rows ?? []) as T[];
}

// A lookup of one row by its id stays whole (a campaign links its own Lab run); lists keep only the showcase.
function scope(query: string, rows: Row[]): Row[] {
  if (/FROM\s+ops_hidden/i.test(query)) return []; // /ops Hide is a live-demo switch; the snapshot shows the showcase
  if (/WHERE\s+(video_id|campaign_id|experiment_id|snapshot_id|onboarding_id|run_id)\s*=/i.test(query)) return rows;
  const table = query.match(/FROM\s+(\w+)/i)?.[1]?.toLowerCase() ?? '';
  return rows.filter(row => {
    if (table === 'lab_experiment') return Number(row.experiment_id) === SHOWCASE.experimentId;
    if (table === 'campaign_flow') return row.campaign_id === SHOWCASE.campaignId;
    if (table === 'onboarding') return String(row.handle ?? '').replace(/^@/, '').toLowerCase() === SHOWCASE.brand;
    if (typeof row.brand === 'string' && row.brand) return row.brand.replace(/^@/, '').toLowerCase() === SHOWCASE.brand;
    if (typeof row.brand_user_id === 'string' && row.brand_user_id) return row.brand_user_id === SHOWCASE.brandUserId;
    return true;
  });
}

export function recordRows<T>(query: string, rows: T[]): T[] {
  if (!RECORDING) return rows;
  const kept = scope(query, rows as Row[]);
  void fetch('/__snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: key(query), rows: kept }) }).catch(() => undefined);
  return kept as T[];
}

export function assertLive(): void {
  if (STATIC_SNAPSHOT) throw new Error('This is a read-only demo of Ripple. Run it locally to launch new campaigns.');
}
