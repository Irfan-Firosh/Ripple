import { useId } from "react";
import { ArrowUpRight, ArrowUp } from "lucide-react";

export function Footer() {
  const id = useId().replace(/:/g, "");
  return (
    <footer className="ripple-footer">
      <div className="footer-frame">
        <div className="footer-top">
          <div className="footer-note">
            <span className="footer-label"><i /> A little clarity. A bigger ripple.</span>
            <p>See what happens next.</p>
          </div>
          <nav className="footer-links" aria-label="Footer navigation">
            <a href="#demo">The demo <ArrowUpRight size={13} /></a>
            <a href="/visuals">Visual playground <ArrowUpRight size={13} /></a>
            <a href="/research/ripple-design.md">Project design <ArrowUpRight size={13} /></a>
            <a href="/research/ripple-fact-check.md">Research <ArrowUpRight size={13} /></a>
          </nav>
        </div>
        <div className="footer-art" aria-hidden="true">
          <svg className="footer-wordmark" viewBox="0 0 1600 480" focusable="false">
            <defs>
              <pattern id={`${id}-dots`} width="8" height="8" patternUnits="userSpaceOnUse">
                <rect x="0" y="0" width="2" height="2" fill="currentColor" />
                <rect x="4" y="4" width="2" height="2" fill="currentColor" opacity=".8" />
                <rect x="4" y="0" width="1.5" height="1.5" fill="currentColor" opacity=".35" />
                <rect x="0" y="4" width="1.5" height="1.5" fill="currentColor" opacity=".2" />
              </pattern>
              <radialGradient id={`${id}-light`} cx="50%" cy="50%" r="65%">
                <stop offset="0" stopColor="white" stopOpacity=".85" />
                <stop offset=".65" stopColor="white" stopOpacity=".45" />
                <stop offset="1" stopColor="white" stopOpacity=".12" />
              </radialGradient>
              <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="480">
                <rect width="1600" height="480" fill={`url(#${id}-light)`} />
              </mask>
            </defs>
            <text x="40" y="365" textLength="1520" lengthAdjust="spacingAndGlyphs"
              fill={`url(#${id}-dots)`} mask={`url(#${id}-fade)`}>ripple</text>
          </svg>
          <div className="footer-art-fade" />
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Ripple</span>
          <span>Made to explore what happens next.</span>
          <a href="#" aria-label="Back to top">Back to top <ArrowUp size={13} /></a>
        </div>
      </div>
      <div className="footer-landscape" aria-hidden="true" />
    </footer>
  );
}
