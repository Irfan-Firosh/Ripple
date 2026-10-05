import { useEffect, useState } from 'react';
import { sql } from '../audience/liveAudience';
import { STATIC_SNAPSHOT } from '../snapshot';

export type WorkspaceTarget = 'home' | 'onboarding';
export const workspaceHref = (target: WorkspaceTarget) => (target === 'onboarding' ? '/onboarding' : '/home');

// Where "Open workspace" leads, set from /ops. The static deploy has no onboarding, so it always goes home.
export function useWorkspaceHref(): string {
  const [target, setTarget] = useState<WorkspaceTarget>('home');
  useEffect(() => {
    if (STATIC_SNAPSHOT) return;
    let live = true;
    sql<{ workspace_target: string }>("SELECT * FROM landing_settings WHERE key = 'global'")
      .then(rows => { if (live && rows[0]?.workspace_target === 'onboarding') setTarget('onboarding'); })
      .catch(() => undefined); // unreachable setting: keep the default
    return () => { live = false; };
  }, []);
  return workspaceHref(target);
}
