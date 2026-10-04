import { connections, profiles } from './network';
export const SOURCE_ID = 48;
export const cascadeEdges = [...connections, { a: SOURCE_ID, b: 0, bridge: true }];
export type Arrival = { id: number; at: number; from: number | null };
// A deterministic sample: earliest arrival follows an actual graph edge.
// Crossing a community bridge takes longer than passing within a community.
export function buildCascade(): Arrival[] {
  const arrivals = new Map<number, Arrival>([[SOURCE_ID, { id: SOURCE_ID, at: 0, from: null }]]);
  const visited = new Set<number>();
  while (visited.size < profiles.length + 1) {
    const next = [...arrivals.values()].filter(a => !visited.has(a.id)).sort((a,b) => a.at-b.at)[0];
    if (!next) break;
    visited.add(next.id);
    for (const edge of cascadeEdges) {
      if (edge.a !== next.id && edge.b !== next.id) continue;
      const target = edge.a === next.id ? edge.b : edge.a;
      const delay = next.id === SOURCE_ID ? 1.25 : edge.bridge ? 2.6 : .65 + ((target * 7) % 11) * .085;
      const at = next.at + delay;
      if (!visited.has(target) && (!arrivals.has(target) || at < arrivals.get(target)!.at)) arrivals.set(target, { id: target, at, from: next.id });
    }
  }
  return [...arrivals.values()].sort((a,b) => a.at-b.at);
}
export const cascade = buildCascade();
export const cascadeDuration = Math.max(...cascade.map(a => a.at)) + 1;
export function cascadePosition(id: number): [number, number] {
  if (id === SOURCE_ID) return [0,0];
  const group = Math.floor(id/12), index = id%12;
  const centers = [[-290,-170],[290,-170],[290,170],[-290,170]];
  const [cx,cy] = centers[group];
  if (index === 0) return [cx,cy];
  const angle = index * 2.399963 + group * .8;
  const radius = 40 + Math.sqrt(index/11) * 85;
  return [cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius*.78];
}
