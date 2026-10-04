import { BRANDS, sql, type Audience } from '../audience/liveAudience';

export type HistoryKind = 'audience' | 'lab';
export type HistoryEntry = { id: string; kind: HistoryKind; brand: string; title: string; createdAt: number; detail: string; status: string; winner?: string };
export type ActiveBrand = { handle: string; label: string; platform: 'x' | 'bluesky'; maxNiches: number; userId?: string };
type SnapshotRow = { snapshot_id: string; brand: string; title: string; people: number; niches: number; created_at: number };
type ExperimentRow = { experiment_id: number; brand: string; title: string; status: string; winner: string; created_at: number; lift: number };
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function listActiveBrands(signal: AbortSignal): Promise<ActiveBrand[]> {
  const [users, members] = await Promise.all([
    sql<{ user_id: string; username: string }>('SELECT user_id, username FROM x_user', signal),
    sql<{ brand_user_id: string }>('SELECT brand_user_id FROM audience_membership', signal),
  ]);
  const ids = new Set(members.map(r => r.brand_user_id));
  return users.filter(u => ids.has(u.user_id)).map(u => ({ userId: u.user_id,
    ...(BRANDS.find(b => b.handle === u.username) ?? { handle: u.username, label: `@${u.username}`, platform: u.username.includes('.') ? 'bluesky' as const : 'x' as const, maxNiches: u.username.includes('.') ? 7 : 6 }) }));
}

export async function listHistory(kind: HistoryKind, signal: AbortSignal): Promise<HistoryEntry[]> {
  if (kind === 'audience') {
    const rows = await sql<SnapshotRow>('SELECT snapshot_id, brand, title, people, niches, created_at FROM audience_snapshot', signal);
    return rows.filter(r => Number(r.people) > 0).map(r => ({ id: r.snapshot_id, kind, brand: r.brand, title: r.title, createdAt: Number(r.created_at), status: 'saved', detail: `${r.people} people · ${r.niches} niches` })).sort((a, b) => b.createdAt - a.createdAt);
  }
  const [rows, snapshots, active] = await Promise.all([
    sql<ExperimentRow>('SELECT experiment_id, brand, title, status, winner, lift, created_at FROM lab_experiment', signal),
    sql<{ brand: string; people: number }>('SELECT brand, people FROM audience_snapshot', signal),
    listActiveBrands(signal),
  ]);
  const populated = new Set([...snapshots.filter(r => Number(r.people) > 0).map(r => r.brand.toLowerCase()), ...active.map(r => r.handle.toLowerCase())]);
  return rows.filter(r => populated.has(r.brand.toLowerCase())).map(r => ({ id: String(r.experiment_id), kind, brand: r.brand, title: r.title, createdAt: Number(r.created_at), status: r.status, winner: r.winner,
    detail: r.status === 'done' ? r.winner === 'tie' ? 'Too close to call' : `${r.winner} wins · ${r.lift > 0 ? '+' : ''}${Math.round(r.lift * 100)}%` : r.status })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadAudienceSnapshot(id: string, signal?: AbortSignal): Promise<Audience> {
  const [row] = await sql<{ payload: string }>(`SELECT payload FROM audience_snapshot WHERE snapshot_id = ${q(id)}`, signal);
  if (!row) throw new Error('This audience version was not found.');
  const data = JSON.parse(row.payload) as Audience;
  if (!data.brand?.userId || !Array.isArray(data.members) || !Array.isArray(data.niches) || !Array.isArray(data.links)) throw new Error('This audience version could not be read.');
  return data;
}
