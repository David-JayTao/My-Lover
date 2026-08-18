import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from 'three';
import { STAR_GLINT } from '../shaders/common.glsl.js';

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aRand;   // seed, twinkleSpeed, size, warmth

uniform float uTime;
uniform float uFade;
uniform float uProjScale;
uniform float uSize;
uniform vec3  uCold;
uniform vec3  uWarm;

varying vec3  vColor;
varying float vIntensity;
varying float vSpikes;

void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);

  float tw = 0.62 + 0.38 * sin(uTime * (0.35 + aRand.y * 1.15) + aRand.x * 6.2831);
  tw *= 0.75 + 0.25 * sin(uTime * (0.9 + aRand.y) + aRand.w * 4.0);

  vColor = mix(uCold, uWarm, pow(aRand.w, 2.5) * 0.9);
  vIntensity = (0.10 + 0.55 * pow(aRand.z, 2.2)) * tw * uFade;
  vSpikes = smoothstep(0.72, 1.0, aRand.z);

  float size = uSize * (0.35 + aRand.z * aRand.z * 2.4);
  gl_PointSize = clamp(size * uProjScale / dist, 0.7, 12.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3  vColor;
varying float vIntensity;
varying float vSpikes;

${STAR_GLINT}

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  if (vIntensity <= 0.0004) discard;
  float a = starGlint(uv, vSpikes);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor * vIntensity, min(a, 1.0));
}
`;

function makeLayer(count, rMin, rMax, sizeScale, config, seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // 球面均匀分布，略微避开正后方
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = rMin + Math.pow(rnd(), 0.55) * (rMax - rMin);
    const sq = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * sq * r;
    pos[i * 3 + 1] = u * r * 0.72;
    pos[i * 3 + 2] = Math.sin(th) * sq * r;
    rand[i * 4] = rnd();
    rand[i * 4 + 1] = rnd();
    rand[i * 4 + 2] = rnd();
    rand[i * 4 + 3] = rnd();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new BufferAttribute(rand, 4));
  geo.boundingSphere = null;

  const uniforms = {
    uTime: { value: 0 },
    uFade: { value: 0 },
    uProjScale: { value: 1200 },
    uSize: { value: sizeScale },
    uCold: { value: new Color(config.colors.star) },
    uWarm: { value: new Color(config.colors.starWarm) },
  };
  const points = new Points(
    geo,
    new ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    })
  );
  points.frustumCulled = false;
  points.renderOrder = 0;
  return { points, uniforms };
}

export class Starfield {
  constructor(config) {
    this.far = makeLayer(config.counts.starsFar, 42, 66, 0.055, config, 3121);
    this.near = makeLayer(config.counts.starsNear, 20, 38, 0.085, config, 991);
    this.layers = [this.far, this.near];
  }

  addTo(scene) {
    for (const l of this.layers) scene.add(l.points);
  }

  setProjScale(v) {
    for (const l of this.layers) l.uniforms.uProjScale.value = v;
  }

  update(time, state) {
    this.far.uniforms.uTime.value = time;
    this.near.uniforms.uTime.value = time;
    this.far.uniforms.uFade.value = state.stars * 0.85;
    this.near.uniforms.uFade.value = state.stars;
    // 极慢的整体旋转，让画面“活着”
    this.far.points.rotation.y = time * 0.0042;
    this.near.points.rotation.y = -time * 0.0028;
  }

  dispose() {
    for (const l of this.layers) {
      l.points.geometry.dispose();
      l.points.material.dispose();
    }
  }
}
