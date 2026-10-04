import { ClerkProvider } from "@clerk/react";
import { shadcn } from "@clerk/ui/themes";
import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DemoFilm } from "./DemoFilm";
import "./styles.css";
import "./demo.css";
const VisualsPage = lazy(() => import("./VisualsPage"));
const AuthPage = lazy(() => import("./components/ui/auth-07"));
const NetworkTestPage = lazy(() => import("./NetworkTestPage"));
const LabPage = lazy(() => import("./lab/LabPage"));
const LabGamePage = lazy(() => import("./lab-game/LabGamePage"));
const HomePage = lazy(() => import("./home/HomePage"));
const CampaignFlowPage = lazy(() => import("./flow/CampaignFlowPage"));
const OnboardingPage = lazy(() => import("./onboarding/OnboardingPage"));
const CampaignStudio = lazy(() => import("./CampaignStudio"));
const LabV2 = lazy(() => import("./LabV2"));
const OpsPage = lazy(() => import("./ops/OpsPage"));
const LogsPage = lazy(() => import("./LogsPage").then(module => ({ default: module.LogsPage })));
const path = location.pathname.replace(/\/$/, "");
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {path === "/onboarding" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening onboarding…</div>}><OnboardingPage /></Suspense>
    ) : path === "/test" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening the network…</div>}><NetworkTestPage /></Suspense>
    ) : path === "/lab-game" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening the islands…</div>}><LabGamePage /></Suspense>
    ) : path === "/campaign" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your campaign…</div>}><CampaignFlowPage /></Suspense>
    ) : path === "/campaigns" || (path === "/dashboard" && params.get("view") === "studio") ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening campaigns…</div>}><CampaignStudio /></Suspense>
    ) : path === "/lab" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening the Lab…</div>}><LabPage /></Suspense>
    ) : path === "/lab-v2" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening Lab v2…</div>}><LabV2 /></Suspense>
    ) : location.pathname.replace(/\/$/, "") === "/visuals" ? (
      <Suspense fallback={<div style={{padding:40}}>Opening the visual playground…</div>}><VisualsPage /></Suspense>
    ) : path === "/ops" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening ops…</div>}><OpsPage /></Suspense>
    ) : path === "/logs" ? (
      <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening server logs…</div>}><LogsPage /></Suspense>
    ) : params.has("film") ? (
      <DemoFilm theme={params.get("theme") === "light" ? "light" : "dark"} />
    ) : (
      <ClerkProvider afterSignOutUrl="/" signInUrl="/auth/sign-in" signUpUrl="/auth" signInForceRedirectUrl="/onboarding" signUpForceRedirectUrl="/onboarding" appearance={{ theme: shadcn }}>
        {path === "/auth" || path === "/auth/sign-in" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your account…</div>}>
            <AuthPage signIn={path === "/auth/sign-in"} />
          </Suspense>
        ) : path === "/home" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening Home…</div>}><HomePage /></Suspense>
        ) : path === "/dashboard" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your workspace…</div>}>
            <NetworkTestPage workspace />
          </Suspense>
        ) : <App />}
      </ClerkProvider>
    )}
  </React.StrictMode>,
);
