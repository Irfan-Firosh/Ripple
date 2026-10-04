import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { OnboardingAvatar } from "./onboarding/OnboardingAvatar";
import "./landing-loader.css";

const HERO = { dark: "/dark_background.png", light: "/liight_background.png" } as const;
const MIN_MS = 1600; // long enough to read the credit, even on a warm cache
const MAX_MS = 12000; // a stalled image never blocks the page
const FADE_MS = 400;

// Covers the landing page until its large hero image has arrived (static deploy only).
export function LandingLoader({ theme }: { theme: "dark" | "light" }) {
  const [phase, setPhase] = useState<"loading" | "leaving" | "gone">("loading");
  useEffect(() => {
    let done = false;
    const started = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      window.setTimeout(() => setPhase("leaving"), Math.max(0, MIN_MS - (Date.now() - started)));
    };
    const image = new Image();
    image.onload = finish;
    image.onerror = finish;
    image.src = HERO[theme];
    if (image.complete) finish();
    const fallback = window.setTimeout(finish, MAX_MS);
    return () => { done = true; clearTimeout(fallback); };
  }, [theme]);
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === "gone") return null;
  return (
    <div className={`landing-loader${phase === "leaving" ? " is-leaving" : ""}`} role="status" aria-live="polite">
      <OnboardingAvatar size={96} working theme={theme} />
      <p>Made with <Heart size={13} fill="currentColor" aria-label="love" /> by Ansh and Irfan</p>
    </div>
  );
}
