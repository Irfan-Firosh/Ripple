import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Plus,
  Search,
  MessageSquare,
  Network,
  History,
  Settings,
  Check,
  Sparkles,
  Send,
  RotateCcw,
  GitBranch,
  ShieldCheck,
  MousePointer2,
  SlidersHorizontal,
} from "lucide-react";
import { RippleMark } from "./App";

declare global {
  interface Window {
    __setDemoTime: (seconds: number) => void;
  }
}
const drafts = [
  {
    letter: "A",
    title: "The announcement",
    text: "I built an open-source tool that simulates how a post spreads. Here’s what I learned.",
    range: "240–680",
    median: "410",
    width: 31,
  },
  {
    letter: "B",
    title: "The question",
    text: "What if you could test a post before anyone sees it? I built a tiny social-network simulator to find out.",
    range: "780–2,400",
    median: "1,420",
    width: 87,
  },
  {
    letter: "C",
    title: "The takeaway",
    text: "Your follower count doesn’t tell you who will see your next post. Your network’s bridges might.",
    range: "460–1,180",
    median: "760",
    width: 52,
  },
];
const communities = [
  { name: "AI builders", x: 185, y: 180, color: "#7ea7cd", count: 35 },
  { name: "Open source", x: 412, y: 145, color: "#dcba84", count: 31 },
  { name: "Design & tools", x: 430, y: 335, color: "#81b7a7", count: 32 },
  { name: "Indie makers", x: 190, y: 365, color: "#a7a0d0", count: 28 },
];
const nodes = communities.flatMap((c, cluster) =>
  Array.from({ length: c.count }, (_, i) => {
    const angle = i * 2.39996323 + cluster * 0.9;
    const radius = 11 + Math.sqrt(i / (c.count - 1)) * 76;
    return {
      x: c.x + Math.cos(angle) * radius,
      y: c.y + Math.sin(angle) * radius * 0.76,
      cluster,
      index: i,
      id: `${cluster}-${i}`,
      delay:
        cluster === 0
          ? i * 0.055
          : cluster === 1
            ? 2.5 + i * 0.06
            : cluster === 2
              ? 4.4 + i * 0.055
              : 6.2 + i * 0.06,
    };
  }),
);
const edges = nodes.flatMap((n) =>
  nodes
    .filter(
      (m) =>
        m.cluster === n.cluster &&
        m.index < n.index &&
        Math.hypot(n.x - m.x, n.y - m.y) < 43,
    )
    .slice(-3)
    .map((m) => ({ a: m, b: n })),
);
function smooth(a: number, b: number, t: number) {
  return a + (b - a) * (t * t * (3 - 2 * t));
}
function cursorAt(t: number) {
  const points = [
    [0, 690, 510],
    [2.2, 690, 510],
    [3.8, 864, 721],
    [4.2, 864, 721],
    [6.8, 1118, 558],
    [7.5, 790, 325],
    [10.7, 684, 372],
    [14.8, 590, 700],
    [18.8, 585, 360],
    [19.5, 585, 360],
    [22.8, 1118, 654],
    [24, 1118, 500],
    [25.9, 1118, 603],
    [28, 1118, 603],
  ];
  const next = points.findIndex((p) => p[0] > t);
  if (next < 1) return points.at(-1)!.slice(1);
  const a = points[next - 1],
    b = points[next],
    f = Math.min(1, (t - a[0]) / (b[0] - a[0]));
  return [smooth(a[1], b[1], f), smooth(a[2], b[2], f)];
}
function NetworkScene({ time }: { time: number }) {
  const draftA = time < 10;
  const cascade = draftA
    ? Math.min(2.3, Math.max(0, (time - 7) * 1.1))
    : Math.max(0, (time - 10) * 1.7);
  const selected = time >= 17;
  return (
    <div className="graph-scene">
      <div className="graph-topline">
        <span>
          <span className="live-dot" />{" "}
          {time < 15 ? "Cascade in progress" : "Cascade complete"}
        </span>
        <span>
          Draft {draftA ? "A" : "B"} · run{" "}
          {Math.min(200, Math.max(1, Math.floor(cascade * (draftA ? 88 : 25))))}
          /200
        </span>
      </div>
      <svg
        viewBox="0 0 600 470"
        aria-label="Four communities light up as draft B spreads across their connecting bridges"
      >
        <defs>
          <pattern
            id="grid"
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".6" fill="currentColor" opacity=".17" />
          </pattern>
          <radialGradient id="graphGlow">
            <stop stopColor="#e6bc88" stopOpacity=".12" />
            <stop offset="1" stopColor="#e6bc88" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="600" height="470" fill="url(#grid)" />
        {communities.map((c, i) => (
          <g key={c.name}>
            <ellipse
              cx={c.x}
              cy={c.y}
              rx="99"
              ry="84"
              fill={c.color}
              opacity={cascade > i * 2 ? 0.035 : 0.015}
            />
            <text
              x={c.x}
              y={c.y - 91}
              textAnchor="middle"
              className="cluster-label"
            >
              {c.name}
            </text>
          </g>
        ))}
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.a.x}
            y1={e.a.y}
            x2={e.b.x}
            y2={e.b.y}
            stroke={
              cascade > Math.max(e.a.delay, e.b.delay) &&
              (!draftA || e.a.cluster === 0)
                ? communities[e.a.cluster].color
                : "currentColor"
            }
            opacity={
              cascade > Math.max(e.a.delay, e.b.delay) &&
              (!draftA || e.a.cluster === 0)
                ? 0.35
                : 0.08
            }
            strokeWidth=".7"
          />
        ))}
        {[
          [0, 1],
          [1, 2],
          [0, 3],
          [2, 3],
        ].map(([a, b], i) => {
          const ca = communities[a],
            cb = communities[b],
            active = cascade > 2.4 + i * 1.5;
          return (
            <g key={i}>
              <path
                d={`M ${ca.x} ${ca.y} Q ${(ca.x + cb.x) / 2} ${(ca.y + cb.y) / 2 - 28} ${cb.x} ${cb.y}`}
                fill="none"
                stroke={active ? "#dcba84" : "currentColor"}
                strokeWidth={active ? "1.5" : "1"}
                opacity={active ? 0.7 : 0.1}
                strokeDasharray="4 5"
              />
              {active && (
                <circle
                  cx={(ca.x + cb.x) / 2}
                  cy={(ca.y + cb.y) / 2 - 14}
                  r="4"
                  fill="#dcba84"
                />
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const active = cascade > n.delay && (!draftA || n.cluster === 0);
          return (
            <circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={active ? (n.index === 0 ? 4.5 : 2.5) : 1.6}
              fill={active ? communities[n.cluster].color : "currentColor"}
              opacity={active ? 0.95 : 0.22}
            />
          );
        })}
        <circle cx="185" cy="180" r="8" fill="#e6bc88" />
        <circle
          cx="185"
          cy="180"
          r="12"
          fill="none"
          stroke="#e6bc88"
          strokeWidth=".8"
        />
        <text x="185" y="204" textAnchor="middle" className="you-label">
          YOU
        </text>
        {selected && (
          <g>
            <circle
              cx="299"
              cy="148"
              r="16"
              fill="none"
              stroke="#e6bc88"
              strokeWidth="1"
            />
            <circle cx="299" cy="148" r="5" fill="#e6bc88" />
            <rect
              x="262"
              y="108"
              width="100"
              height="22"
              rx="5"
              className="bridge-tag"
            />
            <text
              x="312"
              y="122"
              textAnchor="middle"
              className="bridge-tag-text"
            >
              Bridge cluster 01
            </text>
          </g>
        )}
      </svg>
      <div className="graph-legend">
        {communities.map((c) => (
          <span key={c.name}>
            <i style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
      <div className="graph-bottom">
        <span>
          <Network size={12} /> 126 sample accounts
        </span>
        <span>
          Public behavior only <ShieldCheck size={11} />
        </span>
      </div>
    </div>
  );
}
export function DemoFilm({ theme }: { theme: "dark" | "light" }) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    window.__setDemoTime = (seconds) =>
      setTime(Math.max(0, Math.min(27.99, seconds)));
  }, []);
  const phase =
    time < 4
      ? 0
      : time < 7
        ? 1
        : time < 15
          ? 2
          : time < 19
            ? 3
            : time < 23
              ? 4
              : 5;
  const [cx, cy] = cursorAt(time);
  const typed = drafts[1].text.slice(
    0,
    Math.floor(Math.max(0, time - 0.4) * 39),
  );
  const edited =
    "What if your next post could reach the people who actually need it?".slice(
      0,
      Math.floor(Math.max(0, time - 23) * 30),
    );
  const clicking = [3.8, 6.8, 18.8, 22.8, 26].some(
    (v) => Math.abs(time - v) < 0.22,
  );
  return (
    <div className={`film film-${theme}`} data-phase={phase}>
      <aside className="app-sidebar">
        <div className="app-logo">
          <RippleMark size={27} />
          <span>Ripple</span>
          <small>LAB</small>
        </div>
        <div className="workspace-selector">
          <span className="workspace-avatar">JL</span>
          <div>
            Jamie’s workspace<small>Personal workspace</small>
          </div>
          <ChevronDown size={12} />
        </div>
        <div className="sidebar-section">WORKSPACE</div>
        <div className="sidebar-item selected">
          <Network size={15} /> Watch it spread
        </div>
        <div className="sidebar-item">
          <MessageSquare size={15} /> Agent chat <span>ASI:One</span>
        </div>
        <div className="sidebar-item">
          <History size={15} /> Past simulations
        </div>
        <div className="sidebar-section second">YOUR NETWORK</div>
        <div className="network-profile">
          <div className="profile-orb">j</div>
          <div>
            Jamie Lee<small>@jamie.example.bsky.social</small>
          </div>
        </div>
        <div className="sync-state">
          <Check size={11} /> Sample network loaded
        </div>
        <div className="sidebar-bottom">
          <div className="simulation-credit">
            <Sparkles size={14} />
            <span>
              Ripple preview<small>Illustrative data throughout</small>
            </span>
          </div>
          <div className="sidebar-item">
            <Settings size={15} /> Settings <ArrowUpRight size={12} />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{phase < 2 ? "New simulation" : "Watch it spread"}</strong>
          </div>
          <div className="app-topbar-actions">
            <span className="demo-badge">PROTOTYPE</span>
            <span className="profile-orb small">j</span>
          </div>
        </header>
        <div className="app-content">
          <div className="app-heading">
            <div>
              <span className="app-eyebrow">YOUR NEXT POST, EXPLORED</span>
              <h1>
                {phase < 2
                  ? "A little signal before you send."
                  : phase === 5
                    ? "One new hook. New possibilities."
                    : "Watch an idea find its people."}
              </h1>
              <p>
                {phase < 2
                  ? "Compare a few drafts against the same audience."
                  : time < 10
                    ? "Draft A stays within AI builders. Now compare how draft B travels."
                    : "Draft B travels beyond AI builders through a shared open-source community."}
              </p>
            </div>
            <div className="run-pill">
              <span className="live-dot" />
              {phase < 2 ? "Ready to explore" : "200 runs / draft"}
            </div>
          </div>
          <div className="app-columns">
            <div className="app-stage">
              {phase < 2 ? (
                <div className="draft-composer">
                  <div className="composer-title">
                    <span>
                      <Plus size={15} /> New comparison
                    </span>
                    <small>01 / DRAFTS</small>
                  </div>
                  <label className="handle-label">Your Bluesky handle</label>
                  <div className="handle-field">
                    <Search size={14} />
                    <span>@jamie.example.bsky.social</span>
                    <Check size={13} />
                  </div>
                  <div className="drafts-heading">
                    <span>Candidate posts</span>
                    <small>Text · 3 drafts</small>
                  </div>
                  <div className="draft-inputs">
                    {drafts.map((d, i) => (
                      <div
                        className={`draft-input ${i === 1 ? "focused" : ""}`}
                        key={d.letter}
                      >
                        <div>
                          <span className="draft-letter">{d.letter}</span>
                          <strong>{d.title}</strong>
                          <small>{i === 1 ? "Editing" : "Saved"}</small>
                        </div>
                        <p>
                          {i === 1 && phase === 0 ? typed : d.text}
                          {i === 1 &&
                            phase === 0 &&
                            typed.length < d.text.length && (
                              <span className="typing-caret" />
                            )}
                        </p>
                        <span className="draft-char-count">
                          {i === 1 && phase === 0
                            ? typed.length
                            : d.text.length}{" "}
                          / 300
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="composer-footer">
                    <span>
                      <ShieldCheck size={12} /> Your drafts stay unpublished.
                    </span>
                    <div className="film-button">
                      Compare drafts <ArrowRight size={13} />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="graph-card">
                    <div className="graph-card-heading">
                      <span>
                        <Network size={14} /> Audience map
                      </span>
                      <div>
                        <span
                          className={
                            time < 10 ? "draft-tab active" : "draft-tab muted"
                          }
                        >
                          Draft A
                        </span>
                        <span
                          className={
                            time >= 10 ? "draft-tab active" : "draft-tab muted"
                          }
                        >
                          Draft B
                        </span>
                        <span className="draft-tab muted">Draft C</span>
                        <SlidersHorizontal size={12} />
                      </div>
                    </div>
                    <NetworkScene time={time} />
                  </div>
                  <div className="result-strip">
                    {drafts.map((d) => (
                      <div
                        className={
                          d.letter === "B"
                            ? "result-cell winner"
                            : "result-cell"
                        }
                        key={d.letter}
                      >
                        <span>
                          <b>{d.letter}</b> {d.title}
                          {d.letter === "B" && <small>TOP DRAFT</small>}
                        </span>
                        <strong>
                          {time < 15 ? "—" : d.range}
                          <em> est. reach</em>
                        </strong>
                        <div className="reach-bar">
                          <i
                            style={{ width: time < 15 ? "0%" : d.width + "%" }}
                          />
                        </div>
                        <p>80% interval · sample simulation</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <aside className="agent-panel">
              <div className="agent-header">
                <div className="agent-icon">
                  <RippleMark size={18} />
                </div>
                <div>
                  Ripple Orchestrator
                  <small>
                    <span className="live-dot" /> ASI:One · agent chat
                  </small>
                </div>
                <span className="agent-menu">•••</span>
              </div>
              <div className="chat-body">
                <div className="chat-date">TODAY, 10:42 AM</div>
                <div className="user-message">
                  Which of these three posts has the best chance of reaching
                  beyond my usual audience?
                </div>
                <div className="agent-message">
                  <span className="message-avatar">
                    <RippleMark size={16} />
                  </span>
                  <div>
                    {phase === 0 ? (
                      <>
                        <p>Let’s test them on a twin of your network.</p>
                        <p>
                          I’ll compare their possible reach and show where each
                          one might travel.
                        </p>
                        <div className="network-ready">
                          <Check size={12} /> Sample audience ready
                          <small>4 communities · public behavior</small>
                        </div>
                      </>
                    ) : phase === 1 ? (
                      <>
                        <p>Your three drafts are ready. Here’s the plan:</p>
                        <div className="confirmation-card">
                          <strong>Confirm simulation</strong>
                          <dl>
                            <dt>Audience</dt>
                            <dd>Jamie’s network</dd>
                            <dt>Drafts</dt>
                            <dd>A, B, C</dd>
                            <dt>Runs per draft</dt>
                            <dd>200</dd>
                          </dl>
                          <div className="film-button">
                            Run comparison <ArrowRight size={12} />
                          </div>
                        </div>
                        <p className="quiet-note">
                          Preview mode · no payment required
                        </p>
                      </>
                    ) : phase === 2 ? (
                      <>
                        <p>Running possible cascades for each draft.</p>
                        <div className="agent-job-list">
                          {[
                            "Graph Builder",
                            "Twin Profiler",
                            "Content Analyst",
                            "Simulator",
                          ].map((name, i) => (
                            <div key={name}>
                              <span>
                                {i < 3 ? (
                                  <Check size={12} />
                                ) : (
                                  <span className="job-spinner" />
                                )}
                              </span>
                              {name}
                              <small>
                                {i < 3
                                  ? "Ready"
                                  : `${Math.min(200, Math.floor((time - 7) * 25))}/200`}
                              </small>
                            </div>
                          ))}
                        </div>
                        <p className="stream-note">
                          <span className="live-dot" />{" "}
                          {time < 10
                            ? "Draft A stays within AI builders."
                            : time < 12
                              ? "Testing draft B on the same audience."
                              : "Draft B crossed into open source."}
                        </p>
                      </>
                    ) : phase === 3 ? (
                      <>
                        <p>
                          <strong>
                            Draft B has the strongest sample reach.
                          </strong>{" "}
                          Its question gives builders a reason to pass it on.
                        </p>
                        <div className="ranking-card">
                          <div>
                            <span className="rank-medal">B</span>
                            <span>
                              Recommended draft<small>The question</small>
                            </span>
                            <Check size={13} />
                          </div>
                          <strong>
                            780–2,400 <small>possible reach</small>
                          </strong>
                          <p>80% interval across 200 sample runs</p>
                          <div className="ranking-row">
                            <span>B</span>
                            <i style={{ width: "88%" }} />
                          </div>
                          <div className="ranking-row">
                            <span>C</span>
                            <i style={{ width: "51%" }} />
                          </div>
                          <div className="ranking-row">
                            <span>A</span>
                            <i style={{ width: "30%" }} />
                          </div>
                        </div>
                        <p>Want to see what carried it across?</p>
                      </>
                    ) : phase === 4 ? (
                      <>
                        <p>
                          <strong>This bridge changed the path.</strong>
                        </p>
                        <div className="explanation-card">
                          <div>
                            <GitBranch size={16} />
                            <strong>Bridge cluster 01</strong>
                          </div>
                          <span>AI builders → Open source</span>
                          <p>
                            Shared interest in open tools connects these two
                            communities.
                          </p>
                          <div className="explanation-factor">
                            <span>Topic overlap</span>
                            <i style={{ width: "78%" }} />
                          </div>
                          <div className="explanation-factor">
                            <span>Question hook</span>
                            <i style={{ width: "62%" }} />
                          </div>
                          <div className="explanation-factor">
                            <span>Prior interaction</span>
                            <i style={{ width: "44%" }} />
                          </div>
                          <small>Illustrative feature contributions</small>
                        </div>
                        <p>
                          Try a more specific question to make that connection
                          clearer.
                        </p>
                        <div className="film-button">
                          Edit the hook <ArrowRight size={12} />
                        </div>
                      </>
                    ) : (
                      <>
                        <p>
                          Let’s change only the opening line and test that idea.
                        </p>
                        <div className="counterfactual-card">
                          <span className="app-eyebrow">EDIT THE HOOK</span>
                          <div className="original-hook">
                            What if you could test a post before anyone sees it?
                          </div>
                          <div className="new-hook">
                            {edited}
                            {edited.length < 65 && (
                              <span className="typing-caret" />
                            )}
                          </div>
                          <div className="film-button">
                            {time < 26 ? (
                              <>
                                <RotateCcw size={12} /> Re-run with this hook
                              </>
                            ) : (
                              <>
                                <Check size={12} /> New comparison queued
                              </>
                            )}
                          </div>
                        </div>
                        <p className="quiet-note">
                          Same audience. Same runs. One change.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="chat-input">
                <span>Ask Ripple anything…</span>
                <Send size={14} />
              </div>
              <div className="agent-disclaimer">
                Sample data · No live prediction or measured accuracy
              </div>
            </aside>
          </div>
          <div className="app-statusbar">
            <span>
              <ShieldCheck size={11} /> Modeling public behavior, not private
              traits.
            </span>
            <span>Simulation preview · Not a reach guarantee</span>
          </div>
        </div>
      </div>
      <div
        className={`film-cursor ${clicking ? "is-clicking" : ""}`}
        style={{ transform: `translate(${cx}px, ${cy}px)` }}
      >
        <MousePointer2
          size={23}
          fill={theme === "dark" ? "#fff" : "#172233"}
          stroke={theme === "dark" ? "#172233" : "#fff"}
          strokeWidth={1.5}
        />
        {clicking && <span />}
      </div>
    </div>
  );
}
