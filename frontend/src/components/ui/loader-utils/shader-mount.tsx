import * as React from 'react';

type Uniform = number | number[];

interface ShaderMountProps {
  fragmentShader: string;
  uniforms: Record<string, Uniform>;
  speed?: number;
  width: number;
  height: number;
}

const VERTEX = `attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Draws a full-size fragment shader into a canvas and animates u_time. Renders nothing if WebGL is unavailable. */
export function ShaderMount({ fragmentShader, uniforms, speed = 1, width, height }: ShaderMountProps) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const latest = React.useRef({ uniforms, speed });
  latest.current = { uniforms, speed };

  React.useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { premultipliedAlpha: true, alpha: true });
    if (!el || !gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    gl.viewport(0, 0, el.width, el.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let time = 0;
    let last = 0;
    const draw = (now: number) => {
      if (last && !reduced) time += ((now - last) / 1000) * latest.current.speed;
      last = now;
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
      gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), el.width, el.height);
      for (const [name, value] of Object.entries(latest.current.uniforms)) {
        const loc = gl.getUniformLocation(program, name);
        if (!loc) continue;
        if (typeof value === 'number') gl.uniform1f(loc, name === 'u_pxSize' ? value * dpr : value);
        else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
        else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [fragmentShader, width, height]);

  return <canvas ref={canvas} aria-hidden="true" style={{ width, height, display: 'block' }} />;
}
