import { useEffect, useRef, useState } from "react";
import { ClerkLoading, Show, UserButton } from "@clerk/react";
import {
  ArrowUpRight,
  ArrowRight,
  Sun,
  Moon,
  Play,
  Pause,
  RotateCcw,
  Maximize,
  Menu,
  X,
  Network,
  GitBranch,
  ChevronDown,
} from "lucide-react";

import { WordRotate } from "./components/ui/word-rotate";
import { Footer } from "./Footer";

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
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(28);
  const [error, setError] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setError(false);
    setProgress(0);
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
  const seek = (value: number) => {
    if (ref.current && Number.isFinite(ref.current.duration)) {
      ref.current.currentTime = value;
      setProgress(value);
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
          <RippleMark size={12} /> ripple / watch-it-spread
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
          aria-label="Ripple product walkthrough: compare drafts, watch a cascade, inspect a bridge, and rewrite a hook"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => setProgress(ref.current?.currentTime ?? 0)}
          onLoadedMetadata={() => {
            setDuration(ref.current?.duration || 28);
          }}
          onError={() => setError(true)}
        />
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
      <div className="player-controls">
        <button
          aria-label={playing ? "Pause demo" : "Play demo"}
          onClick={toggle}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          aria-label="Restart demo"
          onClick={() => {
            userPaused.current = false;
            seek(0);
            ref.current?.play().catch(() => {});
          }}
        >
          <RotateCcw size={14} />
        </button>
        <span className="time-code">
          {Math.floor(progress).toString().padStart(2, "0")} /{" "}
          {Math.floor(duration)}s
        </span>
        <input
          aria-label="Demo video progress"
          type="range"
          min="0"
          max={duration}
          step="0.1"
          value={progress}
          onInput={(e) => seek(Number(e.currentTarget.value))}
        />
        <button
          aria-label="Fullscreen demo"
          onClick={() => {
            ref.current?.requestFullscreen?.().catch(() => {});
          }}
        >
          <Maximize size={15} />
        </button>
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
      ?.setAttribute("content", theme === "dark" ? "#091322" : "#f8f7f3");
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
          <details className="nav-dropdown">
            <summary>Project <ChevronDown size={16} /></summary>
            <div className="nav-menu">
              <a href="#about" onClick={closeMenu}>About Ripple</a>
              <a href="/research/ripple-design.md" onClick={closeMenu}>Project design</a>
            </div>
          </details>
          <a href="/research/ripple-fact-check.md" onClick={closeMenu}>Research</a>
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
            <a className="nav-cta" href="/dashboard">Open workspace</a>
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
            Test your next idea on a digital twin of your audience.
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
            <span>Product walkthrough · Real audience and recorded Lab results</span>
          </div>
        </section>
        <section className="features container" id="how-it-works">
          <div className="features-heading">
            <span className="eyebrow">BEYOND THE FOLLOWER COUNT</span>
            <h2>Make a little less of a guess.</h2>
            <p>
              Your network is more than a number. Ripple helps you see the paths
              an idea might take.
            </p>
          </div>
          <div className="feature-grid">
            <article>
              <div className="feature-visual network-visual" aria-hidden="true">
                <Network size={70} strokeWidth={0.8} />
                <span className="visual-ring" />
                <span className="visual-ring ring-two" />
                <small>YOUR AUDIENCE, CONNECTED</small>
              </div>
              <span className="feature-number">01 / MAP</span>
              <h3>A twin of your audience.</h3>
              <p>
                Start with a Bluesky handle. Build a picture of the communities
                and connections around you, using public behavior.
              </p>
            </article>
            <article>
              <div className="feature-visual chart-visual" aria-hidden="true">
                <div className="mini-chart">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="chart-axis">possible reach →</span>
                <small>RANGES, NOT PROMISES</small>
              </div>
              <span className="feature-number">02 / SIMULATE</span>
              <h3>Give every draft a chance.</h3>
              <p>
                Run many possible cascades. Compare reach distributions and see
                which draft has a better chance of leaving its niche.
              </p>
            </article>
            <article>
              <div className="feature-visual bridge-visual" aria-hidden="true">
                <GitBranch size={66} strokeWidth={0.9} />
                <span className="bridge-pulse" />
                <small>FIND THE WAY THROUGH</small>
              </div>
              <span className="feature-number">03 / UNDERSTAND</span>
              <h3>See what makes it travel.</h3>
              <p>
                Explore the bridges between communities. Change a hook, replay
                the cascade, and understand what changed.
              </p>
            </article>
          </div>
        </section>
        <section className="closing container" id="about">
          <div className="closing-orbit" aria-hidden="true">
            <RippleMark size={64} />
          </div>
          <span className="eyebrow">A LITTLE CLARITY BEFORE YOU POST</span>
          <h2>
            Good ideas deserve
            <br />a better first signal.
          </h2>
          <p>
            Agent-powered simulations. Public Bluesky behavior.
            <br />A little more clarity before you hit publish.
          </p>
          <a className="button primary" href="#demo">
            Meet your possible audience <ArrowUpRight size={16} />
          </a>
          <a
            className="research-link"
            href="/research/ripple-design.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the project design <ArrowUpRight size={13} />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  );
}
