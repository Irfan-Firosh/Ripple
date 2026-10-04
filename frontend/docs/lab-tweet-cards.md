# Lab tweet cards

The active Lab uses ClientTweetCard from src/registry/magicui/client-tweet-card.tsx. The published-tweet implementation comes from Magic UI's official client-tweet-card and tweet-card registry sources (MIT). It retains id/useTweet support. An additional draft mode takes the actual Lab author and draft data, because an unpublished draft does not have an X tweet ID. It shares the Magic UI header/body/media layout and keeps Ripple's light/dark colors.

Simulation counters, recorded reactions and written replies continue updating from the existing Lab replay. Verified badges reflect the actual brand profile. No unrelated published tweet is substituted for a draft.

Generated video is resolved through lab_draft_media, or the experiment's campaign_flow video_id, and rendered with a poster and native playback controls. Generation status appears while that actual video is pending. Generated images are resolved from ad_variant for the experiment's campaign and displayed only if exactly one ready variant's headline and CTA match that draft. Ambiguous matches are omitted. Image/video tabs appear when both are available. Switching experiments clears prior media; failed asset loading has a retry action. Cards do not autoplay video.

The media UI test intercepts experiment and media reads at the database boundary. It verifies scrollable draft bodies, image/video switching, pending-to-ready behavior, playable video metadata and clearing media on experiment changes without starting new generation or simulation jobs. Separate live-data tests continue to exercise the real database contract.

## Reaction browsing and fresh simulations

Each draft has Comments, Likes and Reposts tabs, with keyboard arrow navigation. Clicking a tweet's engagement counter opens the matching view. Lists include only people and written responses that have reached the displayed simulation tick; reposts include quotes and their recorded commentary. View counts remain informational.

The Lab toolbar offers Resimulate instead of Replay. Resimulate calls the existing request_lab_experiment reducer for the same brand, title and drafts, then selects the newly created matching experiment. It does not reset old counts to pretend a new simulation ran. The current experiment stays visible if the reducer rejects the request. Tests intercept this submission, so they do not start paid inference jobs.

The new experiment URL carries `source=<original experiment>` and the browser remembers that relationship so the new run can show the original campaign's actual generated media. This is frontend provenance; it does not modify the original campaign or its experiment. Shared URLs retain the source reference. Historical experiments appear in a left History sidebar, with active selection, status dots and dates; arrow keys move focus and Enter opens a run. On phones the history becomes an inline scrollable list above the drafts. The global searchable History drawer remains available.

Side-by-side analysis retains the existing A/B engagement-over-time graphs and recorded checkpoint tables. It now also contains two minimal audience-spread graphs for the selected experiment's brand and A/B drafts. No sample counts, ratios, percentage labels or niche legend appear in the new audience section. Brand logos, profile identities, grouping and existing graph connections come from that brand's audience. Spread reactions are illustrative frontend events, labelled as such; the recorded engagement charts remain independent. A shared notice schedule alternates A/B popups, leaves a short gap for fading, and never shows a reaction before its event time. Pause/restart controls affect only this visual animation. The dialog supports Escape and traps/restores focus.

Dark UI tokens now use black/charcoal surfaces with the existing gold accent. Light mode keeps the cream palette. Home/login cloud artwork is desaturated in dark mode to match the neutral surfaces; generated campaign media retains its actual colors.

The first Lab history action selects a saved campaign instead of opening the standalone experiment composer. Campaigns are read with the current creative database identity and refresh every five seconds. The selector shows actual campaign names (or imported draft text), brand and stage. Tested campaigns open their saved experiment; campaigns awaiting a test resume their Campaign flow. With no campaigns, **Create new campaign** opens `/campaign?brand=<handle>`. Read errors offer retry without presenting an empty workspace. Selecting or creating a campaign does not itself submit a Lab inference request.

Lab omits the audience-projection scaling sentence beneath the posts. The underlying forecasts, reactions and projection data are unchanged. The standalone spread preview has been removed; its approved graphs live in the analysis dialog, using the selected campaign’s audience. Opening the analysis never requests a new simulation or starts paid inference. See [Lab audience spread](lab-audience-spread.md) for connectivity, repost notices and popup bounds.

Visible audience grouping labels now use **Interests**; **Likes** remains the engagement signal. Browser tab titles are **Ripple** across routes.
