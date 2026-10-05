import { useEffect, useState } from 'react';
import { Loader } from './ui/loader';
import './demo-delay.css';

const DELAY_MS = 3000;
const FADE_MS = 300;

// A short loading screen over a page, then it fades away (the Lab when opened from a campaign).
export function DemoDelay({ label }: { label: string }) {
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'gone'>('loading');
  useEffect(() => {
    const timer = window.setTimeout(() => setPhase(phase => (phase === 'loading' ? 'leaving' : phase)), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === 'gone') return null;
  return <div className={`demo-delay${phase === 'leaving' ? ' is-leaving' : ''}`} role="status" aria-live="polite">
    <Loader shape="ripple" variant="dither" size="lg" color="var(--accent)" aria-hidden="true" />
    <p>{label}</p>
  </div>;
}
