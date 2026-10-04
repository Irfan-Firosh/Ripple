// Turns the audience read from SpacetimeDB into a renderable 3D cascade: every scraped person is a node
// grouped by their primary niche, with the brand's post at the centre.
import type { Audience, AudienceMember } from '../audience/liveAudience';
import { buildAffinityLayout } from './affinityLayout';

export type Vec3 = [number, number, number];
export type CascadeNode = {
  id: number; name: string; handle: string; avatar: string; initials: string;
  community: number; position: Vec3; member: AudienceMember;
};
export type CascadeCommunity = { slug: string; name: string; color: string; center: Vec3; size: number; radius:number };
export type CascadeEdge = { a: number; b: number; bridge: boolean; delay: number };
export type Arrival = { id: number; at: number; from: number | null };
export type NetworkLayout = {centers:Vec3[];positions:Vec3[];radii:number[];extent:number;halfWidth:number;halfHeight:number};
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
  planarLayout?:NetworkLayout;
};

const GOLDEN = 2.399963;
export const MAX_NICHE_GROUPS = 10;
export const MAX_GRAPH_NODES = 1500;
export const MAX_GRAPH_LINKS = 12000;
export class NetworkSizeError extends Error {
  constructor(){super(`This audience is too large to display. The interactive graph supports up to ${MAX_GRAPH_NODES.toLocaleString()} people and ${MAX_GRAPH_LINKS.toLocaleString()} connections. Choose a smaller audience.`);}
}
const OTHER = 'other';
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// Spread the largest niches across the globe rather than placing them side by side.
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
  for (const e of edges) for (const end of [e.a, e.b]) {
    const list=adjacency.get(end)??[];list.push(e);adjacency.set(end,list);
  }
  const heap: Arrival[]=[];
  const push=(arrival:Arrival)=>{
    heap.push(arrival);let i=heap.length-1;
    while(i>0){const parent=(i-1)>>1;if(heap[parent].at<=heap[i].at)break;[heap[parent],heap[i]]=[heap[i],heap[parent]];i=parent;}
  };
  const pop=()=>{
    const first=heap[0],last=heap.pop()!;
    if(heap.length){heap[0]=last;let i=0;while(true){const left=i*2+1,right=left+1;let next=i;if(left<heap.length&&heap[left].at<heap[next].at)next=left;if(right<heap.length&&heap[right].at<heap[next].at)next=right;if(next===i)break;[heap[i],heap[next]]=[heap[next],heap[i]];i=next;}}
    return first;
  };
  push(best.get(sourceId)!);
  while (done.size < count + 1) {
    if(!heap.length)break;
    const next=pop();if(done.has(next.id))continue;
    done.add(next.id);
    for (const e of adjacency.get(next.id) ?? []) {
      const target = e.a === next.id ? e.b : e.a;
      const at = next.at + e.delay;
      if (!done.has(target) && (!best.has(target) || at < best.get(target)!.at)) {
        const arrival={ id: target, at, from: next.id };best.set(target,arrival);push(arrival);
      }
    }
  }
  return [...best.values()].sort((x, y) => x.at - y.at);
}

const INTEREST_BRIDGE = 0.4; // twins rate a real second interest 0.4-0.5 (about 1 in 4 people)
const affinityIn = (m: AudienceMember, slug: string) => m.niches.find(n => n.slug === slug)?.affinity ?? 0;

// Groups people into at most maxGroups real niches (never a catch-all bucket). The groups are the most common
// primary niches; each person joins the group they rate highest. Someone who rates none of them joins the
// group whose fans share the most interests with theirs. Their exact niches stay in the person panel.
export function groupByNiche(members: AudienceMember[], maxGroups: number): [string, AudienceMember[]][] {
  const primaries = new Map<string, number>();
  for (const m of members) primaries.set(m.primaryNiche, (primaries.get(m.primaryNiche) ?? 0) + 1);
  const ranked = [...primaries.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([slug]) => slug);
  const named = ranked.filter(slug => slug !== OTHER);
  const chosen = (named.length ? named : ranked).slice(0, Math.max(1, maxGroups));
  const overlap = (m: AudienceMember, slug: string) =>
    members.reduce((sum, other) => sum + affinityIn(other, slug) * m.niches.reduce((s, n) => s + n.affinity * affinityIn(other, n.slug), 0), 0);
  const best = (m: AudienceMember) => {
    const score = (slug: string) => affinityIn(m, slug);
    const direct = chosen.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (score(direct) > 0) return direct;
    return chosen.reduce((a, b) => (overlap(m, b) > overlap(m, a) ? b : a));
  };
  const groups = new Map<string, AudienceMember[]>(chosen.map(slug => [slug, []]));
  for (const m of members) groups.get(best(m))!.push(m);
  return [...groups.entries()].filter(([, ms]) => ms.length).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

export function buildLiveNetwork(audience: Audience, { maxNicheGroups = MAX_NICHE_GROUPS, prepareLayout=true }: { maxNicheGroups?: number;prepareLayout?:boolean } = {}): CascadeNetwork {
  // Guard before allocating geometry, images or shortest-path work. Never silently drop people.
  if(audience.members.length>MAX_GRAPH_NODES||audience.links.length+audience.members.length*3>MAX_GRAPH_LINKS)throw new NetworkSizeError();
  const labels = new Map(audience.niches.map(n => [n.slug, n.label]));
  const ordered = groupByNiche(audience.members, maxNicheGroups);

  // Compact globe of niche clusters, each sized by how many people it holds.
  const radii = ordered.map(([, ms]) => 12 + Math.sqrt(ms.length) * 10);
  let globeRadius = ordered.length < 2 ? 0 : Math.max(190, Math.max(...radii)*1.05);
  const slots = ringSlots(ordered.length);
  const communities: CascadeCommunity[] = ordered.map(([slug, ms], i) => {
    const latitude = -1 + 2 * (slots[i] + .5) / ordered.length;
    const angle = slots[i] * GOLDEN;
    const crossSection = Math.sqrt(1 - latitude * latitude);
    return {
      slug, name: labels.get(slug) ?? slug, size: ms.length, radius:radii[i],
      color: hslHex((i * 137.508 + 205) % 360, 0.62, 0.72),
      center: [Math.cos(angle) * crossSection * globeRadius, latitude * globeRadius, Math.sin(angle) * crossSection * globeRadius],
    };
  });
  // Separate whole niche spheres by a small gap; profiles cannot spill into another niche.
  let separation=1;
  for(let i=0;i<communities.length;i++)for(let j=i+1;j<communities.length;j++){
    const distance=Math.hypot(...communities[i].center.map((v,axis)=>v-communities[j].center[axis]));
    separation=Math.max(separation,(radii[i]+radii[j]+32)/Math.max(1,distance));
  }
  if(separation>1){globeRadius*=separation;communities.forEach(c=>{c.center=c.center.map(v=>v*separation) as Vec3;});}

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
      // Fibonacci directions give each niche actual volume along all three axes.
      // Keep the hub at its center and distribute the other accounts throughout a sphere.
      const count = Math.max(1, sorted.length - 1);
      const latitude = k === 0 ? 0 : 1 - 2 * (k - .5) / count;
      const crossSection = Math.sqrt(Math.max(0, 1 - latitude * latitude));
      const r = k === 0 ? 0 : radii[ci] * (.65 + .35 * Math.cbrt(((k * .618034) % 1)));
      const a = k * GOLDEN + ci * 0.7;
      const id = nodes.length;
      idByUser.set(m.userId, id);
      nodes.push({
        id, name: m.name, handle: m.username, avatar: m.avatar, initials: initials(m.name || m.username), community: ci, member: m,
        position: [c.center[0] + Math.cos(a) * crossSection * r, c.center[1] + latitude * r, c.center[2] + Math.sin(a) * crossSection * r],
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
  // Shared interests across niches: someone whose strongest other interest is another cluster bridges to
  // that cluster's hub (its most-followed member), so clusters show how the audience overlaps.
  const hubOf = new Map<string, number>();
  for (const n of nodes) { const slug = communities[n.community].slug; if (!hubOf.has(slug)) hubOf.set(slug, n.id); }
  for (const n of nodes) {
    const own = communities[n.community].slug;
    const next = [...n.member.niches].sort((x, y) => y.affinity - x.affinity)
      .find(x => x.slug !== own && x.affinity >= INTEREST_BRIDGE && hubOf.has(x.slug));
    if (next) edges.push({ a: n.id, b: hubOf.get(next.slug)!, bridge: true, delay: 1.0 });
  }

  const arrivals = earliestArrivals(nodes.length, sourceId, edges);
  const extent = globeRadius + Math.max(0, ...radii) + 30;
  const network:CascadeNetwork = {
    sourceId,
    source: { name: audience.brand.name, handle: audience.brand.username, avatar: audience.brand.avatar },
    nodes, communities, edges, arrivals,
    arrivalById: new Map(arrivals.map(a => [a.id, a])),
    duration: Math.max(0, ...arrivals.map(a => a.at)) + 1,
    nodeRadius: nodes.length > 400 ? 6 : nodes.length > 60 ? 13 : 18,
    extent: Math.max(extent, 200),
  };
  if(prepareLayout){
    const layout=buildAffinityLayout(network,3);
    network.nodes.forEach(node=>{node.position=layout.positions[node.id];});
    network.communities.forEach((community,i)=>{community.center=layout.centers[i];community.radius=layout.radii[i];});
    network.extent=layout.extent;
  }
  return network;
}
