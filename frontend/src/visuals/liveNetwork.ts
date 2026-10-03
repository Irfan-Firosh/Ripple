// Turns the audience read from SpacetimeDB into a renderable 3D cascade: every scraped person is a node
// (no cap), grouped by their primary niche, with the brand's post at the centre.
import type { Audience, AudienceMember } from '../audience/liveAudience';

export type Vec3 = [number, number, number];
export type CascadeNode = {
  id: number; name: string; handle: string; avatar: string; initials: string;
  community: number; position: Vec3; member: AudienceMember;
};
export type CascadeCommunity = { slug: string; name: string; color: string; center: Vec3; size: number };
export type CascadeEdge = { a: number; b: number; bridge: boolean; delay: number };
export type Arrival = { id: number; at: number; from: number | null };
export type CascadeNetwork = {
  sourceId: number;
  source: { name: string; handle: string; avatar: string };
  nodes: CascadeNode[];
  communities: CascadeCommunity[];
  edges: CascadeEdge[];
  arrivals: Arrival[];
  arrivalById: Map<number, Arrival>;
  duration: number;
  nodeRadius: number;
  extent: number;
};

const GOLDEN = 2.399963;
export const MAX_NICHE_GROUPS = 10;
const OTHER = 'other';
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// Ring slot for each niche (largest first): stepping by a stride coprime with the count spreads the
// big niches around the ring instead of packing them side by side.
function ringSlots(count: number): number[] {
  if (count < 3) return [...Array(count).keys()];
  let step = Math.max(1, Math.round(count * 0.38));
  while (gcd(step, count) !== 1) step += 1;
  return [...Array(count).keys()].map(i => (i * step) % count);
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function initials(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).map(w => w[0]).join('');
  return (letters || '?').slice(0, 2).toUpperCase();
}

// Earliest arrival over the graph (Dijkstra): the order in which the post reaches each person.
function earliestArrivals(count: number, sourceId: number, edges: CascadeEdge[]): Arrival[] {
  const best = new Map<number, Arrival>([[sourceId, { id: sourceId, at: 0, from: null }]]);
  const done = new Set<number>();
  const adjacency = new Map<number, CascadeEdge[]>();
  for (const e of edges) for (const end of [e.a, e.b]) adjacency.set(end, [...(adjacency.get(end) ?? []), e]);
  while (done.size < count + 1) {
    const next = [...best.values()].filter(a => !done.has(a.id)).sort((x, y) => x.at - y.at)[0];
    if (!next) break;
    done.add(next.id);
    for (const e of adjacency.get(next.id) ?? []) {
      const target = e.a === next.id ? e.b : e.a;
      const at = next.at + e.delay;
      if (!done.has(target) && (!best.has(target) || at < best.get(target)!.at)) best.set(target, { id: target, at, from: next.id });
    }
  }
  return [...best.values()].sort((x, y) => x.at - y.at);
}

export function buildLiveNetwork(audience: Audience): CascadeNetwork {
  const labels = new Map(audience.niches.map(n => [n.slug, n.label]));
  const groups = new Map<string, AudienceMember[]>();
  for (const m of audience.members) groups.set(m.primaryNiche, [...(groups.get(m.primaryNiche) ?? []), m]);
  const bySize = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  // Show at most MAX_NICHE_GROUPS groups: the largest niches, with everyone else merged into "Other niches".
  // Every person is still drawn; their exact niches stay in the person panel.
  const named = bySize.filter(([slug]) => slug !== OTHER);
  const ordered: [string, AudienceMember[]][] = bySize.length <= MAX_NICHE_GROUPS ? bySize : [
    ...named.slice(0, MAX_NICHE_GROUPS - 1),
    [OTHER, [...named.slice(MAX_NICHE_GROUPS - 1).flatMap(([, ms]) => ms), ...(groups.get(OTHER) ?? [])]],
  ];
  if (bySize.length > MAX_NICHE_GROUPS) labels.set(OTHER, 'Other niches');

  // Ring of niche clusters, each sized by how many people it holds.
  const radii = ordered.map(([, ms]) => 20 + Math.sqrt(ms.length) * 24);
  const ringRadius = ordered.length < 2 ? 0 : Math.max(240, radii.reduce((s, r) => s + 2 * r + 26, 0) / (2 * Math.PI));
  const slots = ringSlots(ordered.length);
  const communities: CascadeCommunity[] = ordered.map(([slug, ms], i) => {
    const angle = (slots[i] / ordered.length) * Math.PI * 2 - Math.PI / 2;
    return {
      slug, name: labels.get(slug) ?? slug, size: ms.length,
      color: hslHex((i * 137.508 + 205) % 360, 0.62, 0.72),
      center: [Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius * 0.72, Math.sin(i * 1.9) * 80],
    };
  });

  // Audience-wide interest in each niche, used to estimate who the post reaches first.
  const share = new Map<string, number>();
  for (const m of audience.members) for (const n of m.niches) share.set(n.slug, (share.get(n.slug) ?? 0) + 1 / audience.members.length);
  const relevance = (m: AudienceMember) => m.niches.reduce((s, n) => s + n.affinity * (share.get(n.slug) ?? 0), 0);
  const maxRelevance = Math.max(1e-6, ...audience.members.map(relevance));
  const maxEngagement = Math.max(1e-6, ...audience.members.map(m => m.engagementRate));

  const nodes: CascadeNode[] = [];
  const edges: CascadeEdge[] = [];
  const idByUser = new Map<string, number>();
  ordered.forEach(([, members], ci) => {
    const c = communities[ci];
    const sorted = [...members].sort((a, b) => b.followers - a.followers || a.username.localeCompare(b.username));
    const firstId = nodes.length;
    sorted.forEach((m, k) => {
      const r = k === 0 ? 0 : 14 + Math.sqrt(k / Math.max(1, sorted.length - 1)) * radii[ci];
      const a = k * GOLDEN + ci * 0.7;
      const id = nodes.length;
      idByUser.set(m.userId, id);
      nodes.push({
        id, name: m.name, handle: m.username, avatar: m.avatar, initials: initials(m.name || m.username), community: ci, member: m,
        position: [c.center[0] + Math.cos(a) * r, c.center[1] + Math.sin(a) * r * 0.78, c.center[2] + Math.sin(id * 1.7) * r * 0.35],
      });
      // Inside a niche: everyone links to the niche's most-followed member and to the next member.
      if (k > 0) {
        const pace = 0.5 + (1 - m.engagementRate / maxEngagement) * 0.9;
        edges.push({ a: firstId, b: id, bridge: false, delay: pace });
        if (k > 1) edges.push({ a: id - 1, b: id, bridge: false, delay: pace + 0.2 });
      }
    });
  });

  const sourceId = nodes.length;
  // Everyone here follows or reposted the brand, so the post can reach each person directly.
  for (const node of nodes) edges.push({ a: sourceId, b: node.id, bridge: false, delay: 1.1 + (1 - relevance(node.member) / maxRelevance) * 3.4 });
  // Real reply/mention links between audience members, drawn as bridges.
  for (const [u, v] of audience.links) {
    const a = idByUser.get(u), b = idByUser.get(v);
    if (a !== undefined && b !== undefined) edges.push({ a, b, bridge: true, delay: 0.8 });
  }

  const arrivals = earliestArrivals(nodes.length, sourceId, edges);
  const extent = ringRadius + Math.max(0, ...radii) + 30;
  return {
    sourceId,
    source: { name: audience.brand.name, handle: audience.brand.username, avatar: audience.brand.avatar },
    nodes, communities, edges, arrivals,
    arrivalById: new Map(arrivals.map(a => [a.id, a])),
    duration: Math.max(0, ...arrivals.map(a => a.at)) + 1,
    nodeRadius: nodes.length > 60 ? 13 : 18,
    extent: Math.max(extent, 200),
  };
}
