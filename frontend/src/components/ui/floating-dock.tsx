import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FlaskConical, House, Menu, Network, PanelsTopLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import './floating-dock.css';

type DockItem = { title: string; icon: ReactNode; href: string };
type FloatingDockProps = { items: DockItem[]; desktopClassName?: string; mobileClassName?: string; className?: string };
const active = (href: string) => href.split('?')[0] === (location.pathname.replace(/\/$/, '') || '/');

// Match the landing page's compact capsule, with workspace destinations.
export function FloatingDock({ items, desktopClassName, mobileClassName, className }: FloatingDockProps) {
  return <div className={cn('floating-dock', className)}><FloatingDockDesktop items={items} className={desktopClassName} /><FloatingDockMobile items={items} className={mobileClassName} /></div>;
}

export function FloatingDockDesktop({ items, className }: { items: DockItem[]; className?: string }) {
  return <nav aria-label="Workspace navigation" className={cn('fd-desktop workspace-nav', className)}>
    {items.map(item => <a key={item.title} href={item.href} aria-current={active(item.href) ? 'page' : undefined}>{item.title}</a>)}
  </nav>;
}

export function FloatingDockMobile({ items, className }: { items: DockItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [open]);
  return <div ref={ref} className={cn('fd-mobile', className)}>
    <button ref={button} className="fd-mobile-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
    <AnimatePresence>{open && <motion.nav id={id} aria-label="Workspace navigation" className="fd-mobile-menu" initial={{ opacity: 0, y: reduced ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }} transition={{ duration: reduced ? 0 : .18 }}>
      {items.map(item => <a key={item.title} href={item.href} aria-current={active(item.href) ? 'page' : undefined} onClick={() => setOpen(false)}><span aria-hidden="true">{item.icon}</span>{item.title}</a>)}
    </motion.nav>}</AnimatePresence>
  </div>;
}

export function RippleWorkspaceNav({ brand }: { brand: string }) {
  const query = `?brand=${encodeURIComponent(brand)}`;
  return <FloatingDock className="ripple-workspace-nav" items={[
    { title: 'Home', icon: <House />, href: '/home' },
    { title: 'Audience', icon: <Network />, href: `/dashboard${query}` },
    { title: 'Campaign', icon: <PanelsTopLeft />, href: `/campaign${query}` },
    { title: 'Lab', icon: <FlaskConical />, href: `/lab${query}` },
  ]} />;
}

export default FloatingDock;
