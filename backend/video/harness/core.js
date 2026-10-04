// Ripple film harness: everything is a pure function of time t (seconds). Adapted from the MIT-licensed
// howseen-ai/claude-motion-design engine rules. The film page defines window.seek(t) using these helpers.
const H = (() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = {
    linear: u => u,
    out: u => 1 - Math.pow(1 - u, 3),
    in: u => u * u * u,
    inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    expo: u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  };
  // eased progress 0..1 of a move that starts at t0 and lasts dur
  const P = (t, t0, dur, e = ease.inOut) => (t <= t0 ? 0 : t >= t0 + dur ? 1 : e((t - t0) / dur));
  // closed-form damped spring step response (0 -> 1, tiny overshoot); f = Hz, z = damping ratio (keep >= 0.72)
  function step(tau, f = 2.2, z = 0.78) {
    if (tau <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z * w / wd) * Math.sin(wd * tau));
  }
  // value with several spring targets: changes = [[t0, to], ...]
  function S(t, base, changes, f, z) {
    let v = base, prev = base;
    for (const [t0, to] of changes) { v += (to - prev) * step(t - t0, f, z); prev = to; }
    return v;
  }
  // seeded PRNG (never Math.random: frames must be identical on every render)
  function rng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  // split an element's text into masked words once; then rise(el, t, t0) reveals them word by word
  function words(el) {
    if (el._w) return el._w;
    const parts = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    el._w = parts.map(p => {
      const mask = document.createElement("span"); // generous clip box (padding cancelled by negative margin) so ascenders/descenders of big type never get cut
      mask.style.cssText = "display:inline-block;overflow:hidden;vertical-align:top;padding:.18em .04em .28em;margin:-.18em -.04em -.28em";
      const w = document.createElement("span"); w.textContent = p; w.style.display = "inline-block";
      mask.appendChild(w); el.appendChild(mask); el.appendChild(document.createTextNode(" ")); return w;
    });
    return el._w;
  }
  function rise(el, t, t0, stagger = 0.055) {
    words(el).forEach((w, i) => {
      const u = step(t - t0 - i * stagger, 2.4, 0.8);
      w.style.transform = `translateY(${(1 - u) * 105}%) rotate(${(1 - u) * 4}deg)`;
    });
  }
  function hide(el, t, t0, dur = 0.25) { el.style.opacity = String(1 - P(t, t0, dur, ease.in)); }
  const set = (el, css) => Object.assign(el.style, css);
  return { clamp, lerp, ease, P, step, S, rng, words, rise, hide, set };
})();
