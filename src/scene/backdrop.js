import {
  BackSide,
  Color,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderTarget,
} from 'three';
import { SIMPLEX3D } from '../shaders/common.glsl.js';

/**
 * 背景 = 垂直渐变 + 一层极淡星云。
 * 星云用 fbm，但**只烘一次**到 512×256 贴图里 —— 每帧算 4 层噪声
 * 会在集显上吃掉大量填充率（整屏 4 次 snoise/像素）。
 */
const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${SIMPLEX3D}
float fbm(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * snoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main(){
  // 让贴图在水平方向可无缝循环：用圆柱坐标取样
  float ang = vUv.x * 6.2831853;
  vec3 p = vec3(cos(ang) * 1.35, vUv.y * 2.2, sin(ang) * 1.35);
  float n = fbm(p * 1.15);
  float n2 = fbm(p * 2.6 + 4.0);
  float v = smoothstep(0.12, 0.95, n * 0.5 + 0.5) * (0.72 + 0.28 * (n2 * 0.5 + 0.5));
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
varying vec2 vUv;
void main(){
  vDir = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
varying vec2 vUv;

uniform float uTime;
uniform float uFade;
uniform vec3  uTop;
uniform vec3  uBottom;
uniform vec3  uNebula;
uniform sampler2D uNoise;

void main(){
  vec3 d = normalize(vDir);

  // 垂直渐变（上方更深，接近地平线略亮）
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.8));

  // 极淡星云，只在中部成带
  float neb = texture2D(uNoise, vec2(vUv.x + uTime * 0.0016, vUv.y)).r;
  float band = smoothstep(0.72, 0.02, abs(d.y + 0.04));
  col += uNebula * neb * band * 0.15;

  // 画面中心方向轻微提亮，制造空气与纵深
  float centerLift = smoothstep(0.55, 1.0, dot(d, vec3(0.0, 0.04, 1.0)));
  col += uNebula * centerLift * 0.045;

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export class Backdrop {
  constructor(config) {
    const col = config.colors;
    this.uniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uTop: { value: new Color(col.bgTop) },
      uBottom: { value: new Color(col.bgBottom) },
      uNebula: { value: new Color(col.nebula) },
      uNoise: { value: null },
    };
    this.mesh = new Mesh(
      new SphereGeometry(80, 40, 24),
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** 一次性烘出星云贴图 */
  bake(renderer) {
    const rt = new WebGLRenderTarget(512, 256, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.wrapS = RepeatWrapping;
    const scene = new Scene();
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: BAKE_FRAG,
      })
    );
    scene.add(quad);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    quad.geometry.dispose();
    quad.material.dispose();
    this.noiseRT = rt;
    this.uniforms.uNoise.value = rt.texture;
  }

  update(time, state) {
    this.uniforms.uTime.value = time;
    this.uniforms.uFade.value = state.backdrop;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.noiseRT?.dispose();
  }
}
