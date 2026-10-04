# Ripple: see how your audience reacts before you post

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Ripple predicts how a brand's real social audience (X or Bluesky) would react to a draft post before it is published. Each follower
is simulated by a behavioural persona built from their public posts. Ripple asks the most relevant personas
whether they would reply, quote, repost, like or ignore the draft, and why. Paste one draft, or several to compare.

Personas are synthetic and inferred only from public social signals. Ripple does not infer sensitive traits
(race, religion, health, sexual orientation, politics or income).

## Try it

- "How would @raycast.com's audience react to: 'Raycast AI now runs your extensions for you. Just ask.'"
- "Which is better for @raycast.com? A: 'Raycast for Windows is here.' B: 'Stop alt-tabbing. Raycast now on Windows.'"
- "Who in @raycast.com's audience cares about developer tools?"

## Agents

| Agent | Role |
|---|---|
| `ripple` | Chat Protocol orchestrator: plans the request with ASI:One, delegates, and replies in chat |
| `ripple-audience` | Finds who in the audience cares about a topic, and asks the most relevant personas about each draft |
| Simulation agent | Projects reach for a draft (built separately) |
