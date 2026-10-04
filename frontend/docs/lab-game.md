# Ripple Islands

`/lab-game` is an isolated Excalibur.js visualization. The existing dashboard and Lab remain separate. Brand and experiment selections are stored in the URL. The page reads the same public audience and Lab contracts as the product; it does not create experiments or call Claude.

Real niche groups become floating islands. Each audience member gets a decorative pixel villager; the sprite is a character representation, not their profile photo. Clicking it or selecting their handle opens their actual identity, portrait and profile link. Niche buttons focus the camera. A/B changes reuse the same geometry.

Completed experiments replay their actual trial over twelve seconds. The four counters use `countsAt` and only events at or before the visible replay tick are eligible. Live runs retain the server replay tick. Villagers hop and illuminate when an eligible event arrives. Pulses indicate recorded reactions in an island; they do not imply an exposure path, which Lab events do not contain. The centre-to-island paths are visual routes, not inferred social edges. No reactions are fabricated for empty or failed runs.

The layout is prepared once in the existing worker. Size limits are checked before geometry allocation. Two local PNG atlases provide all character and scenery sprites; cached island graphics avoid rerastering per frame. Actors use no collision simulation. Drawing is capped at 30 fps, pauses in hidden tabs and the engine is disposed on unmount, including React StrictMode cleanup. Reduced motion shows a static completed trial and disables decorative bobbing, jumps and pulse motion. Native React controls provide keyboard navigation and mobile layouts scroll the niche index without horizontal page overflow.

Assets: Kenney Tiny Town and Tiny Dungeon, CC0. Original license files are in `public/lab-game/`. Sources: https://kenney.nl/assets/tiny-town and https://kenney.nl/assets/tiny-dungeon. Engine reference: https://excaliburjs.com/docs/engine/.

The landing demo now records actual product components rather than a separate invented UI. `npm run render:demo` captures the real audience cascade/focus controls and a completed Raycast A/B experiment with recorded reactions. It selects the newest completed live experiment through the actual dock, makes no submissions, and encodes separate 28-second dark/light MP4s with actual Lab posters. Loading is trimmed out; no forecast counts or reaction text is invented. The `?film=1` preview mounts the same audience and Lab components.
