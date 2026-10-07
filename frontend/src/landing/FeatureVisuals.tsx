import { useId } from 'react';

/** Decorative product concepts, independent of recorded audience and Lab results. */
export function FeatureVisual({ kind }: { kind: 'audience' | 'creative' | 'lab' }) {
  const id = useId().replaceAll(':', '');
  return <div className={`feature-visual feature-art feature-art-${kind}`} data-visual={kind}>
    <svg viewBox="0 0 360 250" fill="none" role="img" aria-label={{ audience: 'Connected audience interests', creative: 'An idea becomes an image and a video', lab: 'Two drafts compared through engagement signals' }[kind]}>
      <defs>
        <linearGradient id={`${id}-ink`} x1="60" y1="40" x2="270" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".08" /></linearGradient>
        <linearGradient id={`${id}-gold`} x1="70" y1="80" x2="290" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="var(--accent)" stopOpacity=".15" /><stop offset=".5" stopColor="var(--accent)" /><stop offset="1" stopColor="currentColor" stopOpacity=".4" /></linearGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.5" /></filter>
      </defs>
      <path d="M180 12v220M26 140h308" stroke="currentColor" strokeOpacity=".08" strokeDasharray="3 7" />
      <ellipse cx="180" cy="218" rx="90" ry="13" stroke="currentColor" strokeOpacity=".08" />
      {kind === 'audience' ? <AudienceArt id={id} /> : kind === 'creative' ? <CreativeArt id={id} /> : <LabArt id={id} />}
    </svg>
  </div>;
}

function AudienceArt({ id }: { id: string }) {
  const nodes = [[82, 113], [105, 73], [158, 67], [222, 89], [278, 131], [261, 170], [202, 187], [139, 160]];
  return <>
    <ellipse cx="180" cy="134" rx="122" ry="54" stroke={`url(#${id}-ink)`} strokeWidth="1.2" transform="rotate(-16 180 134)" />
    <ellipse cx="180" cy="134" rx="122" ry="54" stroke={`url(#${id}-gold)`} strokeWidth="1.4" transform="rotate(29 180 134)" />
    <ellipse className="feature-orbit" cx="180" cy="134" rx="55" ry="100" stroke={`url(#${id}-ink)`} strokeOpacity=".4" transform="rotate(38 180 134)" />
    <path d="M82 113Q164 105 158 67M105 73Q174 138 261 170M139 160Q184 114 222 89M278 131Q210 163 202 187" stroke="currentColor" strokeOpacity=".18" />
    {nodes.map(([x, y], i) => <g key={i} className="feature-star" style={{ animationDelay: `${i * -.7}s` }}>
      <circle cx={x} cy={y} r="9" fill={i % 3 === 0 ? 'var(--accent)' : 'currentColor'} opacity=".2" filter={`url(#${id}-glow)`} />
      <circle cx={x} cy={y} r="3.8" fill={i % 3 === 0 ? 'var(--accent)' : 'currentColor'} />
      <circle cx={x} cy={y} r="9" stroke="currentColor" strokeOpacity=".15" />
    </g>)}
    <circle className="feature-pulse" cx="180" cy="134" r="17" stroke="var(--accent)" strokeOpacity=".5" />
    <circle cx="180" cy="134" r="5" fill="var(--accent)" />
    <path d="M167 134h-5m31 0h5m-18-13v-5m0 31v5" stroke="var(--accent)" strokeOpacity=".5" />
  </>;
}

function CreativeArt({ id }: { id: string }) {
  return <>
    <path d="M64 94Q164 44 280 117" stroke="currentColor" strokeOpacity=".18" strokeDasharray="3 6" />
    <path d="M53 148Q172 218 302 137" stroke={`url(#${id}-gold)`} />
    <g className="feature-card-float">
      <path d="m49 86 114-24 0 94-114 24Z" fill="var(--bg)" stroke={`url(#${id}-gold)`} strokeWidth="1.4" />
      <path d="m58 94 96-20v70l-96 20Z" stroke="currentColor" strokeOpacity=".2" />
      <path d="m63 147 29-37 20 15 15-25 22 40" stroke="currentColor" strokeOpacity=".7" strokeWidth="1.2" />
      <circle cx="131" cy="90" r="5" stroke="var(--accent)" />
      <path d="m49 188 114-24" stroke="currentColor" strokeOpacity=".08" />
    </g>
    <g className="feature-card-float feature-card-second">
      <path d="m203 82 105 24v91l-105-24Z" fill="var(--bg)" stroke={`url(#${id}-ink)`} strokeWidth="1.4" />
      <path d="m211 92 89 20v70l-89-20Z" stroke="currentColor" strokeOpacity=".15" />
      <path d="m245 120 0 29 23-9Z" fill="currentColor" opacity=".8" />
      <path d="m220 175 72 16" stroke="var(--accent)" strokeOpacity=".5" />
      <path d="m203 205 105 24" stroke="currentColor" strokeOpacity=".06" />
    </g>
    <path className="feature-flow-line" d="M175 118q6-10 14 0m-7-11v22" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    <circle className="feature-pulse" cx="182" cy="118" r="21" stroke="var(--accent)" strokeOpacity=".25" />
  </>;
}

function LabArt({ id }: { id: string }) {
  return <>
    <path d="M53 185 307 159M53 185V58M307 159V42" stroke="currentColor" strokeOpacity=".12" />
    {[80, 125, 170, 215, 260].map((x, i) => <path key={x} d={`M${x} ${182 - i * 4}v5`} stroke="currentColor" strokeOpacity=".3" />)}
    <path d="M55 160q30-12 46-35t38-9 50-21 56-20 57-15" stroke="var(--accent)" strokeOpacity=".25" strokeWidth="5" filter={`url(#${id}-glow)`} />
    <path className="feature-signal-line" d="M55 160q30-12 46-35t38-9 50-21 56-20 57-15" stroke="var(--accent)" strokeWidth="1.8" pathLength="1" />
    <path className="feature-signal-line feature-signal-b" d="M55 161q42-3 66-37t43 2 41-25 44-25 51-21" stroke={`url(#${id}-ink)`} strokeWidth="1.8" pathLength="1" />
    <path d="M55 167q30-12 46-35t38-9 50-21 56-20 57-15" stroke="currentColor" strokeOpacity=".06" />
    <circle className="feature-star" cx="188" cy="95" r="4" fill="var(--accent)" />
    <circle className="feature-star feature-card-second" cx="208" cy="101" r="4" fill="currentColor" />
    <g fontFamily="Space Mono, monospace" fontSize="10"><text x="276" y="52" fill="var(--accent)">A</text><text x="299" y="39" fill="currentColor" opacity=".7">B</text></g>
    <path d="M54 210q107 24 247-14" stroke={`url(#${id}-gold)`} strokeOpacity=".16" />
  </>;
}
