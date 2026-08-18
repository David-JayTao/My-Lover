import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { buildHeartField } from './heartShape.js';
import { FLOW_FIELD, ROT2D, SIMPLEX3D, SOFT_POINT } from '../shaders/common.glsl.js';

const VERT = /* glsl */ `
precision highp float;

attribute vec3 aStart;
attribute vec3 aNormal;
attribute vec4 aRand;   // seed, delay, size, colorMix
attribute vec4 aMisc;   // escapeAmt, escapeSpeed, disperseKey, dNorm

uniform float uTime;
uniform float uForm;
uniform float uStagger;
uniform float uFade;
uniform float uAlive;
uniform float uEscape;
uniform float uPulse;
uniform float uDisperse;
uniform float uDisperseFrac;
uniform float uBreathe;
uniform float uSize;
uniform float uProjScale;
uniform float uHalfDepth;
uniform vec3  uCenter;
uniform vec3  uCore;
uniform vec3  uMid;
uniform vec3  uDeep;
uniform vec3  uEdge;

varying vec3  vColor;
varying float vIntensity;
varying float vSharp;

${SIMPLEX3D}
${FLOW_FIELD}
${ROT2D}

float smootherstep(float t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

void main() {
  float t = uTime;
  vec3 c = uCenter;
  vec3 target = position;

  /* ---------- 1. 聚合：从四周旋入中心 ---------- */
  float delay = aRand.y * uStagger;
  float p = clamp((uForm - delay) / max(1.0 - uStagger, 1e-3), 0.0, 1.0);
  float pe = mix(smootherstep(p), 1.0 - pow(1.0 - p, 5.0), 0.5);

  vec3 pos = mix(aStart, target, pe);

  // 旋涡（越接近目标越弱）
  float swirl = (1.0 - pe) * (1.9 + aRand.x * 2.4);
  swirl *= 0.35 + 0.65 * (1.0 - pe);
  pos.xz = c.xz + rot2(pos.xz - c.xz, swirl * (1.0 + 0.55 * sin(aRand.w * 6.2831)));

  // 抛物弧线，避免机械直线
  vec3 arcDir = normalize(vec3(sin(aRand.x * 6.2831) * 0.8, 1.25, cos(aRand.w * 6.2831) * 0.8));
  pos += arcDir * sin(pe * 3.14159) * (0.35 + aRand.x * 1.55);

  // 飞行中的流场扰动：空间频率高一些，云才会出现丝状结构而不是一团均匀的雾
  float flightAmp = (1.0 - pe) * (0.95 + aRand.z * 0.45);
  pos += flowField(pos * 0.42 + vec3(0.0, t * 0.04, 0.0), t * 0.42) * flightAmp;

  /* ---------- 2. 成形后：呼吸 / 表面流动 / 离散回归 ---------- */
  float live = uAlive * pe;

  float n1 = snoise(target * 1.55 + vec3(0.0, 0.0, t * 0.20));
  float n2 = snoise(target * 4.20 - vec3(t * 0.14, t * 0.10, 0.0));
  pos += aNormal * (n1 * 0.052 + n2 * 0.020) * live;

  vec3 tangent = normalize(cross(aNormal, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
  pos += tangent * n2 * 0.028 * live;

  float breath = 1.0 + uBreathe * sin(t * 0.58 + aMisc.w * 0.8) * live;
  pos = c + (pos - c) * breath;

  // 少量粒子离开表面后再回归
  float escPhase = sin(t * aMisc.y * 1.55 + aRand.x * 6.2831);
  float escCurve = pow(max(escPhase, 0.0), 2.3);
  float esc = aMisc.x * escCurve * live * uEscape;
  pos += aNormal * esc * 0.62;
  pos.xz = c.xz + rot2(pos.xz - c.xz, esc * 0.22);

  /* ---------- 3. 光脉冲（克制：心的轮廓必须还认得出来） ---------- */
  float pulse = uPulse;
  pos += aNormal * pulse * (0.07 + aRand.x * 0.24);

  /* ---------- 4. 终章：部分粒子向外扩散 ---------- */
  float dmask = step(aMisc.z, uDisperseFrac);
  float dsp = uDisperse * dmask;
  vec3 outDir = normalize(
    aNormal * 0.8 +
    normalize(target - c + vec3(1e-4)) * 0.55 +
    flowField(target * 0.55, t * 0.25) * 0.4
  );
  pos += outDir * dsp * (0.9 + aRand.x * 2.9);
  pos.xz = c.xz + rot2(pos.xz - c.xz, dsp * (0.30 + aRand.w * 0.45));

  /* ---------- 5. 颜色 ---------- */
  float dN = aMisc.w;
  vec3 col = mix(uEdge, uMid, smoothstep(0.02, 0.42, dN));
  col = mix(col, uCore, pow(smoothstep(0.40, 1.0, dN), 1.5) * 0.5);

  float insideness = 1.0 - clamp(abs(target.z - c.z) / max(uHalfDepth, 1e-3), 0.0, 1.0);
  col = mix(col, uDeep, insideness * 0.6);
  col = mix(col, uCore, step(1.6, aRand.z) * 0.65);
  col = mix(col * vec3(1.05, 1.08, 1.15), col, pe);   // 飞行中偏冷白

  /* ---------- 6. 亮度 / 大小 ---------- */
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 0.15);

  float bright = 0.058 + 0.145 * aRand.x;
  // 内部亮度的云状起伏（缓慢流动）——避免“均匀撒粉”的噪点感
  bright *= 0.72 + 0.50 * (n1 * 0.5 + 0.5);
  bright *= 1.0 + step(1.6, aRand.z) * 1.7;                // 少量亮星
  bright *= mix(0.62, 1.0, pe);
  // 正面壳层比背面亮 → 体积感
  bright *= mix(0.52, 1.0, smoothstep(-uHalfDepth, uHalfDepth * 0.9, target.z - c.z));
  // 轮廓边缘轻微提亮（薄边受光）+ 厚实处的核心更亮 → 壳 + 核的体积读法
  bright *= 1.0 + (1.0 - smoothstep(0.0, 0.22, dN)) * 0.42;
  bright *= 1.0 + smoothstep(0.35, 1.0, dN) * 0.30;
  bright *= 1.0 + pulse * 1.85;
  bright *= 1.0 + esc * 1.5;
  bright *= mix(0.55, 1.0, smoothstep(26.0, 7.0, dist));   // 空间纵深
  // 扩散粒子：飞出去的过程中先更亮（像溅出的火花），最后才熄灭
  bright *= (1.0 - dsp * 0.80) * (1.0 + dsp * (1.0 - dsp) * 2.4);
  bright *= uFade;

  vColor = col;
  vIntensity = bright;
  vSharp = mix(3.2, 7.0, aRand.w);

  // 未落位时略大略柔（像失焦的尘雾），落位后收成细密的亮点
  float size = uSize * aRand.z * (1.0 + 0.62 * (1.0 - pe)) * (1.0 + pulse * 0.55 + esc * 0.5);
  gl_PointSize = clamp(size * uProjScale / dist, 0.55, 26.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3  vColor;
varying float vIntensity;
varying float vSharp;

${SOFT_POINT}

void main() {
  float a = softPoint(gl_PointCoord - 0.5, vSharp);
  if (a <= 0.001 || vIntensity <= 0.0005) discard;
  gl_FragColor = vec4(vColor * vIntensity, a);
}
`;

export class HeartParticles {
  constructor(config) {
    this.config = config;
    const cfg = config.heart;
    const data = buildHeartField(config.counts.heart, cfg);
    this.data = data;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.position, 3));
    geo.setAttribute('aStart', new BufferAttribute(data.start, 3));
    geo.setAttribute('aNormal', new BufferAttribute(data.normal, 3));
    geo.setAttribute('aRand', new BufferAttribute(data.rand, 4));
    geo.setAttribute('aMisc', new BufferAttribute(data.misc, 4));
    geo.boundingSphere = null;

    const col = config.colors;
    this.uniforms = {
      uTime: { value: 0 },
      uForm: { value: 0 },
      uStagger: { value: 0.52 },
      uFade: { value: 0 },
      uAlive: { value: 0 },
      uEscape: { value: 0 },
      uPulse: { value: 0 },
      uDisperse: { value: 0 },
      uDisperseFrac: { value: cfg.disperseRatio },
      uBreathe: { value: cfg.breathe },
      uSize: { value: 0.0135 },
      uProjScale: { value: 1200 },
      uHalfDepth: { value: cfg.depth },
      uCenter: { value: new Vector3().fromArray(cfg.center) },
      uCore: { value: new Color(col.heartCore) },
      uMid: { value: new Color(col.heartMid) },
      uDeep: { value: new Color(col.heartDeep) },
      uEdge: { value: new Color(col.heartEdge) },
    };

    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** @param {number} projScale 0.5 * drawingBufferHeight / tan(fov/2) */
  setProjScale(projScale) {
    this.uniforms.uProjScale.value = projScale;
  }

  update(time, state) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uForm.value = state.form;
    u.uFade.value = state.heartFade;
    u.uAlive.value = state.alive;
    u.uEscape.value = state.escape;
    u.uPulse.value = state.pulse;
    u.uDisperse.value = state.disperse;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
