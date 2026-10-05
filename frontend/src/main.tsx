import { ClerkProvider } from "@clerk/react";
import { shadcn } from "@clerk/ui/themes";
import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AFTER_AUTH, STATIC_SNAPSHOT } from "./snapshot";
import "./styles.css";
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const AuthPage = lazy(() => import("./components/ui/auth-07"));
const NetworkTestPage = lazy(() => import("./NetworkTestPage"));
const LabPage = lazy(() => import("./lab/LabPage"));
const HomePage = lazy(() => import("./home/HomePage"));
const CampaignFlowPage = lazy(() => import("./flow/CampaignFlowPage"));
const OnboardingPage = lazy(() => import("./onboarding/OnboardingPage"));
const OpsPage = lazy(() => import("./ops/OpsPage"));
const LogsPage = lazy(() => import("./LogsPage").then(module => ({ default: module.LogsPage })));
const path = location.pathname.replace(/\/$/, "");
// The static demo cannot onboard new brands.
if (STATIC_SNAPSHOT && path === "/onboarding") location.replace("/home");
document.title = "Ripple";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/" signInUrl="/auth/sign-in" signUpUrl="/auth" signInForceRedirectUrl={AFTER_AUTH} signUpForceRedirectUrl={AFTER_AUTH} appearance={{ theme: shadcn }}>
    {path === "/onboarding" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening onboarding…</div>}><OnboardingPage /></Suspense>
    ) : path === "/test" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening the network…</div>}><NetworkTestPage /></Suspense>
    ) : path === "/campaign" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your campaign…</div>}><CampaignFlowPage /></Suspense>
    ) : path === "/lab" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening the Lab…</div>}><LabPage /></Suspense>
    ) : path === "/ops" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening ops…</div>}><OpsPage /></Suspense>
    ) : path === "/logs" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening server logs…</div>}><LogsPage /></Suspense>
    ) : (
        path === "/auth" || path === "/auth/sign-in" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your account…</div>}>
            <AuthPage signIn={path === "/auth/sign-in"} />
          </Suspense>
        ) : path === "/home" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening Home…</div>}><HomePage /></Suspense>
        ) : path === "/dashboard" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your workspace…</div>}>
            <NetworkTestPage workspace />
          </Suspense>
        ) : <App />
    )}
    </ClerkProvider>
  </React.StrictMode>,
);
