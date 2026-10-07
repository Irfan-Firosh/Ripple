import { useId } from 'react';
import type { HomeStats as Stats } from './homeData';

export function HomeStats({ stats }: { stats: Stats }) {
  const gradient = useId();
  const rows = stats.audiences.slice(0, 7);
  const max = Math.max(10, ...rows.map(row => row.profiles));
  const top = Math.ceil(max / 10) * 10;
  const height = 200, left = 45, width = 550;
  const slot = width / Math.max(1, rows.length), bar = Math.min(48, slot * .55);
  return <section className="home-chart-panel" aria-labelledby="home-chart-title">
    <div className="home-panel-heading"><div><span className="home-eyebrow">AUDIENCE</span><h2 id="home-chart-title">Audience overview</h2></div><span className="home-live"><i />Live</span></div>
    <div className="home-chart-legend"><span><i />Profiles found</span><span><i />Profiles created</span></div>
    {rows.length ? <div className="home-chart-scroll" data-dense={rows.length > 4}><svg className="home-chart" viewBox="0 0 620 280" role="img" aria-label={`Audience profiles by brand: ${rows.map(row => `@${row.handle}, ${row.profiles} found, ${row.analyzed} created`).join('; ')}`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".35" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <g key={index} className="home-chart-grid"><line x1={left} y1={24 + height * index / 4} x2={600} y2={24 + height * index / 4} /><text x={left - 12} y={28 + height * index / 4} textAnchor="end">{Math.round(top * (1 - index / 4))}</text></g>)}
      {rows.map((row, index) => {
        const x = left + slot * (index + .5), h = row.profiles / top * height, analyzed = row.analyzed / top * height;
        return <g key={row.handle}><title>{`@${row.handle}: ${row.profiles} profiles found · ${row.analyzed} created`}</title><rect className="home-chart-found" x={x - bar / 2} y={224 - h} width={bar} height={h} rx={5} /><rect x={x - bar / 2} y={224 - analyzed} width={bar} height={analyzed} rx={5} fill={`url(#${gradient})`} /><text className="home-chart-value" x={x} y={224 - h - 12} textAnchor="middle">{row.profiles}</text><text className="home-chart-label" x={x} y={252} textAnchor="middle">@{row.handle}</text></g>;
      })}
    </svg></div> : <div className="home-chart-empty"><span>No audience data yet</span><a href="/onboarding?flow=campaign">Connect your first brand →</a></div>}
    <div className="home-chart-foot">Profiles in your connected audiences</div>
  </section>;
}
