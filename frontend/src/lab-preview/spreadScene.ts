import type { PreviewAudience } from './previewAudience';

export type Point = { x: number; y: number; z: number };
export type Reaction = { id: string; person: number; action: 'like' | 'repost'; at: number; target?: number; targets?: number[]; featured?: boolean };
export type Handoff = { from: number | null; to: number; actor: number | null; at: number; arrives: number; strength: number };
export type SpreadTrial = { events: Reaction[]; handoffs: Handoff[]; arrivals: number[] };
export type SpreadScene = PreviewAudience & { a: SpreadTrial; b: SpreadTrial; duration: number };

function startingNiche(audience: PreviewAudience, text: string): number {
  const content = text.toLowerCase();
  const scores = audience.communities.map(group => !group.sampleSize ? -1 : (group.slug + ' ' + group.label).toLowerCase().split(/[^a-z]+/)
    .filter(word => word.length > 2 || word === 'ai').reduce((sum, word) => sum + (content.includes(word) ? 1 : 0), 0));
  return scores.reduce((best, value, i) => value > scores[best] ? i : best, 0);
}

/** Illustrative frontend reactions on real profiles; handoffs are not observed repost provenance. */
export function createSpreadScene(audience: PreviewAudience, seed: number, draftA = '', draftB = ''): SpreadScene {
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  const trial = (text: string): SpreadTrial => {
    const arrivals = audience.people.map(() => Infinity), events: Reaction[] = [], handoffs: Handoff[] = [];
    const reached = new Set<number>();
    const queue = [{ group: startingNiche(audience, text), at: .8 }];
    const share = .65 + random() * .2;
    handoffs.push({ from: null, to: queue[0].group, actor: null, at: 0, arrives: .8, strength: .5 });
    for (const { group, at } of queue) {
      reached.add(group);
      const members = audience.people.filter(person => person.group === group);
      const featured = members[Math.floor(random() * members.length)];
      for (const person of members) if (random() < share || person === featured) {
        const when = person === featured ? at + .45 : at + .5 + random() * 2.5;
        arrivals[person.id] = when;
        events.push({ id: `like-${person.id}`, person: person.id, action: 'like', at: when, featured: person === featured });
      }
      const candidates = audience.links.flatMap(link => {
        const target = link.a === group ? link.b : link.b === group ? link.a : -1;
        const actors = link.a === group ? link.actorsA : link.actorsB;
        return target >= 0 && !reached.has(target) && !queue.some(item => item.group === target) && actors.length
          ? [{ target, actors, strength: link.strength, rank: random() * (1 + link.strength) }] : [];
      }).sort((a, b) => b.rank - a.rank);
      // Branch through reachable real bridges instead of abandoning connected leaf communities.
      for (const next of candidates) {
        const unused = next.actors.filter(actor => !events.some(event => event.action === 'repost' && event.person === actor));
        const actors = unused.length ? unused : next.actors;
        const actor = actors[Math.floor(random() * actors.length)];
        let repost = events.find(event => event.action === 'repost' && event.person === actor);
        if (!repost) {
          repost = { id: `repost-${actor}`, person: actor, action: 'repost', at: at + 2.9 + random() * .8,
            target: next.target, targets: [], featured: true };
          events.push(repost);
        }
        repost.targets?.push(next.target);
        arrivals[actor] = Math.min(arrivals[actor], repost.at);
        const arrives = repost.at + .85 + random() * .3;
        handoffs.push({ from: group, to: next.target, actor, at: repost.at, arrives, strength: next.strength });
        queue.push({ group: next.target, at: arrives });
      }
      // Additional reposts light up individual people; only bridge actors advance the spread.
      for (const person of members) if (Number.isFinite(arrivals[person.id]) && random() < .28
        && !events.some(event => event.action === 'repost' && event.person === person.id)) {
        events.push({ id: `repost-${person.id}`, person: person.id, action: 'repost', at: arrivals[person.id] + .6 + random() * 2, featured: true });
      }
    }
    return { events: events.sort((a, b) => a.at - b.at), handoffs, arrivals };
  };
  const a = trial(draftA), b = trial(draftB);
  const duration = Math.max(8, ...a.events.map(event => event.at), ...b.events.map(event => event.at)) + 3;
  return { ...audience, a, b, duration };
}

export function project(point: Point, angle: number) {
  const x = point.x * Math.cos(angle) + point.z * Math.sin(angle);
  const z = point.z * Math.cos(angle) - point.x * Math.sin(angle);
  const y = point.y * Math.cos(-.2) - z * Math.sin(-.2);
  const depth = z * Math.cos(-.2) + point.y * Math.sin(-.2);
  const scale = 600 / (600 - depth);
  return { x: 280 + x * scale, y: 230 + y * scale, scale, depth };
}
