import { BRANDS, loadAudience } from '../audience/liveAudience';
import { buildLiveNetwork, type CascadeNetwork } from '../visuals/liveNetwork';
import { buildClusterEdges } from '../visuals/clusterEdges';
import { percentShares } from '../visuals/communityShares';
import { prepareNetwork } from '../visuals/prepareNetwork';
import type { Point } from './spreadScene';

export type PreviewPerson = Point & { id: number; userId: string; group: number; name: string; handle: string; avatar: string; profileUrl: string };
export type PreviewCommunity = Point & { slug: string; label: string; size: number; sampleSize: number; share: number; radius: number };
export type PreviewLink = { a: number; b: number; strength: number; actorsA: number[]; actorsB: number[] };
export type PreviewAudience = { people: PreviewPerson[]; communities: PreviewCommunity[]; links: PreviewLink[]; total: number; brandAvatar: string };

/** Largest remainder: each niche differs from its exact sample quota by less than one profile. */
export function sampleQuotas(sizes: number[], cap = 112): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0), count = Math.min(cap, total);
  if (!total) return sizes.map(() => 0);
  const exact = sizes.map(size => size * count / total), quotas = exact.map(Math.floor);
  const order = exact.map((size, index) => ({ index, fraction: size - quotas[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const remaining = count - quotas.reduce((sum, quota) => sum + quota, 0);
  for (let i = 0; i < remaining; i++) quotas[order[i].index]++;
  return quotas;
}

export function sampleAudience(network: CascadeNetwork): PreviewAudience {
  const sizes = network.communities.map(group => group.size), quotas = sampleQuotas(sizes), shares = percentShares(sizes);
  const bridgeActors = new Set<number>();
  for (const edge of network.edges) if (edge.bridge && edge.a !== network.sourceId && edge.b !== network.sourceId
    && network.nodes[edge.a].community !== network.nodes[edge.b].community) { bridgeActors.add(edge.a); bridgeActors.add(edge.b); }
  const selected = network.communities.flatMap((_, i) => {
    const remaining = network.nodes.filter(person => person.community === i)
      .sort((a, b) => Number(bridgeActors.has(b.id)) - Number(bridgeActors.has(a.id)) || a.member.userId.localeCompare(b.member.userId));
    const targets = new Map<number, Set<number>>();
    for (const edge of network.edges) if (edge.bridge && edge.a !== network.sourceId && edge.b !== network.sourceId) {
      for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) if (network.nodes[a].community === i && network.nodes[b].community !== i) {
        const groups = targets.get(a) ?? new Set<number>(); groups.add(network.nodes[b].community); targets.set(a, groups);
      }
    }
    const covered = new Set<number>(), picked: typeof remaining = [];
    while (picked.length < quotas[i] && remaining.length) {
      const count = (id: number) => [...(targets.get(id) ?? [])].filter(target => !covered.has(target)).length;
      const best = remaining.reduce((index, node, at) => count(node.id) > count(remaining[index].id) ? at : index, 0);
      if (!count(remaining[best].id)) break;
      const node = remaining.splice(best, 1)[0]; picked.push(node);
      targets.get(node.id)?.forEach(target => covered.add(target));
    }
    return [...picked, ...remaining].slice(0, quotas[i]);
  });
  const scale = 180 / Math.max(1, ...network.nodes.flatMap(node => node.position.map(Math.abs)));
  const point = (position: [number, number, number]) => ({ x: position[0] * scale, y: position[1] * scale, z: position[2] * scale });
  const indexOf = new Map(selected.map((node, index) => [node.id, index]));
  const people = selected.map((node, id) => ({ ...point(node.position), id, userId: node.member.userId, group: node.community,
    name: node.name, handle: node.handle, avatar: node.avatar, profileUrl: node.member.profileUrl }));
  const links = buildClusterEdges(network).filter(edge => edge.kind === 'bridge').map(edge => {
    const actors = (from: number, to: number) => {
      const ids = new Set<number>();
      for (const tie of network.edges) {
        if (!tie.bridge || tie.a === network.sourceId || tie.b === network.sourceId) continue;
        for (const [a, b] of [[tie.a, tie.b], [tie.b, tie.a]]) {
          const selectedIndex = indexOf.get(a);
          if (selectedIndex !== undefined && network.nodes[a].community === from && network.nodes[b].community === to) ids.add(selectedIndex);
        }
      }
      return [...ids];
    };
    return { a: edge.a, b: edge.b, strength: edge.strength, actorsA: actors(edge.a, edge.b), actorsB: actors(edge.b, edge.a) };
  });
  return { people, links, total: network.nodes.length, brandAvatar: network.source.avatar, communities: network.communities.map((group, i) => ({ ...point(group.center),
    slug: group.slug, label: group.name, size: group.size, sampleSize: quotas[i], share: shares[i], radius: group.radius * scale })) };
}

export async function loadSpreadAudience(brand: string, signal: AbortSignal): Promise<PreviewAudience> {
  const audience = await loadAudience(brand, signal, true);
  if (!audience.members.length) throw new Error(`@${brand} has no audience profiles yet.`);
  const maxNicheGroups = BRANDS.find(entry => entry.handle === brand)?.maxNiches ?? 6;
  const network = buildLiveNetwork(audience, { maxNicheGroups, prepareLayout: false });
  await prepareNetwork(network, signal);
  return sampleAudience(network);
}

