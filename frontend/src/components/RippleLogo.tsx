import { RippleMark } from '../App';
import './ripple-logo.css';
import './workspace-header.css';

export function RippleLogo({ href = '/home', className = '' }: { href?: string; className?: string }) {
  return <a className={`ripple-wordmark ${className}`} href={href} aria-label="Ripple home"><RippleMark size={24} /><span>Ripple</span></a>;
}
