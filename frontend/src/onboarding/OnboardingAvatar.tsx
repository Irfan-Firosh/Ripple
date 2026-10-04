import { BotAvatar } from 'bot-avatars';
import { useReducedMotion } from 'motion/react';

export function OnboardingAvatar({ size = 48, working = false, theme }: { size?: number; working?: boolean; theme: 'dark' | 'light' }) {
  const reduced = Boolean(useReducedMotion());
  return <span className="on-avatar" data-state={working ? 'working' : 'default'}>
    <BotAvatar type="clover" state={working ? 'working' : 'default'} size={size} theme={theme}
      color="#e6bc88" brightness={1} saturation={1} paused={reduced} interactive={!reduced}
      aria-label={working ? 'Ripple assistant, working' : 'Ripple assistant'} />
  </span>;
}
