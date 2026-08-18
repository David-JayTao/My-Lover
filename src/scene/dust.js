import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { STAR_GLINT } from '../shaders/common.glsl.js';

const VERT = /* glsl */ `
precision highp float;
attribute vec4 aRand;   // seed, fallSpeed, size, glint

uniform float uTime;
uniform float uFade;
uniform float uProjScale;
uniform float uSize;
uniform float uMinY;
uniform float uSpanY;
uniform float uPulse;
uniform vec3  uCenter;
uniform vec3  uColor;
uniform vec3  uColorWarm;

varying vec3  vColor;
varying float vIntensity;
varying float vSpikes;

void main(){
  vec3 pos = position;

  // 极慢下落 + 环绕漂移（雪/微晶）
  float fall = uTime * (0.045 + aRand.y * 0.11);
  float y = pos.y - fall;
  y = mod(y - uMinY, uSpanY) + uMinY;
  pos.y = y;
  pos.x += sin(uTime * 0.21 + aRand.x * 6.2831) * 0.42
         + sin(uTime * 0.073 + aRand.w * 6.2831) * 0.75;
  pos.z += cos(uTime * 0.17 + aRand.w * 6.2831) * 0.38;

  // 光脉冲带来的轻微气流
  pos += normalize(pos - uCenter + vec3(1e-4)) * uPulse * 0.30;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 0.2);

  float tw = 0.55 + 0.45 * sin(uTime * (0.5 + aRand.y * 1.6) + aRand.x * 6.2831);
  vColor = mix(uColor, uColorWarm, pow(aRand.w, 3.0) * 0.5);
  float depthFade = smoothstep(30.0, 8.0, dist) * 0.7 + 0.3;
  float nearFade = smoothstep(1.2, 3.4, dist);         // 避免贴近镜头的巨大光斑
  vIntensity = (0.075 + 0.34 * pow(aRand.z, 2.2)) * tw * depthFade * nearFade * uFade;
  vSpikes = smoothstep(0.80, 1.0, aRand.w);

  float size = uSize * (0.4 + pow(aRand.z, 2.6) * 1.35);
  gl_PointSize = clamp(size * uProjScale / dist, 0.8, 9.5);
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
  if (vIntensity <= 0.0004) discard;
  float a = starGlint(gl_PointCoord - 0.5, vSpikes);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor * vIntensity, min(a, 1.0));
}
`;

export class Dust {
  constructor(config) {
    const count = config.counts.dust;
    let s = 20250807 >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const minY = -9.5;
    const spanY = 19.0;
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() * 2 - 1) * 17;
      pos[i * 3 + 1] = minY + rnd() * spanY;
      pos[i * 3 + 2] = -15 + rnd() * 22;
      rand[i * 4] = rnd();
      rand[i * 4 + 1] = rnd();
      rand[i * 4 + 2] = rnd();
      rand[i * 4 + 3] = rnd();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new BufferAttribute(rand, 4));
    geo.boundingSphere = null;

    this.uniforms = {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uProjScale: { value: 1200 },
      uSize: { value: 0.05 },
      uMinY: { value: minY },
      uSpanY: { value: spanY },
      uPulse: { value: 0 },
      uCenter: { value: new Vector3().fromArray(config.heart.center) },
      uColor: { value: new Color(config.colors.dust) },
      uColorWarm: { value: new Color(config.colors.starWarm) },
    };

    this.points = new Points(
      geo,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setProjScale(v) {
    this.uniforms.uProjScale.value = v;
  }

  update(time, state) {
    this.uniforms.uTime.value = time;
    this.uniforms.uFade.value = state.dust;
    this.uniforms.uPulse.value = state.pulse;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
