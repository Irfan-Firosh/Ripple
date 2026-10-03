// Fragment shaders for <Loader>. Every shader shares the shape field below and differs only in how
// it turns that field into colour: solid edges (plain), soft edges (blur) or ordered dithering (dither).
const prelude = /* glsl */ `
precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec4 u_colorFront;
uniform vec4 u_colorBack;
uniform float u_shape;
uniform float u_scale;
uniform float u_pxSize;

// Returns the shape's intensity (0..1) at a point p in [-1, 1] space.
float field(vec2 p, float t) {
  float r = length(p);
  if (u_shape < 1.5) {
    // sphere: a lit ball whose light circles around it
    if (r > 1.0) return 0.0;
    vec3 n = vec3(p, sqrt(1.0 - r * r));
    vec3 l = normalize(vec3(cos(t * 1.4), sin(t * 1.4) * 0.6, 0.8));
    return clamp(dot(n, l), 0.0, 1.0) * 0.85 + 0.15;
  }
  if (u_shape < 2.5) {
    // swirl: three arms twisting inward
    float a = atan(p.y, p.x);
    float arms = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - t * 2.6);
    return arms * smoothstep(1.0, 0.75, r) * (1.0 - r * 0.25);
  }
  // ripple: rings travelling outward from the centre
  float rings = 0.5 + 0.5 * sin(r * 18.0 - t * 4.0);
  return rings * smoothstep(1.0, 0.15, r);
}

vec2 point(vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * u_resolution) / (0.5 * min(u_resolution.x, u_resolution.y));
  return uv / (u_scale / 0.6);
}

vec4 paint(float k) {
  vec4 c = mix(u_colorBack, u_colorFront, clamp(k, 0.0, 1.0));
  return vec4(c.rgb * c.a, c.a);
}
`;

export const plainFragmentShader = prelude + /* glsl */ `
void main() {
  float v = field(point(gl_FragCoord.xy), u_time);
  gl_FragColor = paint(step(0.5, v));
}`;

export const blurFragmentShader = prelude + /* glsl */ `
void main() {
  float v = field(point(gl_FragCoord.xy), u_time);
  gl_FragColor = paint(smoothstep(0.15, 0.85, v));
}`;

export const ditherFragmentShader = prelude + /* glsl */ `
float bayer4(vec2 c) {
  vec2 m = mod(floor(c), 4.0);
  float i = m.x + m.y * 4.0;
  // 4x4 Bayer threshold matrix, flattened.
  if (i < 0.5) return 0.0 / 16.0; if (i < 1.5) return 8.0 / 16.0; if (i < 2.5) return 2.0 / 16.0; if (i < 3.5) return 10.0 / 16.0;
  if (i < 4.5) return 12.0 / 16.0; if (i < 5.5) return 4.0 / 16.0; if (i < 6.5) return 14.0 / 16.0; if (i < 7.5) return 6.0 / 16.0;
  if (i < 8.5) return 3.0 / 16.0; if (i < 9.5) return 11.0 / 16.0; if (i < 10.5) return 1.0 / 16.0; if (i < 11.5) return 9.0 / 16.0;
  if (i < 12.5) return 15.0 / 16.0; if (i < 13.5) return 7.0 / 16.0; if (i < 14.5) return 13.0 / 16.0; return 5.0 / 16.0;
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_pxSize);
  vec2 centre = (cell + 0.5) * u_pxSize;
  float v = field(point(centre), u_time);
  gl_FragColor = paint(step(bayer4(cell) + 0.02, v));
}`;

/** Converts #rgb, #rrggbb, #rrggbbaa, "transparent" or a CSS var(--token) into RGBA in 0..1. */
export function hexToRgba(color: string): [number, number, number, number] {
  let value = color.trim();
  const variable = value.match(/^var\((--[^),\s]+)(?:,\s*([^)]+))?\)$/);
  if (variable && typeof document !== 'undefined') {
    value = getComputedStyle(document.documentElement).getPropertyValue(variable[1]).trim() || variable[2]?.trim() || '';
  }
  if (!value || value === 'transparent') return [0, 0, 0, 0];
  const hex = value.replace('#', '');
  const full = hex.length === 3 || hex.length === 4 ? [...hex].map(c => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return [0, 0, 0, 0];
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
}
