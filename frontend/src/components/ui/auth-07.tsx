import { useEffect, useState } from "react";
import { ClerkFailed, ClerkLoading, Show, SignIn, SignUp, useAuth } from "@clerk/react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import { RippleMark, initialTheme } from "../../App";
import "../../auth.css";

// Adapted from Watermelon auth-07: split form / cloudscape composition.
export default function Auth7({ signIn = false }: { signIn?: boolean }) {
  const [theme, setTheme] = useState(initialTheme);
  const { isLoaded, isSignedIn } = useAuth();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (isLoaded && isSignedIn) location.replace("/onboarding");
  }, [isLoaded, isSignedIn]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = `${signIn ? "Sign in" : "Get started"} — Ripple`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#091322" : "#f8f7f3");
    try { localStorage.setItem("ripple-theme", theme); } catch { /* Optional storage. */ }
  }, [theme, signIn]);

  const appearance = {
    variables: {
      colorPrimary: theme === "dark" ? "#e6bc88" : "#805322",
      colorPrimaryForeground: theme === "dark" ? "#172233" : "#fff8ec",
      colorBackground: theme === "dark" ? "#091322" : "#f8f7f3",
      colorForeground: theme === "dark" ? "#f3f1ed" : "#1d2d40",
      colorMuted: theme === "dark" ? "#101d2e" : "#eeefec",
      colorMutedForeground: theme === "dark" ? "#a8b5c5" : "#637284",
      colorInput: theme === "dark" ? "#101d2e" : "#ffffff",
      colorInputForeground: theme === "dark" ? "#f3f1ed" : "#1d2d40",
      fontFamily: '"DM Sans", sans-serif',
      borderRadius: "1.5rem",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "none", background: "transparent" },
      card: { padding: "0", boxShadow: "none", border: "none", background: "transparent" },
      headerTitle: { fontFamily: '"Space Grotesk", sans-serif', fontSize: "1.8rem", letterSpacing: "-0.06em" },
      formFieldInput: { borderRadius: "999px", minHeight: "46px", paddingInline: "18px" },
      formButtonPrimary: { borderRadius: "999px", minHeight: "46px" },
      socialButtonsBlockButton: { borderRadius: "999px", minHeight: "46px" },
      footer: { background: "transparent", padding: "20px 0 0" },
    },
  };

  return (
    <main className="auth-page">
      <section className="auth-form-side" aria-label="Ripple account">
        <header className="auth-header">
          <a className="brand" href="/" aria-label="Ripple home"><RippleMark size={28} /><span>Ripple</span></a>
          <button className="auth-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <div className="auth-form-center">
          <motion.div className="auth-form-content"
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
            <ClerkLoading><p className="auth-status" role="status">Opening your account…</p></ClerkLoading>
            <ClerkFailed>
              <div className="auth-status" role="alert">
                <h1>Couldn’t load sign in.</h1><p>Check your connection and try again.</p>
                <button className="button primary" onClick={() => location.reload()}>Try again</button>
              </div>
            </ClerkFailed>
            <Show when="signed-out">
              <div className="auth-intro"><span className="eyebrow">{signIn ? "WELCOME BACK" : "YOUR NEXT RIPPLE STARTS HERE"}</span></div>
              {signIn ? (
                <SignIn routing="hash" signUpUrl="/auth" forceRedirectUrl="/onboarding" signUpForceRedirectUrl="/onboarding" appearance={appearance} />
              ) : (
                <SignUp routing="hash" signInUrl="/auth/sign-in" forceRedirectUrl="/onboarding" signInForceRedirectUrl="/onboarding" appearance={appearance} />
              )}
            </Show>
            <Show when="signed-in">
              <p className="auth-status" role="status">Opening onboarding…</p>
            </Show>
          </motion.div>
        </div>
        <a className="auth-back" href="/"><ArrowLeft size={14} /> Back to Ripple</a>
      </section>
      <aside className="auth-image-side" aria-label="Ripple landscape">
        <div className="auth-landscape" />
        <div className="auth-image-shade" />
        <div className="auth-image-caption">
          <RippleMark size={36} />
          <h2>Small ideas.<br />Endless possibilities.</h2>
          <p>A little clarity before you hit publish.</p>
        </div>
        <span className="auth-image-index">RIPPLE / SEE WHAT HAPPENS NEXT</span>
      </aside>
    </main>
  );
}
