import { RippleLogo } from '../components/RippleLogo';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, ChevronUp, Moon, Sun } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { initialTheme } from '../App';
import { OnboardingAvatar } from './OnboardingAvatar';
import { BuildView } from './BuildView';
import { findOnboarding, liveStatus, normalizeHandle, requestOnboarding, updateBrief, useBuild, type Brief, type Goal, type OnboardingRow } from './onboardingData';
import './onboarding.css';

const choices: { key: string; label: string; goal: Goal }[] = [
  { key: 'A', label: 'Reposts', goal: 'reposts' }, { key: 'B', label: 'Likes', goal: 'likes' },
  { key: 'C', label: 'Replies', goal: 'replies' }, { key: 'D', label: 'Views', goal: 'views' },
];
const questions = ['Your brand on X', 'Who are you?', 'What are you launching?', 'What matters most?'];
type FieldProps = { label: string; value: string; onChange: (value: string) => void; required?: boolean; first?: boolean; placeholder?: string; limit?: number; multiline?: boolean };
function Field({ label, value, onChange, required, first, placeholder, limit, multiline }: FieldProps) {
  const common = { value, required, maxLength: limit, placeholder: placeholder ?? label, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value), autoFocus: first };
  return <label className="on-field"><span className="on-sr-only">{label}</span>
    {multiline ? <textarea {...common} rows={3} /> : <input {...common} type="text" autoComplete="off" spellCheck={false} autoCapitalize="none" />}
  </label>;
}

export default function OnboardingPage() {
  const params = new URLSearchParams(location.search);
  const campaignFlow = params.get("flow") === "campaign";
  const resume = Number(params.get("build"));
  const [buildId, setBuildId] = useState<number | null>(campaignFlow && Number.isSafeInteger(resume) && resume > 0 ? resume : null);
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState(initialTheme);
  const [step, setStep] = useState(buildId ? 5 : 1);
  const [handle, setHandle] = useState('');
  const [brief, setBrief] = useState<Brief>({ name: '', role: '', campaign: '', news: '', goal: null });
  const [requested, setRequested] = useState<OnboardingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accepted = useRef('');
  const form = useRef<HTMLFormElement>(null);
  const { snapshot, error: readError, retry } = useBuild(buildId ?? requested?.onboarding_id ?? null, step >= 2);
  const row = snapshot?.row ?? requested;
  const setAnswer = (key: keyof Brief, value: string) => { setBrief(current => ({ ...current, [key]: value })); setError(''); };
  const valid = step === 1 ? Boolean(handle.trim()) && (!campaignFlow || brief.campaign.length <= 80) : step === 2 ? Boolean(brief.name.trim()) && brief.name.length <= 80 && brief.role.length <= 80
    : step === 3 ? Boolean(brief.campaign.trim() && brief.news.trim()) && brief.campaign.length <= 80 && brief.news.length <= 600 : step === 4 ? brief.goal !== null : false;

  useEffect(() => { document.title = 'Onboarding — Ripple'; }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080808' : '#f8f7f3');
    try { localStorage.setItem('ripple-theme', theme); } catch { /* Optional storage. */ }
  }, [theme]);
  useEffect(() => {
    const timer = window.setTimeout(() => form.current?.querySelector<HTMLElement>('input, textarea, [data-choice]')?.focus(), reduced ? 0 : 260);
    return () => clearTimeout(timer);
  }, [step, reduced]);
  useEffect(() => {
    if (step !== 4 || busy) return;
    const choose = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
      const option = choices.find(choice => choice.key === event.key.toUpperCase());
      if (option) { event.preventDefault(); setBrief(current => ({ ...current, goal: option.goal })); setError(''); }
    };
    document.addEventListener('keydown', choose);
    return () => document.removeEventListener('keydown', choose);
  }, [step, busy]);

  async function advance() {
    if (busy || !valid) return;
    setError('');
    if (step === 1 || step === 4) setBusy(true);
    try {
      if (step === 1) {
        const normalized = normalizeHandle(handle);
        if (accepted.current !== normalized) { await requestOnboarding(normalized); accepted.current = normalized; }
        const next = await findOnboarding(normalized);
        setRequested(next); setHandle(normalized);
        if (campaignFlow) {
          await updateBrief(next.onboarding_id, { ...brief, campaign: brief.campaign.trim() || `@${normalized}`, goal: 'reposts' });
          setBuildId(next.onboarding_id);
          history.replaceState(null, '', `/onboarding?flow=campaign&build=${next.onboarding_id}`);
        }
      } else if (step === 4 && requested) await updateBrief(requested.onboarding_id, brief);
      setStep(current => campaignFlow ? 5 : Math.min(5, current + 1));
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not continue. Try again.'); }
    finally { setBusy(false); }
  }
  function enter(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void advance(); }
  }
  const back = () => { if (!busy) { setError(''); setStep(current => Math.max(1, current - 1)); } };
  const restart = () => { accepted.current = ''; setRequested(null); setBuildId(null); setError(''); setStep(1); if (campaignFlow) history.replaceState(null, '', '/onboarding?flow=campaign'); };
  const title = step === 5 ? snapshot?.brand?.name || row?.handle || normalizeHandle(handle) : campaignFlow ? 'New campaign' : 'Connect your brand';

  return <main className="on-page">
    <div className="on-progress" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={campaignFlow ? 2 : 5} aria-valuenow={campaignFlow ? (step === 5 ? 2 : 1) : step}><span style={{ width: `${campaignFlow ? (step === 5 ? 100 : 50) : step / 5 * 100}%` }} /></div>
    <section className="on-sheet" aria-label="Brand onboarding">
      <RippleLogo className="on-logo" href={campaignFlow ? "/home" : "/"} />
      <button className="on-theme" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      <header className="on-heading">{step < 5 && <OnboardingAvatar theme={theme} working={busy || Boolean(row && !['ready', 'failed'].includes(row.status))} />}<h1 id="on-title">{title}</h1></header>
      <AnimatePresence mode="wait"><motion.div key={step} className="on-group" initial={reduced ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -24, opacity: 0 }} transition={{ duration: reduced ? 0 : .25 }}>
        {step === 5 && !row ? <p role="status">Opening your audience build…</p> : step === 5 && row ? <BuildView snapshot={snapshot} row={row} theme={theme} onRetry={restart} /> : <form ref={form} aria-labelledby="on-question" onSubmit={event => { event.preventDefault(); void advance(); }} onKeyDown={enter} aria-busy={busy}>
          <h2 id="on-question">{questions[step - 1]}</h2>
          {step === 1 && <Field label="Your brand on X" placeholder="@handle" value={handle} required first onChange={value => { setHandle(value); setError(''); }} />}
          {step === 1 && campaignFlow && <Field label="Campaign name" placeholder="Campaign name (optional)" value={brief.campaign} limit={80} onChange={value => setAnswer('campaign', value)} />}
          {step === 2 && <><Field label="Name" value={brief.name} required first limit={80} onChange={value => setAnswer('name', value)} /><Field label="Role" placeholder="Social lead" value={brief.role} limit={80} onChange={value => setAnswer('role', value)} /></>}
          {step === 3 && <><Field label="Campaign name" value={brief.campaign} required first limit={80} onChange={value => setAnswer('campaign', value)} /><Field label="The news" value={brief.news} required limit={600} multiline onChange={value => setAnswer('news', value)} /></>}
          {step === 4 && <div className="on-choices" role="group" aria-label="Campaign goal">{choices.map(choice => <button key={choice.goal} data-choice type="button" className="on-choice" aria-pressed={brief.goal === choice.goal} onClick={() => { setBrief(current => ({ ...current, goal: choice.goal })); setError(''); }}><kbd>{choice.key}</kbd><span>{choice.label}</span>{brief.goal === choice.goal && <Check size={14} aria-hidden="true" />}</button>)}</div>}
          {error && <p className="on-error" role="alert">{error}</p>}
          <button className="on-primary" type="submit" disabled={!valid || busy}>{busy ? 'Connecting' : campaignFlow ? 'Build audience' : 'Continue'} <ArrowRight size={14} /></button>
        </form>}
      </motion.div></AnimatePresence>
      {step >= 2 && <div className="on-live" role="status" aria-live="polite">{step < 5 && <>{row && !['ready', 'failed'].includes(row.status) && <ThinkingOrb state="breathing" size={20} theme={theme} paused={Boolean(reduced)} aria-label="Building your audience" />}<span>{liveStatus(row)}</span></>}{readError && <><span className="on-error">{readError}</span><button type="button" onClick={retry}>Try again</button></>}</div>}
    </section>
    {campaignFlow && <a className="on-home" href="/home">Back to campaigns</a>}
    {!campaignFlow && <nav className="on-navigation" aria-label="Form navigation"><button type="button" aria-label="Previous group" onClick={back} disabled={step === 1 || busy}><ChevronUp size={18} /></button><button type="button" aria-label="Next group" onClick={() => void advance()} disabled={step === 5 || !valid || busy}><ChevronDown size={18} /></button></nav>}
  </main>;
}
