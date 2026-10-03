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
const DashboardPage = lazy(() => import("./DashboardPage"));
const path = location.pathname.replace(/\/$/, "");
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname.replace(/\/$/, "") === "/visuals" ? (
      <Suspense fallback={<div style={{padding:40}}>Opening the visual playground…</div>}><VisualsPage /></Suspense>
    ) : params.has("film") ? (
      <DemoFilm theme={params.get("theme") === "light" ? "light" : "dark"} />
    ) : (
      <ClerkProvider afterSignOutUrl="/" signInUrl="/auth/sign-in" signUpUrl="/auth" appearance={{ theme: shadcn }}>
        {path === "/auth" || path === "/auth/sign-in" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your account…</div>}>
            <AuthPage signIn={path === "/auth/sign-in"} />
          </Suspense>
        ) : path === "/dashboard" ? (
          <Suspense fallback={<div role="status" style={{ padding: 40 }}>Opening your workspace…</div>}>
            <DashboardPage />
          </Suspense>
        ) : <App />}
      </ClerkProvider>
    )}
  </React.StrictMode>,
);
