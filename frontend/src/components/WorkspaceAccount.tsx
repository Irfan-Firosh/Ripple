import { Show, UserButton } from '@clerk/react';
import { UserRound } from 'lucide-react';
import './workspace-account.css';

export function WorkspaceAccount({ className = '' }: { className?: string }) {
  return <div className={`workspace-account ${className}`} aria-label="Your account">
    <Show when="signed-in"><UserButton appearance={{ elements: { avatarBox: { width: 32, height: 32 } } }} /></Show>
    <Show when="signed-out"><a href="/auth/sign-in" aria-label="Sign in to your account"><UserRound size={16} /></a></Show>
  </div>;
}
