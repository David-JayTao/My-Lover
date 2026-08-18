import {
  ACESFilmicToneMapping,
  Clock,
  HalfFloatType,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import CONFIG from './config.js';
import * as E from './core/easing.js';
import { Timeline, impulse } from './core/timeline.js';
import { PostFX } from './core/postfx.js';
import { Backdrop } from './scene/backdrop.js';
import { Starfield } from './scene/stars.js';
import { Dust } from './scene/dust.js';
import { HeartParticles } from './scene/heart.js';
import { HeartGlow } from './scene/glow.js';
import { Butterflies } from './scene/butterflies.js';
import { Overlay } from './ui/overlay.js';

/* ------------------------------------------------------------------ *
 * URL 参数（仅用于开发 / 录制辅助）
 *   ?t=20    从第 20 秒开始并自动播放
 *   ?auto=1  自动播放
 *   ?fps=1   显示帧率
 *   ?nofs=1  不请求全屏
 *   ?dpr=1.25          强制像素比（按录制分辨率测试）
 *   ?heart=N / ?bf=N   覆盖粒子 / 蝴蝶数量（调参与定位性能）
 *   ?capture=1         保留绘制缓冲，允许 canvas.toDataURL 精确取帧
 * ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const seekParam = parseFloat(params.get('t') || '0') || CONFIG.debugStartTime || 0;
const autoStart = params.has('auto') || params.has('t');
const showFps = params.has('fps');
const noFullscreen = params.has('nofs') || params.has('t');
const dprOverride = parseFloat(params.get('dpr') || '0') || 0;

if (params.has('heart')) {
  const n = parseInt(params.get('heart'), 10);
  if (n > 1000) CONFIG.counts.heart = n;
}
if (params.has('bf')) {
  const n = parseInt(params.get('bf'), 10);
  if (n >= 1) CONFIG.counts.butterflies = n;
}

/* ------------------------------------------------------------------ *
 * 全局动画状态（由时间轴写入，各系统读取）
 * ------------------------------------------------------------------ */
const IDLE_STARS = 0.42;
const state = {
  backdrop: 1,
  stars: IDLE_STARS,
  dust: 0,
  heartFade: 0,
  form: 0,
  alive: 0,
  escape: 0,
  innerGlow: 0,
  butterflies: 0,
  pulse: 0,
  disperse: 0,
  screenFade: 1,
  bloomStrength: CONFIG.quality.bloom.strength,
};

/* ------------------------------------------------------------------ *
 * 渲染器 / 场景 / 相机
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('stage');
const renderer = new WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: params.has('capture'),
});
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.quality.exposure;

const scene = new Scene();
const camera = new PerspectiveCamera(CONFIG.camera.fov, 16 / 9, 0.1, 200);
camera.position.fromArray(CONFIG.camera.keys[0][1]);

const overlay = new Overlay(CONFIG);
overlay.setLoading();

let postfx = null;
let backdrop = null;
let stars = null;
let dust = null;
let heart = null;
let glow = null;
let butterflies = null;
let tl = null;
let ready = false;

let dpr = 1;

/* ------------------------------------------------------------------ *
 * 构建场景（心形采样有一定计算量，放在入口画面之后执行）
 * ------------------------------------------------------------------ */
function buildScene() {
  backdrop = new Backdrop(CONFIG);
  backdrop.bake(renderer);
  scene.add(backdrop.mesh);

  stars = new Starfield(CONFIG);
  stars.addTo(scene);

  dust = new Dust(CONFIG);
  scene.add(dust.points);

  glow = new HeartGlow(CONFIG);
  glow.bake(renderer);
  glow.addTo(scene);

  heart = new HeartParticles(CONFIG);
  scene.add(heart.points);

  butterflies = new Butterflies(CONFIG);
  butterflies.addTo(scene);

  const rt = new WebGLRenderTarget(1920, 1080, {
    type: HalfFloatType,
    samples: CONFIG.quality.msaa,
  });
  postfx = new PostFX(renderer, scene, camera, CONFIG, rt);

  tl = buildTimeline();
  resize();

  // 预编译所有 shader，避免第一次出现某个图层时出现掉帧
  renderer.compile(scene, camera);

  ready = true;
  overlay.setReady();

  if (autoStart) start(seekParam);
}

/* ------------------------------------------------------------------ *
 * 时间轴
 * ------------------------------------------------------------------ */
function buildTimeline() {
  const T = CONFIG.timeline;
  const baseBloom = CONFIG.quality.bloom.strength;
  const t = new Timeline(T.duration);

  /* --- Scene 1 寂静 --- */
  t.span(T.stars.in, E.easeInOutSine, (k) => {
    state.stars = IDLE_STARS + (1 - IDLE_STARS) * k;
  });
  t.span(T.dust.in, E.easeOutCubic, (k) => (state.dust = k));

  /* --- Scene 2 + 3 苏醒与成形 --- */
  t.span(T.heartFade.in, E.easeOutCubic, (k) => (state.heartFade = k));
  t.span(T.form.in, E.easeGather, (k) => (state.form = k));
  t.span(T.alive.in, E.easeInOutSine, (k) => {
    state.alive = k;
    state.escape = k * 0.85;
  });
  t.span(T.innerGlow.in, E.easeOutCubic, (k) => (state.innerGlow = k));

  /* --- Scene 4 蝴蝶 --- */
  t.span(T.butterflies.in, E.linear, (k) => (state.butterflies = k));

  /* --- Scene 5 / 6 / 7 文字 --- */
  t.cue(T.text1.in, () => overlay.showLine(0), () => overlay.resetLine(0));
  t.cue(T.text1.out, () => overlay.hideLine(0), () => overlay.showLine(0));
  t.cue(T.text2.in, () => overlay.showLine(1), () => overlay.resetLine(1));
  t.cue(T.text2.out, () => overlay.hideLine(1), () => overlay.showLine(1));
  t.cue(T.text3.in, () => overlay.showLine(2), () => overlay.resetLine(2));

  /**
   * 字幕与爱心的轻微互动（复用已有的亮度通道，不新增系统）：
   *   · 第一句出现时，爱心整体亮度轻微回落约 7%，把注意力让给文字
   *   · 第二句出现前后恢复到正常亮度
   *   · 最后一句出现时抬升约 8%，配合原有的光脉冲，像一次呼吸
   * 这两条轨道必须注册在 heartFade / innerGlow 之后 —— 它们是乘性修饰。
   */
  const dipFrom = T.text1.in - 0.6;
  const dipTo = T.text2.in + 1.2;
  t.raw(dipFrom, dipTo - dipFrom, (k) => {
    if (k <= 0 || k >= 1) return;
    const dip = 1 - 0.07 * Math.sin(Math.PI * k);
    state.heartFade *= dip;
    state.innerGlow *= dip;
  });
  t.span([T.text3.in - 0.3, T.text3.in + 2.2], E.easeInOutSine, (k) => {
    const lift = 1 + 0.08 * k;
    state.heartFade *= lift;
    state.innerGlow *= lift;
  });

  /* --- 光脉冲（终章唯一的一次，克制的呼吸而不是爆闪） --- */
  const pulseDur = T.pulse.attack + T.pulse.decay;
  t.raw(T.pulse.at, pulseDur, (k) => {
    const e = impulse(k, T.pulse.attack / pulseDur);
    state.pulse = e;
    state.bloomStrength = baseBloom * (1 + e * 0.85);
    state.escape = Math.max(state.escape, e * 0.9);
  });

  /* --- 终章扩散 --- */
  t.span(T.disperse.in, E.easeOutQuad, (k) => (state.disperse = k));

  return t;
}

/* ------------------------------------------------------------------ *
 * 相机路径
 * ------------------------------------------------------------------ */
const camPos = new Vector3();
const camLook = new Vector3();

function sampleCamera(tlTime, time) {
  const keys = CONFIG.camera.keys;
  let i = 0;
  while (i < keys.length - 2 && tlTime > keys[i + 1][0]) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = Math.max(b[0] - a[0], 1e-3);
  const k = E.smootherstep(E.clamp01((tlTime - a[0]) / span));

  camPos.set(
    E.lerp(a[1][0], b[1][0], k),
    E.lerp(a[1][1], b[1][1], k),
    E.lerp(a[1][2], b[1][2], k)
  );
  camLook.set(
    E.lerp(a[2][0], b[2][0], k),
    E.lerp(a[2][1], b[2][1], k),
    E.lerp(a[2][2], b[2][2], k)
  );

  // 极轻微的呼吸式漂移（不是手持抖动，只是让画面不死）
  const d = CONFIG.camera.driftAmp;
  camPos.x += Math.sin(time * 0.187) * d + Math.sin(time * 0.071 + 1.7) * d * 0.7;
  camPos.y += Math.sin(time * 0.143 + 0.6) * d * 0.75 + Math.sin(time * 0.052) * d * 0.4;
  camPos.z += Math.sin(time * 0.109 + 2.2) * d * 0.5 + state.pulse * 0.16;
  camLook.x += Math.sin(time * 0.093 + 0.4) * d * 0.35;
  camLook.y += Math.sin(time * 0.121 + 2.9) * d * 0.3;

  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

/* ------------------------------------------------------------------ *
 * 尺寸 / DPR
 * ------------------------------------------------------------------ */
let qualityScale = 1;
let uiHidden = false;

function computeDpr() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const max = CONFIG.quality.maxDPR * qualityScale;
  let d = Math.min(dprOverride || window.devicePixelRatio || 1, max);
  // 像素总量上限，避免 4K 屏上过载
  const budget = 1920 * 1080 * 2.35;
  if (w * h * d * d > budget) d = Math.sqrt(budget / (w * h));
  return Math.max(0.75, d);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  dpr = computeDpr();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (postfx) postfx.setSize(w, h, dpr);

  // gl_PointSize 以设备像素为单位
  const projScale =
    (0.5 * h * dpr) / Math.tan((CONFIG.camera.fov * Math.PI) / 360);
  if (heart) heart.setProjScale(projScale);
  if (glow) glow.setProjScale(projScale);
  if (stars) stars.setProjScale(projScale);
  if (dust) dust.setProjScale(projScale);
  if (butterflies) butterflies.setProjScale(projScale);
}

window.addEventListener('resize', () => {
  if (ready) resize();
});

/* ------------------------------------------------------------------ *
 * 播放控制
 * ------------------------------------------------------------------ */
let playing = false;
let paused = false;
let tlTime = 0;
let time = 0;
const clock = new Clock();

function start(seek = 0) {
  if (!ready) return;
  overlay.dismissEntry();
  if (!noFullscreen && !document.fullscreenElement) {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        const p = req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* 浏览器可能拒绝，不影响播放 */
      }
    }
  }
  tl.reset();
  overlay.resetLines();
  butterflies.resetTrails();
  tlTime = seek;
  playing = true;
  paused = false;
  tl.evaluate(tlTime);
}

function replay() {
  if (!ready) return;
  tl.reset();
  overlay.resetLines();
  butterflies.resetTrails();
  tlTime = 0;
  playing = true;
  paused = false;
  tl.evaluate(0);
}

overlay.onStart(() => {
  if (!playing) start(0);
});
overlay.onReplay(replay);

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'r') replay();
  else if (k === 'h') overlay.toggleUI((uiHidden = !uiHidden));
  else if (k === ' ') {
    e.preventDefault();
    paused = !paused;
  } else if (k === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else if (k === 'enter' && !playing) {
    start(0);
  }
});

/* ------------------------------------------------------------------ *
 * 自适应画质
 * ------------------------------------------------------------------ */
let frames = 0;
let acc = 0;
let degradeStep = 0;
let slowSeconds = 0;
let fpsEl = null;
if (showFps) {
  fpsEl = document.createElement('div');
  fpsEl.style.cssText =
    'position:fixed;left:10px;top:8px;z-index:99;font:11px/1.4 monospace;color:#8fd0ff;opacity:.75;pointer-events:none';
  document.body.appendChild(fpsEl);
}

function monitor(realDt) {
  frames++;
  acc += realDt;
  if (acc >= 1.0) {
    const fps = frames / acc;
    if (fpsEl) {
      fpsEl.textContent = `${fps.toFixed(1)} fps · dpr ${dpr.toFixed(2)} · t ${tlTime.toFixed(1)}s`;
    }
    // 只有连续多秒都掉帧才降画质：单次卡顿（GC / 系统抖动）不应该
    // 永久降低录制画质
    if (fps < 48) slowSeconds++;
    else slowSeconds = 0;
    if (CONFIG.quality.adaptive && playing && tlTime > 3 && slowSeconds >= 3) {
      slowSeconds = 0;
      if (degradeStep === 0) {
        degradeStep = 1;
        qualityScale = 0.82;
        resize();
      } else if (degradeStep === 1) {
        degradeStep = 2;
        qualityScale = 0.66;
        resize();
      }
    }
    frames = 0;
    acc = 0;
  }
}

/* ------------------------------------------------------------------ *
 * 主循环
 * ------------------------------------------------------------------ */
let captureResolve = null;

function frame() {
  requestAnimationFrame(frame);
  if (!ready) return;

  const realDt = clock.getDelta();
  let dt = Math.min(realDt, 0.06);
  if (paused) dt = 0;

  time += dt;
  if (playing) {
    tlTime += dt;
    tl.evaluate(tlTime);
  }

  sampleCamera(playing ? tlTime : 0, time);

  backdrop.update(time, state);
  stars.update(time, state);
  dust.update(time, state);
  glow.update(time, state);
  heart.update(time, state);
  butterflies.update(time, state, camera);
  postfx.update(time, state);
  postfx.render(dt);

  if (captureResolve) {
    const fn = captureResolve;
    captureResolve = null;
    fn(canvas.toDataURL('image/png'));
  }

  monitor(realDt);
}

/* 入口画面先绘制出来，再做重计算（心形采样），避免首屏卡顿。
   rAF 在后台标签页 / 被遮挡的窗口里可能不触发，所以加一个定时器兜底。 */
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  buildScene();
  clock.getDelta();
  frame();
}
requestAnimationFrame(() => requestAnimationFrame(boot));
setTimeout(boot, 180);

/* 便于调试：window.__qixi */
window.__qixi = {
  get state() {
    return state;
  },
  get time() {
    return tlTime;
  },
  seek(v) {
    if (!ready) return;
    if (!playing) start(v);
    else {
      tlTime = v;
      tl.evaluate(v);
    }
  },
  /** 跳到某一时刻并冻结（截图 / 检查构图用） */
  freeze(v) {
    if (!ready) return;
    if (!playing) start(v);
    tlTime = v;
    tl.evaluate(v);
    paused = true;
  },
  resume() {
    paused = false;
  },
  /** 在渲染完成的同一帧内取回画布像素（截图用，需 ?capture=1） */
  capture() {
    return new Promise((res) => {
      captureResolve = res;
    });
  },
  gpu() {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  },
  start,
  replay,
  CONFIG,
  /** 调试：按名字开关某个图层 */
  layer(name, on) {
    const map = {
      backdrop: backdrop?.mesh,
      stars: stars?.layers.map((l) => l.points),
      dust: dust?.points,
      heart: heart?.points,
      glow: glow?.points,
      halo: glow?.halo,
      butterflies: butterflies?.mesh,
      trail: butterflies?.trail,
    };
    const v = map[name];
    if (!v) return false;
    (Array.isArray(v) ? v : [v]).forEach((o) => (o.visible = on));
    return true;
  },
  bloom(on) {
    postfx.bloom.enabled = on;
  },
};
