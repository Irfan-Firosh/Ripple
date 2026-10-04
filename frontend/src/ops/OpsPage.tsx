import { WorkspaceAccount } from '../components/WorkspaceAccount';
// Hidden operator page (/ops, no nav link): simulation settings, per-video expected ranges, twin top-ups.
// Open to anyone with the site (no auth by design).
import { useCallback, useEffect, useState } from 'react';
import { sqlUnfiltered as sql } from '../audience/liveAudience';
import { initialTheme } from '../App';
import { call } from '../flow/flowApi';
import './ops.css';

type Settings = { twins_per_brand: number; followers_scraped: number; sim_twins: number; scale_mode: 'linear' | 'anchored'; fill_replies: number };
type Video = { video_id: string; title: string; status: string; thumbnail_url: string; created_at: number };
type Expectation = { video_id: string; like_min: number; like_max: number; repost_min: number; repost_max: number };
type Topup = { topup_id: number; brand: string; count: number; status: string; error: string | null };
type VideoMode = { mode: 'generate' | 'off' | 'reuse'; reuse_a: string; reuse_b: string };
type VideoSettings = { max_seconds: number; voice_id: string };
type OpsState = { paused: boolean; hidden: boolean };
type Brand = { handle: string; followers: number; twins: number };

const DEFAULTS: Settings = { twins_per_brand: 60, followers_scraped: 300, sim_twins: 0, scale_mode: 'anchored', fill_replies: 0 };
const RECENT_VIDEOS = 12;

// Free typing while focused (clamping each keystroke made "300" impossible: "3" jumped to the minimum); clamp on blur.
function Num({ label, hint, value, onChange, min = 0, max }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number; max: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const v = Math.max(min, Math.min(max, Math.round(Number(text)) || 0));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return <label className="ops-field"><span>{label}</span>
    <input type="number" inputMode="numeric" min={min} max={max} value={text}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
    {hint && <small>{hint}</small>}</label>;
}

export default function OpsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [expect, setExpect] = useState<Record<string, Expectation>>({});
  const [topups, setTopups] = useState<Topup[]>([]);
  const [topup, setTopup] = useState({ brand: '', count: 20 });
  const [note, setNote] = useState('');
  const [ops, setOps] = useState<OpsState>({ paused: false, hidden: false });
  const [mode, setMode] = useState<VideoMode>({ mode: 'generate', reuse_a: '', reuse_b: '' });
  const [video, setVideo] = useState<VideoSettings>({ max_seconds: 20, voice_id: 'y0s2ExEMuum3muUnA6Zd' });

  useEffect(() => { document.documentElement.dataset.theme = initialTheme(); }, []);

  const load = useCallback(async () => {
    const [rows, vids, exps, tops, twinRows, users, state, videoRow, modeRow] = await Promise.all([
      sql<Settings>("SELECT * FROM sim_settings WHERE key = 'global'"),
      sql<Video>('SELECT video_id, title, status, thumbnail_url, created_at FROM campaign_video'),
      sql<Expectation>('SELECT * FROM video_expectation'),
      sql<Topup>('SELECT * FROM twin_topup'),
      sql<{ brand_user_id: string }>('SELECT brand_user_id FROM twin_audience'),
      sql<{ user_id: string; username: string; followers_count: number }>('SELECT user_id, username, followers_count FROM x_user'),
      sql<OpsState>("SELECT * FROM ops_state WHERE key = 'global'"),
      sql<VideoSettings>("SELECT * FROM video_settings WHERE key = 'global'"),
      sql<VideoMode>("SELECT * FROM video_mode WHERE key = 'global'"),
    ]);
    if (modeRow[0]) setMode({ mode: modeRow[0].mode, reuse_a: modeRow[0].reuse_a, reuse_b: modeRow[0].reuse_b });
    if (videoRow[0]) setVideo({ max_seconds: videoRow[0].max_seconds, voice_id: videoRow[0].voice_id });
    setOps({ paused: Boolean(state[0]?.paused), hidden: Boolean(state[0]?.hidden) });
    if (rows[0]) setSettings(rows[0]);
    const twins = new Map<string, number>();
    for (const r of twinRows) twins.set(r.brand_user_id, (twins.get(r.brand_user_id) ?? 0) + 1);
    setBrands(users.filter(u => twins.has(u.user_id)).map(u => ({ handle: u.username, followers: Number(u.followers_count), twins: twins.get(u.user_id) ?? 0 })));
    setVideos(vids.filter(v => v.status === 'done').sort((a, b) => Number(b.created_at) - Number(a.created_at)).slice(0, RECENT_VIDEOS));
    setExpect(Object.fromEntries(exps.map(e => [e.video_id, e])));
    setTopups(tops.sort((a, b) => b.topup_id - a.topup_id).slice(0, 5));
  }, []);

  useEffect(() => { void load().catch(e => setNote(String(e))); }, [load]);

  const run = async (what: string, reducer: string, args: unknown[]) => {
    setNote('');
    try { await call(reducer, args); setNote(`${what} saved.`); await load(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  };
  const editExpect = (id: string, patch: Partial<Expectation>) =>
    setExpect(prev => ({ ...prev, [id]: { ...(prev[id] ?? { video_id: id, like_min: 0, like_max: 0, repost_min: 0, repost_max: 0 }), ...patch } }));

  return <main className="ops-page">
    <header><h1>Ops</h1><p>Simulation controls. Not linked from the app.</p><WorkspaceAccount /></header>

    <section className="ops-card" aria-labelledby="ops-switches">
      <h2 id="ops-switches">Switches</h2>
      <div className="ops-switches">
        <div className="ops-switch" data-on={ops.paused}><b>Workers {ops.paused ? 'paused' : 'running'}</b>
          <small>{ops.paused ? 'Nothing runs until you resume. Stopped jobs show "Paused from ops"; run them again after resuming.' : 'Pausing stops running tests, onboardings, videos and tweet writing now.'}</small>
          <button onClick={() => run(ops.paused ? 'Workers resumed' : 'Workers paused', 'set_ops_state', [!ops.paused, ops.hidden])}>{ops.paused ? 'Resume workers' : 'Pause workers'}</button></div>
        <div className="ops-switch" data-on={ops.hidden}><b>Workspace {ops.hidden ? 'hidden' : 'visible'}</b>
          <small>{ops.hidden ? 'Clean slate: campaigns, Lab tests and brand audiences from before hiding are hidden; new ones show.' : 'Clean slate for a demo: hides every campaign, Lab test and brand audience that exists now. New ones still show. Nothing is deleted.'}</small>
          <button onClick={() => run(ops.hidden ? 'Workspace shown' : 'Workspace hidden', 'set_ops_state', [ops.paused, !ops.hidden])}>{ops.hidden ? 'Unhide' : 'Hide'}</button></div>
      </div>
    </section>

    <section className="ops-card" aria-labelledby="ops-sim">
      <h2 id="ops-sim">Simulation</h2>
      <div className="ops-grid">
        <Num label="Twins per brand" hint="Cloned audience size for new brands" value={settings.twins_per_brand} min={5} max={500} onChange={v => setSettings({ ...settings, twins_per_brand: v })} />
        <Num label="Followers scraped" hint="Profiles read from X per brand" value={settings.followers_scraped} min={20} max={5000} onChange={v => setSettings({ ...settings, followers_scraped: v })} />
        <Num label="Twins per simulation" hint="0 = every twin" value={settings.sim_twins} max={500} onChange={v => setSettings({ ...settings, sim_twins: v })} />
        <Num label="Extra replies per run" hint="Claude-written, real non-twin followers" value={settings.fill_replies} max={30} onChange={v => setSettings({ ...settings, fill_replies: v })} />
      </div>
      <fieldset className="ops-mode"><legend>Scaling</legend>
        <label><input type="radio" checked={settings.scale_mode === 'linear'} onChange={() => setSettings({ ...settings, scale_mode: 'linear' })} />Linear: results × (followers ÷ people simulated)</label>
        <label><input type="radio" checked={settings.scale_mode === 'anchored'} onChange={() => setSettings({ ...settings, scale_mode: 'anchored' })} />Anchored: match the brand's real median engagement</label>
      </fieldset>
      <button onClick={() => run('Settings', 'set_sim_settings', [settings.twins_per_brand, settings.followers_scraped, settings.sim_twins, settings.scale_mode, settings.fill_replies])}>Save settings</button>
    </section>

    <section className="ops-card" aria-labelledby="ops-video">
      <h2 id="ops-video">Campaign videos</h2>
      <div className="ops-grid">
        <Num label="Max length (seconds)" hint="Script, voiceover and cut all follow this" value={video.max_seconds} min={6} max={60} onChange={v => setVideo({ ...video, max_seconds: v })} />
        <label className="ops-field"><span>ElevenLabs voice ID</span><input value={video.voice_id} onChange={e => setVideo({ ...video, voice_id: e.target.value.trim() })} /><small>Used for every new video</small></label>
      </div>
      <button style={{ marginTop: 16 }} onClick={() => run('Video settings', 'set_video_settings', [video.max_seconds, video.voice_id])}>Save video settings</button>
      <fieldset className="ops-mode"><legend>Video for new campaign drafts</legend>
        <label><input type="radio" checked={mode.mode === 'generate'} onChange={() => setMode({ ...mode, mode: 'generate' })} />Generate a new video per draft</label>
        <label><input type="radio" checked={mode.mode === 'reuse'} onChange={() => setMode({ ...mode, mode: 'reuse' })} />Reuse existing videos (for demoing one product)</label>
        <label><input type="radio" checked={mode.mode === 'off'} onChange={() => setMode({ ...mode, mode: 'off' })} />Off (no videos)</label>
      </fieldset>
      {mode.mode === 'reuse' && <div className="ops-grid">
        {(['reuse_a', 'reuse_b'] as const).map(k => <label key={k} className="ops-field"><span>{k === 'reuse_a' ? 'Draft A video' : 'Draft B video (optional)'}</span>
          <select value={mode[k]} onChange={e => setMode({ ...mode, [k]: e.target.value })}>
            <option value="">{k === 'reuse_a' ? 'Pick a video' : 'Same as draft A'}</option>
            {videos.map(v => <option key={v.video_id} value={v.video_id}>{v.title || v.video_id}</option>)}
          </select></label>)}
      </div>}
      <button style={{ marginTop: 12 }} onClick={() => run('Video mode', 'set_video_mode', [mode.mode, mode.reuse_a, mode.reuse_b])}>Save video mode</button>
    </section>

    <section className="ops-card" aria-labelledby="ops-brands">
      <h2 id="ops-brands">Audiences</h2>
      <table className="ops-table"><thead><tr><th>Brand</th><th>Followers</th><th>Twins</th><th>Linear ×</th></tr></thead>
        <tbody>{brands.map(b => {
          const sim = settings.sim_twins ? Math.min(settings.sim_twins, b.twins) : b.twins;
          return <tr key={b.handle}><td>@{b.handle}</td><td>{b.followers.toLocaleString()}</td><td>{b.twins}</td><td>{sim ? `×${Math.max(1, Math.round(b.followers / sim)).toLocaleString()}` : '–'}</td></tr>;
        })}</tbody></table>
      <div className="ops-inline">
        <label className="ops-field"><span>Brand</span><input value={topup.brand} placeholder="raycast" onChange={e => setTopup({ ...topup, brand: e.target.value })} /></label>
        <Num label="More twins" value={topup.count} min={1} max={500} onChange={v => setTopup({ ...topup, count: v })} />
        <button disabled={!topup.brand.trim()} onClick={() => run('Top-up', 'request_twin_topup', [topup.brand, topup.count])}>Build twins</button>
      </div>
      {topups.length > 0 && <ul className="ops-list">{topups.map(t => <li key={t.topup_id}>@{t.brand} +{t.count} · {t.status}{t.error ? ` · ${t.error}` : ''}</li>)}</ul>}
      <p className="ops-hint">Top-ups run on the onboarding worker.</p>
    </section>

    <section className="ops-card" aria-labelledby="ops-videos">
      <h2 id="ops-videos">Expected results per video</h2>
      <p className="ops-hint">Applies to the next Lab test of a draft carrying this video. 0–0 means no override.</p>
      {videos.map(v => {
        const e = expect[v.video_id] ?? { video_id: v.video_id, like_min: 0, like_max: 0, repost_min: 0, repost_max: 0 };
        return <div key={v.video_id} className="ops-video">
          {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" /> : <span className="ops-thumb" />}
          <div className="ops-video-body"><b>{v.title || v.video_id}</b>
            <div className="ops-ranges">
              <Num label="Likes min" value={e.like_min} max={10_000_000} onChange={x => editExpect(v.video_id, { like_min: x })} />
              <Num label="Likes max" value={e.like_max} max={10_000_000} onChange={x => editExpect(v.video_id, { like_max: x })} />
              <Num label="Reposts min" value={e.repost_min} max={10_000_000} onChange={x => editExpect(v.video_id, { repost_min: x })} />
              <Num label="Reposts max" value={e.repost_max} max={10_000_000} onChange={x => editExpect(v.video_id, { repost_max: x })} />
            </div>
            <div className="ops-row">
              <button onClick={() => run('Range', 'set_video_expectation', [v.video_id, e.like_min, e.like_max, e.repost_min, e.repost_max])}>Save range</button>
              <button className="ops-ghost" onClick={() => run('Range cleared', 'clear_video_expectation', [v.video_id])}>Clear</button>
            </div>
          </div>
        </div>;
      })}
      {!videos.length && <p className="ops-hint">No finished videos yet.</p>}
    </section>
    <p className="ops-note" role="status" aria-live="polite">{note}</p>
  </main>;
}
