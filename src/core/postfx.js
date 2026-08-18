import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * 最终调色 pass：极轻的色差、暗角、胶片颗粒、S 曲线对比、整体淡入淡出。
 * 目的是把「WebGL 渲染」推向「电影画面」，而不是加滤镜。
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.72 },
    uGrain: { value: 0.035 },
    uCA: { value: 0.0016 },
    uLift: { value: 0.006 },
    uContrast: { value: 1.045 },
    uSaturation: { value: 1.03 },
    uFade: { value: 1 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uLift, uContrast, uSaturation, uFade, uAspect;
    varying vec2 vUv;

    float hash(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      /* 极轻微的横向色差（只在画面外围可见） */
      vec2 off = c * uCA * (0.35 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      /* 暗角 */
      float vig = 1.0 - uVignette * pow(smoothstep(0.05, 0.82, r2 * 1.9), 1.35);
      col *= vig;

      /* 冷调抬黑 + S 曲线 */
      col += vec3(uLift * 0.5, uLift * 0.8, uLift * 1.6) * (1.0 - smoothstep(0.0, 0.5, length(col)));
      col = (col - 0.5) * uContrast + 0.5;

      /* 饱和度 */
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);

      /* 胶片颗粒（暗部更明显，亮部保持干净） */
      float g = hash(uv * vec2(uAspect, 1.0) * 900.0 + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.0, 0.75, lum));

      col = max(col, 0.0) * uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * 修正 UnrealBloomPass 的高斯核。
 *
 * three 里预计算的系数用 sigma = kernelRadius，最外一个采样点的权重仍有中心的
 * 约 60%，等于把高斯截断成方形支撑 —— 亮点周围会出现清晰可见的方块光晕
 * （在星点这种小而亮的元素上尤其明显）。
 * 这里换成 sigma = R/2.6，让核在边界处衰减到几乎为 0。
 */
function fixBloomKernel(bloom) {
  const mats = bloom.separableBlurMaterials;
  if (!Array.isArray(mats)) return;
  for (const mat of mats) {
    const u = mat.uniforms && mat.uniforms.gaussianCoefficients;
    if (!u || !Array.isArray(u.value)) continue;
    const R = u.value.length;
    const sigma = Math.max(R / 2.6, 0.8);
    const c = [];
    for (let i = 0; i < R; i++) {
      c.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
    }
    u.value = c;
  }
}

export class PostFX {
  constructor(renderer, scene, camera, config, renderTarget) {
    const q = config.quality;
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomScale = q.bloomScale ?? 0.5;
    this.bloom = new UnrealBloomPass(
      new Vector2(
        window.innerWidth * this.bloomScale,
        window.innerHeight * this.bloomScale
      ),
      q.bloom.strength,
      q.bloom.radius,
      q.bloom.threshold
    );
    fixBloomKernel(this.bloom);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;
    const g = q.grade;
    this.grade.uniforms.uVignette.value = g.vignette;
    this.grade.uniforms.uGrain.value = g.grain;
    this.grade.uniforms.uCA.value = g.chromatic;
    this.grade.uniforms.uLift.value = g.lift;
    this.grade.uniforms.uContrast.value = g.contrast;
    this.grade.uniforms.uSaturation.value = g.saturation;
    this.composer.addPass(this.grade);
  }

  setSize(w, h, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * dpr * this.bloomScale, h * dpr * this.bloomScale);
    this.grade.uniforms.uAspect.value = w / h;
  }

  update(time, state) {
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uFade.value = state.screenFade;
    this.bloom.strength = state.bloomStrength;
  }

  render(delta) {
    this.composer.render(delta);
  }
}
