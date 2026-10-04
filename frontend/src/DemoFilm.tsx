import { lazy, Suspense, useEffect, useState } from 'react';

const AudiencePage = lazy(() => import('./NetworkTestPage'));
const LabPage = lazy(() => import('./lab/LabPage'));

declare global {
  interface Window { __setDemoTime: (seconds: number) => void }
}

// The film uses the product itself. Its data, controls and results stay identical.
export function DemoFilm({ theme }: { theme: 'dark' | 'light' }) {
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('ripple-theme', theme); } catch { /* Optional storage. */ }
    const changeScene = (seconds: number) => {
      history.replaceState(null, '', `${seconds < 12 ? '/dashboard' : '/lab'}${location.search}`);
      setTime(seconds);
    };
    window.__setDemoTime = changeScene;
    changeScene(0);
    setReady(true);
    return () => { delete (window as Partial<Window>).__setDemoTime; };
  }, [theme]);
  return <div className="product-film" data-scene={time < 12 ? 'audience' : 'lab'}>{ready && <Suspense fallback={<div role="status">Opening Ripple…</div>}>{time < 12 ? <AudiencePage workspace /> : <LabPage />}</Suspense>}</div>;
}
