import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { HASH } from '../shaders/common.glsl.js';

/* ------------------------------------------------------------------ *
 * 翅膀贴图：用 Canvas2D 手工绘制（贝塞尔轮廓 + 渐变 + 翅脉 + 发光边缘）。
 * 解析函数很难画出优雅的蝶翼轮廓，改成一次性烘一张 512² 贴图，
 * 既好看又比逐像素解析形状便宜。
 * uv: x = 翼根→翼尖，y = 前缘→后缘
 * ------------------------------------------------------------------ */
export function makeWingTexture(colors, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const S = size;
  const P = (x, y) => [x * S, y * S];

  g.clearRect(0, 0, S, S);

  /* --- 轮廓 --- */
  // 前翅：前缘微凸 → 翼尖（外上角）→ 外缘 → 内凹的后缘
  const forewing = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(...P(0.030, 0.345));
    ctx.bezierCurveTo(...P(0.285, 0.120), ...P(0.600, 0.020), ...P(0.905, 0.072));
    ctx.bezierCurveTo(...P(0.960, 0.190), ...P(0.855, 0.290), ...P(0.700, 0.365));
    ctx.bezierCurveTo(...P(0.470, 0.500), ...P(0.195, 0.492), ...P(0.030, 0.345));
    ctx.closePath();
  };
  // 后翅：更小，且与前翅有明显重叠（真实蝴蝶前后翅是叠在一起的）
  const hindwing = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(...P(0.030, 0.330));
    ctx.bezierCurveTo(...P(0.255, 0.395), ...P(0.430, 0.500), ...P(0.470, 0.645));
    ctx.bezierCurveTo(...P(0.488, 0.790), ...P(0.340, 0.885), ...P(0.185, 0.858));
    ctx.bezierCurveTo(...P(0.075, 0.832), ...P(-0.010, 0.560), ...P(0.030, 0.330));
    ctx.closePath();
  };

  /* --- 膜面渐变：翼根冰蓝 → 翼尖蓝紫 --- */
  const grad = g.createLinearGradient(0.05 * S, 0.25 * S, 0.98 * S, 0.55 * S);
  grad.addColorStop(0.0, colors.a);
  grad.addColorStop(0.45, colors.mid);
  grad.addColorStop(1.0, colors.b);

  for (const path of [hindwing, forewing]) {
    g.save();
    path(g);
    g.fillStyle = grad;
    g.globalAlpha = 0.9;
    g.fill();
    g.restore();
  }

  /* --- 后缘压暗，形成厚度与层次 --- */
  for (const path of [hindwing, forewing]) {
    g.save();
    path(g);
    g.clip();
    const shade = g.createLinearGradient(0, 0.18 * S, 0, S);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.55, 'rgba(2,6,20,0.16)');
    shade.addColorStop(1, 'rgba(2,6,20,0.5)');
    g.fillStyle = shade;
    g.fillRect(0, 0, S, S);
    g.restore();
  }

  /* --- 翅脉：从翼根放射，末端渐细 --- */
  const hinge = P(0.045, 0.348);
  const hinge2 = P(0.048, 0.400);
  const veinTargets = [
    [0.480, 0.088], [0.700, 0.062], [0.870, 0.118], [0.895, 0.235],
    [0.740, 0.348], [0.520, 0.420], [0.270, 0.438],
    [0.395, 0.525], [0.455, 0.655], [0.385, 0.800], [0.245, 0.848], [0.110, 0.770],
  ];
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < veinTargets.length; i++) {
    const [tx, ty] = veinTargets[i];
    const t = P(tx, ty);
    const root = i < 7 ? hinge : hinge2;
    // 轻微弯曲的翅脉
    const mx = (root[0] + t[0]) / 2 + (i % 2 ? 1 : -1) * 0.018 * S;
    const my = (root[1] + t[1]) / 2 + 0.016 * S;
    const lg = g.createLinearGradient(root[0], root[1], t[0], t[1]);
    lg.addColorStop(0, 'rgba(214,236,255,0.40)');
    lg.addColorStop(0.7, 'rgba(196,224,255,0.18)');
    lg.addColorStop(1, 'rgba(190,220,255,0.0)');
    g.strokeStyle = lg;
    g.lineWidth = S * (i < 7 ? 0.0080 : 0.0068);
    g.beginPath();
    g.moveTo(root[0], root[1]);
    g.quadraticCurveTo(mx, my, t[0], t[1]);
    g.stroke();
  }
  g.restore();

  /* --- 翼尖的几处柔光斑（morpho 感，不要画成卡通圆点） --- */
  const spots = [
    [0.700, 0.165, 0.080, 0.15],
    [0.840, 0.205, 0.050, 0.11],
    [0.285, 0.680, 0.075, 0.10],
  ];
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [sx, sy, sr, sa] of spots) {
    const rg = g.createRadialGradient(sx * S, sy * S, 0, sx * S, sy * S, sr * S);
    rg.addColorStop(0, `rgba(236,247,255,${sa})`);
    rg.addColorStop(1, 'rgba(236,247,255,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(sx * S, sy * S, sr * S, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  /* --- 发光边缘（先外发光，再一条细亮线） --- */
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const path of [hindwing, forewing]) {
    path(g);
    g.shadowColor = 'rgba(150,205,255,0.85)';
    g.shadowBlur = S * 0.018;
    g.strokeStyle = 'rgba(150,205,255,0.30)';
    g.lineWidth = S * 0.010;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = colors.edge;
    g.lineWidth = S * 0.0042;
    g.stroke();
  }
  g.restore();

  /* --- 前缘一条更亮的高光 --- */
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  g.moveTo(...P(0.032, 0.342));
  g.bezierCurveTo(...P(0.300, 0.095), ...P(0.620, 0.025), ...P(0.930, 0.095));
  g.strokeStyle = 'rgba(240,250,255,0.55)';
  g.lineWidth = S * 0.0055;
  g.stroke();
  g.restore();

  return cv;
}

/* ------------------------------------------------------------------ *
 * 几何体：两片翅膀（可形变网格）+ 纺锤形身体 + 触角
 * ------------------------------------------------------------------ */
const PART_WING = 0;
const PART_BODY = 1;
const PART_ANTENNA = 2;

function buildButterflyGeometry() {
  const positions = [];
  const uvs = [];
  const sides = [];
  const parts = [];
  const indices = [];

  const push = (x, y, z, u, v, side, part) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    sides.push(side);
    parts.push(part);
    return positions.length / 3 - 1;
  };

  /* --- 翅膀：u = 从身体到翼尖，v = 前缘到后缘 --- */
  const SU = 10;
  const SV = 10;
  const SPAN = 1.0;
  const CHORD = 0.95;
  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    for (let j = 0; j <= SV; j++) {
      for (let i = 0; i <= SU; i++) {
        const u = i / SU;
        const v = j / SV;
        // 轻微弧面（不是一张纯平面）；+Z 为前进方向，故 v=0（前缘）在 +Z
        const camber = Math.sin(u * Math.PI) * 0.045 + Math.sin(v * Math.PI) * 0.02;
        push(side * u * SPAN, camber * 0.25, (0.40 - v) * CHORD, u, v, side, PART_WING);
      }
    }
    for (let j = 0; j < SV; j++) {
      for (let i = 0; i < SU; i++) {
        const a = base + j * (SU + 1) + i;
        const b = a + 1;
        const c = a + (SU + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  /* --- 身体：两片交叉的软光片 --- */
  const bodyQuad = (axis) => {
    const base = positions.length / 3;
    const w = 0.062;
    const z0 = -0.34;
    const z1 = 0.34;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const z = z0 + (z1 - z0) * u;
        const taper = Math.sin(Math.pow(u, 0.85) * Math.PI) * 0.85 + 0.15;
        const off = (j === 0 ? -1 : 1) * w * taper;
        const x = axis === 'x' ? off : 0;
        const y = axis === 'x' ? 0 : off;
        push(x, y, z, u, j, 0, PART_BODY);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = base + i;
      const b = a + 1;
      const c = base + 7 + i;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  };
  bodyQuad('x');
  bodyQuad('y');

  /* --- 触角 --- */
  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    const N = 5;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const px = side * (0.085 * Math.pow(s, 1.25));
      const py = 0.075 * Math.pow(s, 1.6);
      const pz = 0.32 + 0.2 * s;
      const w = 0.014 * (1 - s * 0.75);
      push(px - w, py, pz, s, 0, side, PART_ANTENNA);
      push(px + w, py, pz, s, 1, side, PART_ANTENNA);
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('aSide', new BufferAttribute(new Float32Array(sides), 1));
  geo.setAttribute('aPart', new BufferAttribute(new Float32Array(parts), 1));
  geo.setIndex(indices);
  return geo;
}

/* ------------------------------------------------------------------ *
 * Shader
 * ------------------------------------------------------------------ */
/**
 * 全部运动都在 GPU 上解析求值：
 *   轨道位置、朝向（look-at）、扇翅、登场淡入、终章飞离
 * CPU 每帧只更新几个 uniform —— 不再有任何逐帧顶点缓冲上传。
 * （之前用 InstancedMesh + 每帧 instanceMatrix 上传，在 ANGLE / D3D11 上
 *   会造成约 6ms/帧 的管线停顿，占 1080p 下整帧预算的三分之一。）
 */
const ORBIT_GLSL = /* glsl */ `
/* aOrbitA: radius, speed, phase, tilt
   aOrbitB: vAmp, vSpeed, vPhase, zSquash
   aOrbitC: wobble, escape, yOff, scale */
vec3 orbitAt(vec4 A, vec4 B, vec4 C, float t, float disperse, vec3 center){
  float ang = t * A.y * 2.0 + A.z;
  float r = A.x * (1.0 + 0.10 * sin(t * 0.31 + A.z * 1.7)) + disperse * C.y * 5.0;
  float x = cos(ang) * r + sin(t * 1.31 + C.x) * 0.06;
  float z = sin(ang) * r * B.w;
  float y = sin(t * B.y * 2.0 + B.z) * B.x
          + sin(ang * 2.0) * 0.14
          + sin(t * 1.7 + C.x) * 0.045;
  float ct = cos(A.w), st = sin(A.w);
  return vec3(x, y * ct - z * st + C.z, y * st + z * ct) + center;
}

/* 登场：按 appear 依次淡入；终章：部分个体飞离画面并淡出 */
float orbitOpacity(float appear, float escape, float progress, float disperse){
  float k = clamp((progress - appear * 0.82) / 0.18, 0.0, 1.0);
  float op = k * k * (3.0 - 2.0 * k);
  // 飞离的个体要基本消失，否则收尾定格里会留下半只被画面边缘切掉的蝴蝶
  op *= 1.0 - disperse * (escape > 0.0 ? 0.94 : 0.15);
  return op;
}
`;

const VERT = /* glsl */ `
precision highp float;
attribute float aSide;
attribute float aPart;
attribute vec4  aOrbitA;
attribute vec4  aOrbitB;
attribute vec4  aOrbitC;
attribute vec4  aInst;     // flapPhase, flapSpeed, appear, tint
attribute float aFlapAmp;

uniform float uTime;
uniform float uDisperse;
uniform float uProgress;
uniform vec3  uCenter;
uniform vec3  uCamPos;

varying vec2  vUv;
varying float vPart;
varying float vOpacity;
varying float vTint;
varying float vFacing;

${ORBIT_GLSL}

void main(){
  vec3 p = position;
  float u = uv.x;
  float flapAngle = 0.0;
  float t = uTime * aInst.y + aInst.x;

  if (aPart < 0.5) {
    // 翼尖相位滞后 → 膜状柔软感
    float lag = u * 0.95;
    // 非对称扇动：上挥快、回落慢，并在“张开”附近停留更久
    float s0 = sin(t - lag);
    float shaped = sign(s0) * pow(abs(s0), 1.75);
    float a = 0.40 + aFlapAmp * shaped;
    a += 0.14 * sin(t * 2.0 - lag * 1.6) * u * u;
    flapAngle = a;
    float sg = aSide * a;
    float c = cos(sg), sn = sin(sg);
    p.xy = vec2(p.x * c - p.y * sn, p.x * sn + p.y * c);
    p.z += sin(t - lag) * 0.055 * u;      // 前后轻微掠动
  } else {
    p.y += sin(t) * 0.012;                // 身体 / 触角随扇动起伏
    p.z += cos(t) * 0.004;
  }

  /* ---- 轨道位置与朝向（+Z 朝飞行方向，背部略朝镜头） ---- */
  vec3 p0 = orbitAt(aOrbitA, aOrbitB, aOrbitC, uTime, uDisperse, uCenter);
  vec3 p1 = orbitAt(aOrbitA, aOrbitB, aOrbitC, uTime + 0.05, uDisperse, uCenter);
  /**
   * 机头方向要压掉垂直分量：轨道里的上下起伏速度和水平速度同量级，
   * 直接拿完整速度当朝向会让蝴蝶俯冲/爬升到近乎垂直，
   * 翅膀被压成一条侧看的薄片（像海鸟），飞行方向也变得难以辨认。
   * 真实蝴蝶是机身基本保持水平、靠拍翅上下起伏。
   * 注意：仍然满足 forward · velocity > 0，不会倒飞。
   */
  vec3 vel = p1 - p0;
  vel.y *= 0.22;
  vec3 zAxis = normalize(vel + vec3(0.0, 0.0, 1e-5));
  vec3 toCam = normalize(uCamPos - p0);
  vec3 up = normalize(vec3(0.0, 0.34, 0.0) + toCam * 0.90);
  if (abs(dot(up, zAxis)) > 0.97) up = vec3(0.0, 1.0, 0.0);
  vec3 xAxis = normalize(cross(up, zAxis));
  vec3 yAxis = cross(zAxis, xAxis);

  float scale = aOrbitC.w;
  vec3 world = p0 + (xAxis * p.x + yAxis * p.y + zAxis * p.z) * scale;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);

  /* ---- 透明度：登场 / 飞离 / 前后景 ---- */
  float op = orbitOpacity(aInst.z, aOrbitC.y, uProgress, uDisperse);
  // 在心之后压暗（遮挡感），在心之前提亮（否则会被明亮的心吞掉）
  op *= p0.z < uCenter.z ? 0.60 : 1.28;
  vOpacity = op;
  vTint = aInst.w;

  /* ---- 翅膜受光：正对镜头最亮 ---- */
  vec3 nLocal = vec3(0.0, 1.0, 0.0);
  if (aPart < 0.5) {
    float sg = aSide * flapAngle;
    nLocal = vec3(-sin(sg) * aSide, cos(sg), 0.0);
  }
  vec3 nWorld = xAxis * nLocal.x + yAxis * nLocal.y + zAxis * nLocal.z;
  vec3 nView = normalize((modelViewMatrix * vec4(nWorld, 0.0)).xyz);
  vFacing = abs(dot(nView, normalize(-mv.xyz)));

  vUv = uv;
  vPart = aPart;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2  vUv;
varying float vPart;
varying float vOpacity;
varying float vTint;
varying float vFacing;

uniform vec3  uColA;
uniform vec3  uColEdge;
uniform float uTime;
uniform float uWingGain;
uniform sampler2D uWing;

${HASH}

void main(){
  float u = vUv.x, v = vUv.y;
  vec3 col;
  float amt;

  if (vPart < 0.5) {
    /* ---------- 翅膀（采样烘好的蝶翼贴图） ---------- */
    vec4 tex = texture2D(uWing, vec2(u, v));
    if (tex.a <= 0.004) discard;
    col = mix(tex.rgb, uColEdge, 0.12 * vTint);

    // 极细的鳞粉闪点（让翅膜在动的时候有微光）
    float sparkle = step(0.9972, hash11(floor(u * 96.0) * 31.7 + floor(v * 96.0) * 7.3))
                    * (0.45 + 0.55 * sin(uTime * 6.0 + u * 30.0));

    amt = tex.a * uWingGain * (1.0 + sparkle * 1.6);
    amt *= 0.30 + 0.70 * vFacing;
  } else if (vPart < 1.5) {
    /* ---------- 身体 ---------- */
    float across = abs(v - 0.5) * 2.0;
    float a = exp(-across * across * 2.6) * (0.55 + 0.45 * sin(u * 3.14159));
    a *= 0.8 + 0.6 * smoothstep(0.55, 1.0, u);     // 头部略亮
    col = mix(uColEdge, uColA, 0.5);
    amt = a * 0.26 * (0.45 + 0.55 * vFacing);
  } else {
    /* ---------- 触角 ---------- */
    float across = abs(v - 0.5) * 2.0;
    col = mix(uColA, uColEdge, 0.5);
    amt = (1.0 - across) * (1.0 - u * 0.55) * 0.075;
  }

  amt *= vOpacity;
  if (amt <= 0.0015) discard;
  gl_FragColor = vec4(col * amt, 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * 拖尾星尘：同一条解析轨道上的「过去时刻」，同样零上传
 * ------------------------------------------------------------------ */
const TRAIL_VERT = /* glsl */ `
precision highp float;
attribute vec4  aOrbitA;
attribute vec4  aOrbitB;
attribute vec4  aOrbitC;
attribute vec4  aMeta;    // age01, rand1, rand2, appear

uniform float uTime;
uniform float uDisperse;
uniform float uProgress;
uniform float uLife;
uniform float uProjScale;
uniform vec3  uCenter;

varying float vA;

${ORBIT_GLSL}

void main(){
  float age = aMeta.x * uLife;
  vec3 pos = orbitAt(aOrbitA, aOrbitB, aOrbitC, uTime - age, uDisperse, uCenter);
  pos.y += age * 0.09 * (0.4 + aMeta.z);
  pos.x += age * 0.02 * (aMeta.y - 0.5);

  float op = orbitOpacity(aMeta.w, aOrbitC.y, uProgress, uDisperse);
  vA = pow(1.0 - aMeta.x, 2.0) * (0.20 + 0.28 * aMeta.y) * op;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 0.2);
  gl_PointSize = clamp(
    0.15 * aOrbitC.w * (0.5 + aMeta.y) * uProjScale / dist * (1.0 - aMeta.x * 0.35),
    0.8, 14.0
  );
  gl_Position = projectionMatrix * mv;
}
`;

const TRAIL_FRAG = /* glsl */ `
precision highp float;
varying float vA;
uniform vec3 uColor;
void main(){
  if (vA <= 0.0015) discard;
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor * vA, pow(1.0 - r, 2.2));
}
`;

const TRAIL_SLOTS = 26;
const TRAIL_LIFE = 1.6;

export class Butterflies {
  constructor(config) {
    this.config = config;
    const n = config.counts.butterflies;
    this.count = n;
    const bcfg = config.butterfly;
    const col = config.colors;
    this.center = new Vector3().fromArray(config.heart.center);

    let s = 77771 >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    /* 每只蝴蝶的轨道参数：尺度 / 深度 / 速度 / 轨道各不相同 */
    this.info = [];
    for (let i = 0; i < n; i++) {
      const f = i / Math.max(n - 1, 1);
      this.info.push({
        scale: bcfg.minScale + (bcfg.maxScale - bcfg.minScale) * Math.pow(rnd(), 1.35),
        radius: bcfg.minRadius + (bcfg.maxRadius - bcfg.minRadius) * rnd(),
        speed: (rnd() < 0.5 ? -1 : 1) * (0.14 + rnd() * 0.22),
        phase: f * Math.PI * 2 + rnd() * 0.9,
        // 轨道平面差异要大，否则几只会在画面上挤成一小群
        tilt: (rnd() - 0.5) * 1.7,
        vAmp: 0.35 + rnd() * 0.75,
        yOff: (rnd() - 0.5) * 1.35,
        vSpeed: 0.32 + rnd() * 0.45,
        vPhase: rnd() * Math.PI * 2,
        zSquash: 0.72 + rnd() * 0.3,
        flapPhase: rnd() * Math.PI * 2,
        flapSpeed: bcfg.flapSpeed[0] + rnd() * (bcfg.flapSpeed[1] - bcfg.flapSpeed[0]),
        flapAmp: 0.54 + rnd() * 0.22,
        tint: rnd(),
        escape: rnd() < 0.45 ? 0.7 + rnd() * 0.6 : 0.0,
        wobble: rnd() * Math.PI * 2,
        appear: f,
      });
    }

    const orbitA = (b) => [b.radius, b.speed, b.phase, b.tilt];
    const orbitB = (b) => [b.vAmp, b.vSpeed, b.vPhase, b.zSquash];
    const orbitC = (b) => [b.wobble, b.escape, b.yOff, b.scale];

    /* ---------------- 蝴蝶本体（instanced，属性全部静态） ---------------- */
    const geo = buildButterflyGeometry();
    const aA = new Float32Array(n * 4);
    const aB = new Float32Array(n * 4);
    const aC = new Float32Array(n * 4);
    const aInst = new Float32Array(n * 4);
    const aFlap = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.info[i];
      aA.set(orbitA(b), i * 4);
      aB.set(orbitB(b), i * 4);
      aC.set(orbitC(b), i * 4);
      aInst.set([b.flapPhase, b.flapSpeed, b.appear, b.tint], i * 4);
      aFlap[i] = b.flapAmp;
    }
    geo.setAttribute('aOrbitA', new InstancedBufferAttribute(aA, 4));
    geo.setAttribute('aOrbitB', new InstancedBufferAttribute(aB, 4));
    geo.setAttribute('aOrbitC', new InstancedBufferAttribute(aC, 4));
    geo.setAttribute('aInst', new InstancedBufferAttribute(aInst, 4));
    geo.setAttribute('aFlapAmp', new InstancedBufferAttribute(aFlap, 1));

    const wingCanvas = makeWingTexture({
      a: col.butterflyA,
      mid: '#86bfff',
      b: col.butterflyB,
      edge: 'rgba(232,246,255,0.95)',
    });
    const wingTex = new CanvasTexture(wingCanvas);
    wingTex.colorSpace = SRGBColorSpace;
    wingTex.minFilter = LinearMipmapLinearFilter;
    wingTex.magFilter = LinearFilter;
    wingTex.anisotropy = 4;
    this.wingTex = wingTex;

    this.uniforms = {
      uTime: { value: 0 },
      uDisperse: { value: 0 },
      uProgress: { value: 0 },
      uCenter: { value: this.center.clone() },
      uCamPos: { value: new Vector3() },
      uWing: { value: wingTex },
      uWingGain: { value: 0.5 },
      uColA: { value: new Color(col.butterflyA) },
      uColEdge: { value: new Color(col.butterflyEdge) },
    };

    this.mesh = new InstancedMesh(
      geo,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
      }),
      n
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;

    /* ---------------- 拖尾（静态几何 + 解析求值） ---------------- */
    const tCount = n * TRAIL_SLOTS;
    const tPos = new Float32Array(tCount * 3);   // 位置由 shader 算，这里只占位
    const tA = new Float32Array(tCount * 4);
    const tB = new Float32Array(tCount * 4);
    const tC = new Float32Array(tCount * 4);
    const tMeta = new Float32Array(tCount * 4);
    for (let i = 0; i < n; i++) {
      const b = this.info[i];
      for (let j = 0; j < TRAIL_SLOTS; j++) {
        const k = i * TRAIL_SLOTS + j;
        tA.set(orbitA(b), k * 4);
        tB.set(orbitB(b), k * 4);
        tC.set(orbitC(b), k * 4);
        // age01 在 (0,1] 上均匀分布 → 一条连续的尘埃带
        tMeta.set([(j + 1) / TRAIL_SLOTS, rnd(), rnd(), b.appear], k * 4);
      }
    }
    const tGeo = new BufferGeometry();
    tGeo.setAttribute('position', new BufferAttribute(tPos, 3));
    tGeo.setAttribute('aOrbitA', new BufferAttribute(tA, 4));
    tGeo.setAttribute('aOrbitB', new BufferAttribute(tB, 4));
    tGeo.setAttribute('aOrbitC', new BufferAttribute(tC, 4));
    tGeo.setAttribute('aMeta', new BufferAttribute(tMeta, 4));
    tGeo.boundingSphere = null;

    this.trailUniforms = {
      uTime: { value: 0 },
      uDisperse: { value: 0 },
      uProgress: { value: 0 },
      uLife: { value: TRAIL_LIFE },
      uProjScale: { value: 1200 },
      uCenter: { value: this.center.clone() },
      uColor: { value: new Color(col.butterflyA) },
    };
    this.trail = new Points(
      tGeo,
      new ShaderMaterial({
        uniforms: this.trailUniforms,
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      })
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 5;
  }

  addTo(scene) {
    scene.add(this.trail);
    scene.add(this.mesh);
  }

  setProjScale(v) {
    this.trailUniforms.uProjScale.value = v;
  }

  /** 解析轨道 —— 与 shader 里的 orbitAt 保持一致（外部需要时可用） */
  pathAt(i, t, disperse, out) {
    const b = this.info[i];
    const ang = t * b.speed * 2 + b.phase;
    const r =
      b.radius * (1 + 0.1 * Math.sin(t * 0.31 + b.phase * 1.7)) +
      disperse * b.escape * 5;
    const x = Math.cos(ang) * r + Math.sin(t * 1.31 + b.wobble) * 0.06;
    const z = Math.sin(ang) * r * b.zSquash;
    const y =
      Math.sin(t * b.vSpeed * 2 + b.vPhase) * b.vAmp +
      Math.sin(ang * 2) * 0.14 +
      Math.sin(t * 1.7 + b.wobble) * 0.045;
    const ct = Math.cos(b.tilt);
    const st = Math.sin(b.tilt);
    return out.set(
      x + this.center.x,
      y * ct - z * st + b.yOff + this.center.y,
      y * st + z * ct + this.center.z
    );
  }

  /** 保留接口：解析拖尾不需要重置 */
  resetTrails() {}

  update(time, state, camera) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDisperse.value = state.disperse;
    u.uProgress.value = state.butterflies;
    u.uCamPos.value.copy(camera.position);
    const t = this.trailUniforms;
    t.uTime.value = time;
    t.uDisperse.value = state.disperse;
    t.uProgress.value = state.butterflies;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.trail.geometry.dispose();
    this.trail.material.dispose();
    this.wingTex.dispose();
  }
}
