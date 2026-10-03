# Ripple landing

A minimal hackathon landing page using the supplied day/night artwork and Wafer's Space Grotesk, DM Sans, and Space Mono typography. Fonts are self-hosted with their OFL licenses.

```sh
cd frontend
npm install
npx playwright install chromium
npm run dev
```

Open http://localhost:5173. Build with `npm run build`; browser checks with `npm test`.

## Product walkthrough

The central player contains real, locally rendered 28-second H.264 videos in both themes. The React scene in `src/DemoFilm.tsx` reconstructs the planned Ripple flow: drafts → confirmation in agent chat → audience cascade → reach intervals → community bridge explanation → counterfactual hook. All data is illustrative; no live backend or measured accuracy is implied.

Superstyle inspired the large browser-window presentation and the product working inside it. The navy, ivory, and amber palette is drawn from the supplied backgrounds.

To regenerate videos, run the dev server, install FFmpeg, then run `npm run render:demo` in another terminal. The script captures deterministic React frames in Chromium, encodes both themes, and removes temporary frames. `DEMO_URL` can override the render server URL.

The background uses subtle pan/zoom and star glints. Reduced motion disables those effects and automatic video playback. Video pauses outside the viewport. Theme preference is saved locally.

Planning originals remain in `../plan/` and `../docs/research/`; public copies enable the design and research links.

The hero uses Magic UI Word Rotate, installed with `pnpm dlx shadcn@latest add @magicui/word-rotate`. Its wrapper and animated element were adapted to inline spans for valid heading markup and native CSS styling; reduced motion shows a static word.
