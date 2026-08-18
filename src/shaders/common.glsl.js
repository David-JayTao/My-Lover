/** 共享 GLSL 片段（以字符串形式注入各个 shader） */

/* 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT) */
export const SIMPLEX3D = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/**
 * 便宜且几乎无散度的流场（用三角函数组合近似 curl noise）。
 * 比真正的 curl noise 省 6 次噪声采样，视觉上同样“有机”。
 */
export const FLOW_FIELD = /* glsl */ `
vec3 flowField(vec3 p, float t){
  vec3 v;
  v.x = sin(p.y * 1.27 + t * 0.63) + 0.52 * sin(p.z * 2.11 - t * 0.44) + 0.26 * sin(p.y * 4.3 + t * 0.9);
  v.y = sin(p.z * 1.61 - t * 0.55) + 0.52 * sin(p.x * 2.33 + t * 0.38) + 0.26 * sin(p.z * 3.9 - t * 0.8);
  v.z = sin(p.x * 1.13 + t * 0.47) + 0.52 * sin(p.y * 1.87 - t * 0.41) + 0.26 * sin(p.x * 4.1 + t * 0.7);
  return v * 0.577;
}
`;

export const ROT2D = /* glsl */ `
vec2 rot2(vec2 v, float a){
  float c = cos(a), s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}
`;

export const HASH = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2  hash21(float p){ vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`;

/** 柔和圆形粒子的 alpha（带亮核 + 长尾光晕） */
export const SOFT_POINT = /* glsl */ `
float softPoint(vec2 uv, float coreSharp){
  float r = length(uv) * 2.0;
  if (r > 1.0) return 0.0;
  float halo = pow(max(0.0, 1.0 - r), 2.0);
  float core = pow(max(0.0, 1.0 - r), coreSharp);
  return halo * 0.55 + core * 0.9;
}
`;

/** 四角星芒（用于少量“晶体反光”雪尘） */
export const STAR_GLINT = /* glsl */ `
float starGlint(vec2 uv, float spikes){
  vec2 p = uv * 2.0;
  float r = length(p);
  float core = pow(max(0.0, 1.0 - r), 3.0);
  float ax = pow(max(0.0, 1.0 - abs(p.x) * 5.5), 2.0) * pow(max(0.0, 1.0 - abs(p.y) * 0.95), 3.0);
  float ay = pow(max(0.0, 1.0 - abs(p.y) * 5.5), 2.0) * pow(max(0.0, 1.0 - abs(p.x) * 0.95), 3.0);
  vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  float dx = pow(max(0.0, 1.0 - abs(d.x) * 7.0), 2.0) * pow(max(0.0, 1.0 - abs(d.y) * 1.15), 3.0);
  float dy = pow(max(0.0, 1.0 - abs(d.y) * 7.0), 2.0) * pow(max(0.0, 1.0 - abs(d.x) * 1.15), 3.0);
  return core + (ax + ay) * spikes * 0.55 + (dx + dy) * spikes * 0.22;
}
`;
