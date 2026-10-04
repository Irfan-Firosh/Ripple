import { WorkspaceAccount } from './components/WorkspaceAccount';
import { useCallback, useEffect, useRef, useState } from "react";
import { initialTheme } from "./App";
import "./logs.css";

type LogsResponse = {
  database: string;
  server: string;
  worker: { state: "running" | "offline" | "unknown"; lastSeen?: string };
  sources: { name: string; lines: string[]; error?: string }[];
  updatedAt: string;
};

export function LogsPage() {
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch("/api/logs", {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load server logs.");
      if (!Array.isArray(body.sources)) throw new Error("The logs response was unavailable.");
      if (!controller.signal.aborted) {
        setLogs(body);
        setError("");
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Could not load server logs.");
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = initialTheme();
    document.title = "Server logs · Ripple";
    void refresh();
    const timer = window.setInterval(() => {
      if (!pausedRef.current) void refresh();
    }, 3000);
    return () => {
      window.clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  const togglePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    if (!next) void refresh();
  };

  return (
    <main className="logs-page">
      <a className="logs-back" href="/dashboard?view=studio">← Back to studio</a>
      <header className="logs-heading">
        <div>
          <h1>Server logs</h1>
          <p>{paused ? "Updates paused." : "Updates every 3 seconds."}</p>
        </div>
        <div className="logs-actions">
          <button type="button" onClick={togglePause} aria-pressed={paused}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : error ? "Retry" : "Refresh"}
          </button>
        </div>
      <WorkspaceAccount /></header>
      {error && <p className="logs-error" role="alert">{error}{logs && " Showing the last received logs."}</p>}
      {!logs && !error && <p className="logs-meta" role="status">Loading server logs…</p>}
      {logs && (
        <>
          <div className="logs-meta">
            <span>Worker: <strong className={`logs-worker-${logs.worker.state}`}>{logs.worker.state}</strong></span>
            {logs.worker.lastSeen && <span>Last seen: {logs.worker.lastSeen}</span>}
            <span>Database: {logs.database}</span>
            <span>Server: {logs.server}</span>
            <span>Updated: {logs.updatedAt}</span>
          </div>
          {logs.worker.state === "offline" && <p className="logs-error">The worker is offline. Jobs may be waiting for it to restart.</p>}
          <div className="logs-sources">
            {logs.sources.map((source, index) => (
              <section className="logs-source" key={`${source.name}-${index}`} aria-label={source.name}>
                <h2>{source.name}</h2>
                {source.error && <p className="logs-error">{source.error}</p>}
                <pre tabIndex={0}>{source.lines.length ? source.lines.join("\n") : "No logs yet."}</pre>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
