import { useEffect, useRef, useState } from 'react';
import * as ex from 'excalibur';
import type { CascadeNetwork } from '../visuals/liveNetwork';
import type { LabRun } from '../lab/labData';

type Props = { network: CascadeNetwork; run: LabRun | null; draft: 'A' | 'B'; theme: 'dark' | 'light'; niche: number | null; person: number | null; onPerson: (id: number) => void };

// One atlas, cached island graphics, and no physics or layout work in the frame loop.
export function GameCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const controller = useRef<{ focus: (index: number | null) => void } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { controller.current?.focus(props.niche); }, [props.niche]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let game: ex.Engine | null = null;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Audience islands. Choose a niche or person using the controls.');
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);
    const network = props.network;
    if (!network.planarLayout) return () => canvas.remove();
    const layout = network.planarLayout;
    const factor = 2.7;
    const center = (i: number) => ex.vec(layout.centers[i][0] * factor, layout.centers[i][1] * factor * .75);
    const people = new Map<string, ex.Actor>();
    const homes = new Map<ex.Actor, ex.Vector>();
    const seen = new Map<string, number>();
    const processed = new Set<string>();
    const reactionColors = { A: ex.Color.fromHex('#edba76'), B: ex.Color.fromHex('#6dd6f4') };
    let previousRun = '', previousTick = -1, clock = 0;
    const labels: ex.Label[] = [];
    const atlas = new ex.ImageSource('/lab-game/tilemap_packed.png');
    const characters = new ex.ImageSource('/lab-game/characters.png');
    const fit = () => Math.min(container.clientWidth / (layout.halfWidth * factor * 2 + 190), container.clientHeight / (layout.halfHeight * factor * 1.5 + 180), 1.2);
    async function start() {
      try {
        await Promise.all([atlas.load(), characters.load()]);
        if (disposed) return;
        game = new ex.Engine({ canvasElement: canvas, width: container!.clientWidth, height: container!.clientHeight, backgroundColor: ex.Color.Transparent, antialiasing: false, suppressConsoleBootMessage: true, suppressPlayButton: true, maxFps: 30, pointerScope: ex.PointerScope.Canvas });
        const engine = game;
        const scene = engine.currentScene;
        const sheet = ex.SpriteSheet.fromImageSource({ image: atlas, grid: { rows: 11, columns: 12, spriteWidth: 16, spriteHeight: 16 } });
        const characterSheet = ex.SpriteSheet.fromImageSource({ image: characters, grid: { rows: 11, columns: 12, spriteWidth: 16, spriteHeight: 16 } });
        const sprite = (x: number, y: number, scale: number) => { const graphic = sheet.getSprite(x, y).clone(); graphic.scale = ex.vec(scale, scale); return graphic; };
        const add = (pos: ex.Vector, graphic: ex.Graphic, z: number) => { const actor = new ex.Actor({ pos, z, collisionType: ex.CollisionType.PreventCollision }); actor.graphics.use(graphic); scene.add(actor); return actor; };
        network.communities.forEach((community, i) => {
          const r = layout.radii[i] * factor + 36;
          const island = new ex.Canvas({ width: Math.ceil(r * 2 + 20), height: Math.ceil(r * 1.25 + 70), cache: true, draw: ctx => {
            const x = r + 10, y = r * .6;
            ctx.fillStyle = '#070e1f33'; ctx.beginPath(); ctx.ellipse(x, y + 44, r * .87, r * .35, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#67577c'; ctx.beginPath(); ctx.ellipse(x, y + 18, r, r * .57, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#9bbda0'; ctx.beginPath(); ctx.ellipse(x, y, r, r * .57, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#d9e3ae'; ctx.lineWidth = 3; ctx.stroke();
            // Stable tiny flowers and grass are decoration, never simulated users.
            for (let j = 0; j < 22; j++) { const angle = j * 2.399963, radius = r * Math.sqrt((j + 1) / 24) * .94; ctx.fillStyle = j % 3 ? '#6c997c' : '#eee6b0'; ctx.fillRect(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * .55, 3, 3); }
          } });
          add(center(i).add(ex.vec(0, 20)), island, -20);
          add(center(i).add(ex.vec(-r * .7, -r * .16)), sprite(4, 1, 3.4), -5);
          add(center(i).add(ex.vec(r * .67, -r * .23)), sprite(7, 1, 2.8), -5);
          const label = new ex.Label({ text: community.name, pos: center(i).add(ex.vec(0, r * .66 + 35)), z: 20, font: new ex.Font({ family: 'DM Sans', size: 18, textAlign: ex.TextAlign.Center }), color: ex.Color.White });
          labels.push(label); scene.add(label);
        });
        const variants = [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [1, 8], [2, 8], [3, 8], [4, 8]];
        network.nodes.forEach(node => {
          const position = layout.positions[node.id];
          const groupY = layout.centers[node.community][1];
          const home = ex.vec(position[0] * factor, (groupY * .75 + (position[1] - groupY) * .5) * factor);
          const [x, y] = variants[node.id % variants.length];
          const graphic = characterSheet.getSprite(x, y).clone(); graphic.scale = ex.vec(2.4, 2.4);
          const actor = add(home.clone(), graphic, 2 + home.y / 10000);
          actor.on('pointerup', () => latest.current.onPerson(node.id));
          actor.graphics.onPostDraw = ctx => { const p = latest.current, selected = node.id === p.person; if (seen.has(node.member.userId) || selected) ctx.drawCircle(ex.vec(0, 0), selected ? 11 : 8, ex.Color.Transparent, reactionColors[p.draft], selected ? 2.5 : 1.3); };
          people.set(node.member.userId, actor); homes.set(actor, home);
        });
        const post = new ex.Canvas({ width: 124, height: 112, cache: true, draw: ctx => {
          ctx.fillStyle = '#596479'; ctx.beginPath(); ctx.ellipse(62, 92, 53, 14, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f6edce'; ctx.beginPath(); ctx.roundRect(13, 15, 98, 72, 12); ctx.fill();
          ctx.fillStyle = '#cfaa75'; ctx.fillRect(31, 34, 61, 5); ctx.fillRect(31, 47, 48, 5); ctx.fillRect(31, 60, 34, 5);
        } });
        add(ex.vec(0, 0), post, 12);
        const postLabel = new ex.Label({ text: 'DRAFT A', pos: ex.vec(0, 76), z: 20, font: new ex.Font({ family: 'Space Mono', size: 15, textAlign: ex.TextAlign.Center }) }); scene.add(postLabel);
        const focus = (index: number | null) => {
          const target = index === null ? ex.vec(0, 0) : center(index);
          const zoom = index === null ? fit() : Math.min(container!.clientWidth / (layout!.radii[index] * factor * 2 + 100), container!.clientHeight / (layout!.radii[index] * factor * 1.6 + 180), 2);
          if (media.matches) { scene.camera.pos = target; scene.camera.zoom = zoom; }
          else { void scene.camera.move(target, 500); void scene.camera.zoomOverTime(zoom, 500); }
        };
        controller.current = { focus };
        scene.camera.pos = ex.vec(0, 0); scene.camera.zoom = fit();
        scene.onPreUpdate = (_engine, elapsed) => {
          const p = latest.current; clock += media.matches ? 0 : elapsed / 1000;
          const run = p.run;
          if (run?.runId !== previousRun || (run && run.replayTick < previousTick)) { seen.clear(); processed.clear(); previousRun = run?.runId ?? ''; }
          previousTick = run?.replayTick ?? -1;
          if (run) for (const event of run.events) { const key = `${event.userId}:${event.signal}:${event.tick}`; if (event.tick <= run.replayTick && !processed.has(key)) { processed.add(key); seen.set(event.userId, clock); } }
          const color = reactionColors[p.draft];
          labels.forEach(label => { label.color = ex.Color.fromHex(p.theme === 'dark' ? '#e9e8ed' : '#38483f'); label.font.size = 12 / scene.camera.zoom; label.maxWidth = 130 / scene.camera.zoom; });
          postLabel.text = `DRAFT ${p.draft}`; postLabel.color = color;
          postLabel.font.size = 11 / scene.camera.zoom;
          for (const [userId, actor] of people) {
            const home = homes.get(actor)!;
            const age = clock - (seen.get(userId) ?? -100);
            const jump = !media.matches && age < .7 ? Math.sin(Math.min(1, age / .7) * Math.PI) * 15 : 0;
            actor.pos.y = home.y - jump - (media.matches || p.niche !== null ? 0 : Math.sin(clock * .8 + home.x) * 1.5);
            actor.graphics.opacity = seen.has(userId) || !run ? 1 : .64;
          }
          canvas.dataset.people = String(people.size); canvas.dataset.tick = String(run?.replayTick ?? 0); canvas.dataset.motion = media.matches ? 'still' : 'animated';
          canvas.dataset.zoom = scene.camera.zoom.toFixed(3);
        };
        scene.onPreDraw = ctx => {
          const p = latest.current, color = ex.Color.fromHex(p.draft === 'A' ? '#edba7655' : '#6dd6f455');
          network.communities.forEach((_, i) => ctx.drawLine(engine.worldToScreenCoordinates(ex.vec(0, 0)), engine.worldToScreenCoordinates(center(i)), color, 1.5));
          // A pulse means a recorded reaction in this niche, not an inferred exposure chain.
          if (!media.matches && p.run) network.communities.forEach((_, i) => {
            const recent = network.nodes.some(n => n.community === i && clock - (seen.get(n.member.userId) ?? -100) < .9);
            if (recent) { const t = (clock % .9) / .9; ctx.drawCircle(engine.worldToScreenCoordinates(center(i).scale(t)), 4, ex.Color.fromHex(p.draft === 'A' ? '#edba76' : '#6dd6f4')); }
          });
        };
        await engine.start();
        if (disposed) return;
        canvas.dataset.ready = 'true';
        if (document.hidden) engine.stop();
        if (latest.current.niche !== null) focus(latest.current.niche);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not open the islands.'); }
    }
    const resize = new ResizeObserver(() => { if (game) { game.screen.resolution = { width: container.clientWidth, height: container.clientHeight }; game.screen.viewport = { width: container.clientWidth, height: container.clientHeight }; game.screen.applyResolutionAndViewport(); controller.current?.focus(latest.current.niche); } });
    resize.observe(container);
    const visibility = () => { if (game) { if (document.hidden) game.stop(); else void game.start(); } };
    document.addEventListener('visibilitychange', visibility);
    void start();
    return () => { disposed = true; controller.current = null; resize.disconnect(); document.removeEventListener('visibilitychange', visibility); game?.dispose(); canvas.remove(); };
  }, [props.network]);
  return <div className="lg-canvas" ref={host}>{error && <p role="alert">{error}</p>}</div>;
}
