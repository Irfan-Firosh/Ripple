import { Moon, Sun } from 'lucide-react';
import { RippleMark } from '../App';
import { BRANDS } from '../audience/liveAudience';
import { RippleWorkspaceNav } from './ui/floating-dock';

export function WorkspaceHeader({ section, brand, onBrandChange, theme, onThemeChange }: {
  section: string; brand: string; onBrandChange: (brand: string) => void;
  theme: 'dark' | 'light'; onThemeChange: (theme: 'dark' | 'light') => void;
}) {
  return <header className="lab-header">
    <a className="brand" href="/" aria-label="Ripple home"><RippleMark size={26} /><span>Ripple</span></a>
    <span className="lab-crumb">{section}</span>
    <RippleWorkspaceNav brand={brand} />
    <nav className="lab-brands" aria-label="Audience">{BRANDS.map(item =>
      <button key={item.handle} aria-current={item.handle === brand ? 'page' : undefined}
        onClick={() => onBrandChange(item.handle)}>{item.label}</button>)}</nav>
    <button className="lab-icon" aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode'}
      onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
  </header>;
}
