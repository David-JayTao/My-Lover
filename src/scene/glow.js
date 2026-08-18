import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { buildHeartField } from './heartShape.js';
import { SIMPLEX3D, SOFT_POINT } from '../shaders/common.glsl.js';

/* ------------------------------------------------------------------ *
 * A. 心内部的体积柔光（大尺寸、极低强度的粒子 → 深浅层次）
 * ------------------------------------------------------------------ */
const GLOW_VERT = /* glsl */ `
precision highp float;
attribute vec4 aRand;
attribute vec4 aMisc;

uniform float uTime;
uniform float uFade;
uniform float uPulse;
uniform float uSize;
uniform float uProjScale;
uniform float uBreathe;
uniform vec3  uCenter;
uniform vec3  uColorA;
uniform vec3  uColorB;

varying vec3  vColor;
varying float vIntensity;

${SIMPLEX3D}

void main() {
  vec3 c = uCenter;
  vec3 pos = position;

  float n = snoise(position * 1.1 + vec3(0.0, 0.0, uTime * 0.13));
  pos += vec3(n, snoise(position * 1.3 + 11.0 + uTime * 0.1), n * 0.6) * 0.055;

  float breath = 1.0 + uBreathe * 1.5 * sin(uTime * 0.58 + 0.4);
  pos = c + (pos - c) * breath;
  pos += normalize(pos - c + vec3(1e-4)) * uPulse * 0.35;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 0.2);

  vColor = mix(uColorA, uColorB, aRand.w * 0.85 + aMisc.w * 0.15);
  float bright = (0.020 + 0.038 * aRand.x) * uFade;
  bright *= 0.35 + 0.65 * aMisc.w;                       // 越靠中心越亮
  bright *= 0.7 + 0.3 * sin(uTime * 0.5 + aRand.x * 6.28);
  bright *= 1.0 + uPulse * 2.0;
  vIntensity = bright;

  float size = uSize * (0.55 + aRand.z * 0.9) * (1.0 + uPulse * 0.35);
  gl_PointSize = clamp(size * uProjScale / dist, 4.0, 300.0);
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vIntensity;
${SOFT_POINT}
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv) * 2.0;
  if (r > 1.0 || vIntensity <= 0.0004) discard;
  float a = pow(max(0.0, 1.0 - r), 2.6);
  gl_FragColor = vec4(vColor * vIntensity, a);
}
`;

/* ------------------------------------------------------------------ *
 * B. 心形星云光晕（背后一层极淡的发光，营造空气感）
 * ------------------------------------------------------------------ */
const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* 光晕形状一次性烘进贴图（整屏噪声在集显上太贵） */
const HALO_BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uPlaneSize;
uniform float uHeartScale;
${SIMPLEX3D}

/* 经典二维心形隐函数：(x²+y²−1)³ − x²y³ < 0 为内部 */
float heartField(vec2 p){
  float a = dot(p, p) - 1.0;
  return a * a * a - p.x * p.x * p.y * p.y * p.y;
}

void main(){
  vec2 w = (vUv - 0.5) * uPlaneSize;
  // 垂直压扁一点，让光晕与粒子心的比例吻合（否则下方会拖出一团雾）
  vec2 p = vec2(w.x, w.y * 1.20) / uHeartScale;

  float f = heartField(p);
  float inner = exp(-3.2 * max(f, 0.0));
  float wide  = exp(-0.34 * max(f, 0.0)) * 0.20;
  float radial = exp(-dot(w, w) * 0.042) * 0.20;

  float n = snoise(vec3(p * 1.7, 0.0)) * 0.5 + 0.5;
  // 平面边缘必须完全消失，且要用圆形衰减（用 max(|x|,|y|) 会留下方形轮廓）
  float edge = 1.0 - smoothstep(0.26, 0.49, length(vUv - 0.5));

  float amt = (inner * 0.70 + wide + radial) * (0.72 + 0.38 * n) * edge;
  float mixv = clamp(inner + radial, 0.0, 1.0);
  gl_FragColor = vec4(amt, mixv, n, 1.0);
}
`;

const HALO_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uFade;
uniform float uPulse;
uniform sampler2D uMap;
uniform vec3  uColorInner;
uniform vec3  uColorOuter;

void main(){
  vec3 m = texture2D(uMap, vUv).rgb;
  float breath = 0.86 + 0.14 * sin(uTime * 0.55 + m.b * 1.4);
  float amt = m.r * breath * uFade * (1.0 + uPulse * 2.6);
  if (amt <= 0.0008) discard;
  vec3 col = mix(uColorOuter, uColorInner, m.g);
  gl_FragColor = vec4(col * amt, 1.0);
}
`;

export class HeartGlow {
  constructor(config) {
    const cfg = config.heart;
    const col = config.colors;
    const center = new Vector3().fromArray(cfg.center);

    /* --- 体积柔光粒子（全部在内部） --- */
    const data = buildHeartField(
      config.counts.innerGlow,
      { ...cfg, shellRatio: 0.0, escapeRatio: 0, depth: cfg.depth * 0.85 },
      907
    );
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.position, 3));
    geo.setAttribute('aRand', new BufferAttribute(data.rand, 4));
    geo.setAttribute('aMisc', new BufferAttribute(data.misc, 4));
    geo.boundingSphere = null;

    this.glowUniforms = {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uPulse: { value: 0 },
      uSize: { value: 0.34 },
      uProjScale: { value: 1200 },
      uBreathe: { value: cfg.breathe },
      uCenter: { value: center.clone() },
      uColorA: { value: new Color(col.glow) },
      uColorB: { value: new Color(col.heartDeep) },
    };

    this.points = new Points(
      geo,
      new ShaderMaterial({
        uniforms: this.glowUniforms,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;

    /* --- 心形星云光晕 --- */
    const planeSize = cfg.width * 5.2;
    this.planeSize = planeSize;
    this.heartScale = (cfg.width * 0.5 * 1.32) / 1.2;
    this.haloUniforms = {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uPulse: { value: 0 },
      uMap: { value: null },
      uColorInner: { value: new Color(col.glow) },
      uColorOuter: { value: new Color(col.heartDeep) },
    };
    this.halo = new Mesh(
      new PlaneGeometry(planeSize, planeSize),
      new ShaderMaterial({
        uniforms: this.haloUniforms,
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      })
    );
    this.halo.position.set(center.x, center.y, center.z - 1.15);
    this.halo.renderOrder = 1;
    this.halo.frustumCulled = false;
  }

  setProjScale(v) {
    this.glowUniforms.uProjScale.value = v;
  }

  /** 一次性烘出光晕贴图 */
  bake(renderer) {
    const rt = new WebGLRenderTarget(512, 512, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const scene = new Scene();
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: {
          uPlaneSize: { value: this.planeSize },
          uHeartScale: { value: this.heartScale },
        },
        vertexShader:
          'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: HALO_BAKE_FRAG,
      })
    );
    scene.add(quad);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    quad.geometry.dispose();
    quad.material.dispose();
    this.haloRT = rt;
    this.haloUniforms.uMap.value = rt.texture;
  }

  addTo(scene) {
    scene.add(this.halo);
    scene.add(this.points);
  }

  update(time, state) {
    this.glowUniforms.uTime.value = time;
    this.glowUniforms.uFade.value = state.innerGlow;
    this.glowUniforms.uPulse.value = state.pulse;
    this.haloUniforms.uTime.value = time;
    this.haloUniforms.uFade.value = state.innerGlow * 0.052;
    this.haloUniforms.uPulse.value = state.pulse;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.halo.geometry.dispose();
    this.halo.material.dispose();
    this.haloRT?.dispose();
  }
}
