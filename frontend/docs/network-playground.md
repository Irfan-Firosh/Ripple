# Ripple network playground

The main `/dashboard` route and the `/test` playground both display a full-page, interactive visualization of how a post spreads through a sample community network. It uses Ripple's navy, ivory, and amber theme over a dotted background.

The dashboard replaces the previous draft workspace for now. Authentication redirects continue to open `/dashboard`, which retains its existing Clerk provider. The shared visualization receives a workspace flag to set the dashboard title and make its back link return home; `/test` retains a link to the workspace. The previous `DashboardPage.tsx` implementation remains in the repository but is no longer mounted.

## Completed behavior

- Perspective-projected 3D portrait nodes and connecting edges, with depth shading and community colors.
- An automatic cascade beginning at the central **Your post** node. Signals travel along connections; accounts activate only after receiving the signal.
- Four communities: AI builders, Open source, Design & tools, and Indie makers. Each cluster has its name underneath it in the graph.
- A left-hand community index that smoothly centers and zooms the camera on the selected niche. **All communities** restores the overview.
- Drag to orbit, scroll or use the buttons to zoom, and reset the camera. Arrow keys orbit; plus and minus keys zoom when the canvas is focused.
- Pause and replay controls, plus account details when a portrait is selected.
- Dark and light themes, a responsive layout, and a static completed network for reduced-motion preferences.
- A minimal interface without a bottom timeline, reach counters, or the “Watch it spread” heading.

## Implementation

`src/NetworkTestPage.tsx` manages playback, theme, selection, and camera controls. `src/network-test.css` defines the full-page layout. `src/visuals/CascadeCanvas.tsx` renders world coordinates through a perspective camera onto a 2D canvas; it does not use WebGL. Cluster labels follow the projected node bounds as the camera moves.

`src/visuals/cascade.ts` computes earliest arrival times along the graph's connections. `src/visuals/network.ts` supplies the sample accounts and community topology. These are demonstration data, not live audience measurements. Portrait images load from an external service; initials remain visible if an image is unavailable.

## Verification

Run `npm run build` and `npm test` from `frontend`. The browser suite covers automatic propagation, pause and replay, niche camera navigation, overview reset, mobile layout, reduced motion, theme switching, and the absence of timeline and reach-count UI.
