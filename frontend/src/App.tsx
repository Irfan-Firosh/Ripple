import { useEffect, useRef, useState } from "react";
import { LandingLoader } from "./LandingLoader";
import { STATIC_SNAPSHOT } from "./snapshot";
import { ClerkLoading, Show, UserButton } from "@clerk/react";
import {
  ArrowUpRight,
  ArrowRight,
  Sun,
  Moon,
  Play,
  Pause,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";

import { WordRotate } from "./components/ui/word-rotate";
import { Footer } from "./Footer";
import { FeatureVisual } from "./landing/FeatureVisuals";

const HERO_WORDS = ["ripple.", "reach.", "signal."];

type Theme = "dark" | "light";
export function RippleMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 5v22M6.5 10.5l19 11M6.5 21.5l19-11"
        stroke="currentColor"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("ripple-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Storage is optional. */
  }
  return "dark";
}
function DemoVideo({ theme }: { theme: Theme }) {
  const ref = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setError(false);
    setPlaying(false);
    userPaused.current = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) video.pause();
        else if (!reduced && !userPaused.current) video.play().catch(() => {});
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    const visibility = () => {
      if (document.hidden) video.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [theme]);
  const toggle = () => {
    const v = ref.current;
    if (v) {
      if (v.paused) {
        userPaused.current = false;
        v.play().catch(() => setError(true));
      } else {
        userPaused.current = true;
        v.pause();
      }
    }
  };
  return (
    <div className="demo-player">
      <div className="player-top">
        <span className="window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="player-address">
          <RippleMark size={12} /> ripple / in action
        </span>
        <span className="player-version">PRODUCT PREVIEW</span>
      </div>
      <div className="video-wrap">
        <video
          ref={ref}
          key={theme}
          src={`/videos/ripple-demo-${theme}.mp4`}
          poster={`/videos/ripple-demo-${theme}.png`}
          loop
          muted
          playsInline
          preload="metadata"
          aria-label="Ripple product walkthrough: audience map, generated campaign media, and side-by-side Lab analysis"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setError(true)}
        />
        {!error && <button className="demo-toggle" aria-label={playing ? "Pause demo" : "Play demo"} onClick={toggle}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>}
        {error && (
          <div className="video-error">
            The preview could not load.{" "}
            <button
              onClick={() => {
                setError(false);
                ref.current?.load();
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#080808" : "#f8f7f3");
    try {
      localStorage.setItem("ripple-theme", theme);
    } catch {
      /* Storage is optional. */
    }
  }, [theme]);
  const closeMenu = () => {
    setMenu(false);
    document.querySelectorAll<HTMLDetailsElement>(".header .nav-dropdown[open]").forEach(dropdown => { dropdown.open = false; });
  };
  return (
    <div className="site-shell" data-theme={theme}>
      {STATIC_SNAPSHOT && <LandingLoader theme={theme} />}
      <div className="hero-backdrop" aria-hidden="true">
        <div className="sky sky-night" />
        <div className="sky sky-day" />
        <div className="sky-light" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={`star star-${i}`} />
        ))}
      </div>
      <div className="header-slot">
      <header className={`header${scrolled ? " is-scrolled" : ""}`}>
        <a className="brand" href="#" aria-label="Ripple home">
          <RippleMark size={29} />
          <span>Ripple</span>
        </a>
        <nav
          className={menu ? "nav is-open" : "nav"}
          aria-label="Main navigation"
        >
          <details className="nav-dropdown">
            <summary>Product <ChevronDown size={16} /></summary>
            <div className="nav-menu">
              <a href="#demo" onClick={closeMenu}>The demo</a>
              <a href="#how-it-works" onClick={closeMenu}>How it works</a>
              <a href="/visuals" onClick={closeMenu}>Visual playground</a>
            </div>
          </details>
          <a href="#about" onClick={closeMenu}>About</a>
          <a href="#faq" onClick={closeMenu}>FAQ</a>
        </nav>
        <div className="nav-actions">
          <button
            className="theme-toggle"
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <ClerkLoading>
            <a className="nav-cta" href="/auth">Get started</a>
          </ClerkLoading>
          <Show when="signed-out">
            <a className="nav-cta" href="/auth">Get started</a>
          </Show>
          <Show when="signed-in">
            <a className="nav-cta" href="/home">Open workspace</a>
            <UserButton />
          </Show>
          <button
            className="menu-toggle"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      </div>
      <main>
        <section className="hero" ref={heroRef}>
          <h1 aria-label="See the ripple, reach, and signal. Before you post.">
            <span className="headline-line" aria-hidden="true">
              See the{" "}
              <WordRotate
                className="hero-rotating-word"
                words={HERO_WORDS}
                duration={2800}
              />
            </span>
            <span className="headline-second-line">Before you post.</span>
          </h1>
          <p>
            Analyze your audience before your next post.
            <br className="desktop-break" /> Compare drafts. Watch them spread.
            Find your way through.
          </p>
          <a className="button primary" href="#demo">
            Watch it spread <ArrowRight size={17} />
          </a>
        </section>
        <section className="demo-section container" id="demo">
          <div className="section-intro">
            <div>
              <span className="eyebrow">
                A SMALL CHANGE. A DIFFERENT CASCADE.
              </span>
              <h2>
                One idea.
                <br className="mobile-break" /> More possibilities.
              </h2>
            </div>
            <p>
              From your first draft to its next community.
              <br />
              See the whole story unfold.
            </p>
          </div>
          <DemoVideo theme={theme} />
          <div className="demo-caption">
            <span>
              <span className="live-dot" /> A look inside Ripple
            </span>
            <span>Real audience. Generated media. Recorded Lab results.</span>
          </div>
        </section>
        <section className="features container" id="how-it-works">
          <div className="features-heading">
            <span className="eyebrow">FROM AUDIENCE TO LAUNCH</span>
            <h2>Know who. Create what. Test first.</h2>
          </div>
          <div className="feature-grid">
            <article>
              <FeatureVisual kind="audience" />
              <span className="feature-number">01 / MAP</span>
              <h3>Meet your audience.</h3>
              <p>Connect your X handle. Explore the people and interests behind your following.</p>
            </article>
            <article>
              <FeatureVisual kind="creative" />
              <span className="feature-number">02 / CREATE</span>
              <h3>Make it worth sharing.</h3>
              <p>Turn audience insights into campaign ideas, images and videos.</p>
            </article>
            <article>
              <FeatureVisual kind="lab" />
              <span className="feature-number">03 / TEST</span>
              <h3>Find your first signal.</h3>
              <p>Compare two drafts in Lab. See engagement and how each could spread.</p>
            </article>
          </div>
        </section>
        <section className="faq container" id="faq" aria-label="Frequently asked questions">
          <div className="faq-list">
            <details><summary>What do I need to start?<ChevronDown size={16} /></summary><p>Your brand’s X handle. Ripple builds an audience map from public profiles.</p></details>
            <details><summary>Can Ripple create campaign media?<ChevronDown size={16} /></summary><p>Yes. Generate campaign ideas, images and videos, or bring your own drafts.</p></details>
            <details><summary>Are Lab results guaranteed?<ChevronDown size={16} /></summary><p>No. They’re simulated estimates. Use them to compare drafts before posting.</p></details>
            <details><summary>Does Ripple post for me?<ChevronDown size={16} /></summary><p>You choose the draft and publish it yourself.</p></details>
          </div>
        </section>
        <section className="closing container" id="about">
          <div className="closing-orbit" aria-hidden="true">
            <RippleMark size={64} />
          </div>
          <h2>
            Good ideas deserve
            <br />a better first signal.
          </h2>
          <a className="button primary" href="#demo">
            Meet your possible audience <ArrowUpRight size={16} />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  );
}
