# Ripple network playground

The main `/dashboard` route and the `/test` playground both display a full-page, interactive visualization of how a post spreads through the audience loaded from SpacetimeDB. It uses Ripple's navy, ivory, and amber theme over a dotted background.

The dashboard replaces the previous draft workspace for now. Authentication redirects continue to open `/dashboard`, which retains its existing Clerk provider. The shared visualization receives a workspace flag to set the dashboard title and make its back link return home; `/test` retains a link to the workspace. The previous `DashboardPage.tsx` implementation remains in the repository but is no longer mounted.

## Completed behavior

- Perspective-projected 3D portrait nodes and connecting edges, with depth shading and community colors.
- A compact spherical layout: niche centers sit around a globe, and profiles fill spherical volumes within each niche. Both the overall graph and individual clusters have depth along all three axes, including when the camera rotates. The initial camera uses an oblique angle, and perspective scales with the network size.
- An automatic cascade beginning at the central **Your post** node. Signals travel along connections; accounts activate only after receiving the signal.
- Up to ten niche groups derived from the audience, with smaller niches combined into Other niches. Each cluster has its name underneath it in the graph.
- A left-hand community index that smoothly centers and zooms the camera on the selected niche. **All niches** restores the overview.
- Drag to orbit, scroll or use the buttons to zoom, and reset the camera. Arrow keys orbit; plus and minus keys zoom when the canvas is focused.
- The dotted background is fixed to the viewport. Wheel input over the canvas is consumed by zoom, and scrolling the niche index does not propagate to the page.
- Pause and replay controls, plus account details when a portrait is selected.
- Dark and light themes, a responsive layout, and a static completed network for reduced-motion preferences.
- A minimal interface without a bottom timeline or the “Watch it spread” heading.

## Implementation

`src/NetworkTestPage.tsx` manages playback, theme, selection, and camera controls. `src/network-test.css` defines the full-page layout. `src/visuals/CascadeCanvas.tsx` renders world coordinates through a perspective camera onto a 2D canvas; it does not use WebGL. Cluster labels follow the projected node bounds as the camera moves.

`src/audience/liveAudience.ts` loads audience data. `src/visuals/liveNetwork.ts` builds the spherical layout and computes earliest arrival times along the graph's connections. Audience profiles are real loaded data; propagation timing is an estimate for the visualization. Portrait images load from an external service; initials remain visible if an image is unavailable.

## Rendering and size limits

People remain grouped by their primary niche. Each group occupies a spherical volume, and community centers are separated by the sum of their radii plus a small gap. The layout preserves depth while preventing different groups from overlapping in world space. Projection can still put a distant group behind another; niche selection brings the selected group into view.

The previous renderer repeatedly clipped portraits, rebuilt lighting gradients and shadows, sorted all nodes, scanned each cluster, and repainted an unchanged graph on every animation frame. The current renderer:

- Prepares reusable 128px node sprites and cluster glow tiles while showing **Preparing the network**. Playback starts after sprite preparation. Preparation yields between batches of 32 nodes so the UI remains responsive.
- Loads portraits with eight concurrent requests and a four-second timeout per image. Portraits progressively replace initials. A 96px decoded thumbnail supports theme changes without retaining each full-resolution source image.
- Scales the cached sprites during zoom, reuses depth ordering until the orbit angle changes, and batches connections into paths by style.
- Computes label bounds in one pass, skips drawing offscreen node sprites, and skips canvas repaints when nothing changes or the tab is hidden. React playback updates run at roughly 30Hz while camera movement can render at display rate.
- Uses a min-heap for shortest-path construction and appends to adjacency and niche arrays without repeatedly copying them.

`MAX_GRAPH_NODES` is **1,500**. `MAX_GRAPH_LINKS` is **12,000**, including an upper-bound estimate of generated intra-niche and source connections. Inputs beyond either budget show a size-limit message before geometry, shortest paths, or portrait loading begins. No partial or sampled audience is silently presented. These limits apply after audience retrieval; the current SQL data download still happens before the graph size check.

Sprite caching reduces interactive drawing cost; it does not guarantee the same frame rate on every device. The graph still projects nodes and connections when the camera moves. The fixture tests verify 500-person rendering, cached assets, idle redraw suppression, and zoom, plus both size guards and cluster separation.

## Verification

Run `npm run build` and `npm test` from `frontend`. The suite covers live audience loading, pause and replay, niche camera navigation, mobile layout, reduced motion, theme switching, fixed-background wheel zoom, and the rendering and size checks above.
