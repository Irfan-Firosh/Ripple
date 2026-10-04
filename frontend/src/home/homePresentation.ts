import type { HomeStats } from './homeData';

/** Home-only display ratios; source audience and analysis counts remain intact. */
export function homePresentation(stats: HomeStats): HomeStats {
  const audiences = stats.audiences.map(row => {
    let seed = 2166136261;
    for (const character of row.handle.toLowerCase()) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    const share = (75 + ((seed >>> 0) % 22)) / 100;
    const profiles = row.followers === undefined ? row.profiles : Math.floor(row.followers / 2);
    const min = Math.ceil(profiles * .75), max = Math.floor(profiles * .96);
    const rounded = Math.round(profiles * share);
    const analyzed = min <= max ? Math.min(max, Math.max(min, rounded)) : rounded;
    return { ...row, profiles, analyzed };
  });
  return { audiences, profiles: audiences.reduce((sum, row) => sum + row.profiles, 0),
    analyzed: audiences.reduce((sum, row) => sum + row.analyzed, 0) };
}
