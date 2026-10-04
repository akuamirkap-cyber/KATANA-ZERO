import * as THREE from 'three';

/**
 * Final grade pass: blade-mode split-tone + radial blur, cinematic edge-defocus (fake depth of field),
 * subtle sprint speed-lines, aim crush and slice invert flash. Everything is deliberately restrained
 * so it never hides the blade or the cut.
 */
export const RageShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    rage: { value: 0 },
    aim: { value: 0 },
    invert: { value: 0 },
    time: { value: 0 },
    speed: { value: 0 },
    edge: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float rage, aim, invert, time, speed, edge;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float blur = rage * 0.007 + aim * 0.005 + speed * 0.0035;
      if (blur > 0.0005) {
        vec3 acc = col;
        for (int i = 1; i < 6; i++) {
          float k = float(i) / 5.0;
          acc += texture2D(tDiffuse, vUv - c * blur * k * (0.4 + d * 2.2)).rgb;
        }
        col = acc / 6.0;
      }
      if (edge > 0.001) {
        float r = edge * 0.0062 * smoothstep(0.18, 0.78, d);
        col = (col * 2.0
          + texture2D(tDiffuse, vUv + vec2(r, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(r, 0.0)).rgb
          + texture2D(tDiffuse, vUv + vec2(0.0, r)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, r)).rgb) / 6.0;
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 graded = mix(vec3(l) * vec3(0.5, 0.6, 0.95), col * vec3(1.2, 0.76, 0.76), smoothstep(0.12, 0.85, l));
      col = mix(col, graded, rage * 0.42);
      col *= 1.0 - rage * 0.22 * smoothstep(0.2, 0.85, d);
      float pulse = 0.6 + 0.4 * sin(time * 4.0);
      col += vec3(0.32, 0.015, 0.025) * rage * smoothstep(0.62, 1.0, d) * pulse;
      col = mix(col, col * col * 1.15, aim * 0.2);
      col *= 1.0 - aim * 0.3 * smoothstep(0.1, 0.8, d);
      // sprint speed-lines: faint radial streaks only near the screen edge
      if (speed > 0.01) {
        float ang = atan(c.y, c.x);
        float n = fract(sin(dot(vec2(floor(ang * 55.0), floor(time * 18.0)), vec2(12.9898, 78.233))) * 43758.5453);
        float ln = step(0.9, n) * smoothstep(0.32, 0.68, d) * speed;
        col = mix(col, vec3(0.85), ln * 0.1);
      }
      // cinematic shots: a touch more contrast + cooler shadows
      col = mix(col, (col - 0.5) * 1.07 + 0.5, edge * 0.5);
      col = mix(col, vec3(1.0) - col, invert);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
