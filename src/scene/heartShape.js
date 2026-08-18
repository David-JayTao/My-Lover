/**
 * 心形采样器。
 *
 * 思路：
 *  1. 用经典心形参数曲线取轮廓多边形；
 *  2. 预计算一张有符号距离场（SDF）网格；
 *  3. 拒绝采样得到心内部的点，并用「到边界的距离」决定厚度，
 *     得到一个有饱满体积感的立体心（而不是一片扁平贴图）；
 *  4. 由厚度函数的解析梯度得到表面法线，供“离开表面 / 光脉冲 / 扩散”使用。
 */

const TAU = Math.PI * 2;

/** 构建心形 SDF（内部为正） */
export function buildHeartSDF(width, res = 200, segments = 384) {
  const px = new Float64Array(segments);
  const py = new Float64Array(segments);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * TAU;
    const s = Math.sin(t);
    const x = 16 * s * s * s;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    px[i] = x;
    py[i] = y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // 归一化：宽度对齐到 width，垂直居中
  const scale = width / 32;
  const yMid = (maxY + minY) / 2;
  for (let i = 0; i < segments; i++) {
    px[i] *= scale;
    py[i] = (py[i] - yMid) * scale;
  }

  const halfW = width / 2;
  const halfH = ((maxY - minY) / 2) * scale;
  const pad = width * 0.08;
  const minX = -halfW - pad;
  const maxX = halfW + pad;
  const gMinY = -halfH - pad;
  const gMaxY = halfH + pad;
  const cellX = (maxX - minX) / (res - 1);
  const cellY = (gMaxY - gMinY) / (res - 1);

  const sdf = new Float32Array(res * res);
  let maxD = 0;

  for (let gy = 0; gy < res; gy++) {
    const y = gMinY + gy * cellY;
    for (let gx = 0; gx < res; gx++) {
      const x = minX + gx * cellX;
      let best = Infinity;
      let inside = false;
      for (let j = 0; j < segments; j++) {
        const k = j === segments - 1 ? 0 : j + 1;
        const x1 = px[j], y1 = py[j], x2 = px[k], y2 = py[k];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x1 + t * dx - x;
        const ey = y1 + t * dy - y;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
        if (y1 > y !== y2 > y) {
          const xi = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
          if (x < xi) inside = !inside;
        }
      }
      const d = Math.sqrt(best) * (inside ? 1 : -1);
      sdf[gy * res + gx] = d;
      if (d > maxD) maxD = d;
    }
  }

  const field = {
    res,
    minX,
    minY: gMinY,
    cellX,
    cellY,
    maxD,
    width,
    height: halfH * 2,
    /** 双线性插值取有符号距离 */
    at(x, y) {
      const fx = (x - minX) / cellX;
      const fy = (y - gMinY) / cellY;
      if (fx < 0 || fy < 0 || fx > res - 1 || fy > res - 1) return -1;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, res - 1), y1 = Math.min(y0 + 1, res - 1);
      const tx = fx - x0, ty = fy - y0;
      const a = sdf[y0 * res + x0], b = sdf[y0 * res + x1];
      const c = sdf[y1 * res + x0], d = sdf[y1 * res + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    },
  };
  return field;
}

/**
 * 生成心形粒子场。
 * @returns {{position:Float32Array, start:Float32Array, normal:Float32Array,
 *            rand:Float32Array, misc:Float32Array, count:number}}
 */
export function buildHeartField(count, cfg, rngSeed = 20250829) {
  const {
    width,
    depth,
    center = [0, 0, 0],
    shellRatio = 0.72,
    escapeRatio = 0.13,
    disperseRatio = 0.34,
  } = cfg;

  // 可复现的伪随机
  let seed = rngSeed >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const field = buildHeartSDF(width);
  const invMaxD = 1 / field.maxD;
  const eps = Math.max(field.cellX, field.cellY) * 0.75;

  const position = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  const misc = new Float32Array(count * 4);

  const cx = center[0], cy = center[1], cz = center[2];
  const halfW = width * 0.5 + field.cellX;
  const halfH = field.height * 0.5 + field.cellY;
  const D_MIN = 0.02;

  let i = 0;
  let guard = 0;
  while (i < count && guard < count * 400) {
    guard++;
    const sx = (rnd() * 2 - 1) * halfW;
    const sy = (rnd() * 2 - 1) * halfH;
    const d = field.at(sx, sy);
    if (d <= 0.006) continue;

    let dN = d * invMaxD;
    if (dN > 1) dN = 1;

    // 厚度剖面：中心饱满、边缘收薄（丝绒枕头感）
    const dClamped = Math.max(dN, D_MIN);
    const halfT = depth * Math.pow(dClamped, 0.5);

    const isShell = rnd() < shellRatio;
    const side = rnd() < 0.5 ? -1 : 1;

    // 法线 = 厚度曲面 z = T * d^0.5 的解析法线
    const dxD = (field.at(sx + eps, sy) - field.at(sx - eps, sy)) * invMaxD / (2 * eps);
    const dyD = (field.at(sx, sy + eps) - field.at(sx, sy - eps)) * invMaxD / (2 * eps);
    const k = depth * 0.5 / Math.sqrt(dClamped);
    let nx = -k * dxD;
    let ny = -k * dyD;
    let nz = side;

    /**
     * 壳层要按「曲面面积」采样，而不是按 xy 均匀采样：
     * 边缘处曲面很陡，同样的 dx 对应更多表面积。
     * 这一步让轮廓自然出现一圈更密的亮边（切向看穿壳层），
     * 而不是整颗心均匀撒粉的“糖屑感”。
     */
    if (isShell) {
      const areaW = Math.sqrt(1 + nx * nx + ny * ny) / 2.6;
      if (rnd() > Math.min(areaW, 1)) continue;
    }

    let z;
    if (isShell) {
      // 贴壳：集中在 |z| ≈ halfT，带极小的抖动
      const jitter = Math.pow(rnd(), 2.4) * 0.075;
      z = side * halfT * (1 - jitter);
    } else {
      // 体积内部：靠外稍密，形成层次
      z = side * halfT * Math.pow(rnd(), 0.62);
    }
    // 边缘粒子的法线更贴近“向外”，内部粒子更贴近 ±z
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const i3 = i * 3;
    position[i3] = sx + cx;
    position[i3 + 1] = sy + cy;
    position[i3 + 2] = z + cz;
    normal[i3] = nx;
    normal[i3 + 1] = ny;
    normal[i3 + 2] = nz;

    // 起点：环绕整个空间的一层壳（从四周被吸引到中心）
    // 半径不宜过大，否则飞行途中密度太低，看不出“被吸过来”的流
    // 半径必须让粒子云一开始就在画面内（否则 Scene 2 会有几秒空画面）
    const ang = rnd() * TAU;
    const rr = 3.6 + Math.pow(rnd(), 0.85) * 5.2;
    const sxs = Math.cos(ang) * rr * 1.3;
    const szs = Math.sin(ang) * rr * 0.55 - 1.0;
    const sys = (rnd() - 0.5) * 6.8 * (0.5 + 0.5 * rnd());
    start[i3] = sxs;
    start[i3 + 1] = sys + cy * 0.6;
    start[i3 + 2] = Math.min(szs, 5.5);

    // rand: seed / delay / size / colorMix
    const sizeR = rnd();
    rand[i * 4] = rnd();
    rand[i * 4 + 1] = Math.pow(rnd(), 0.88);
    // 尺寸分布偏向细小颗粒（避免密集处变成一片“泡泡”），另有少量“亮星”
    rand[i * 4 + 2] =
      sizeR < 0.955 ? 0.32 + Math.pow(sizeR, 1.9) * 1.05 : 1.7 + rnd() * 1.5;
    rand[i * 4 + 3] = rnd();

    // misc: escape 强度 / escape 速度 / disperse key / dNorm
    const esc = rnd();
    misc[i * 4] =
      isShell && esc < escapeRatio ? 0.35 + Math.pow(rnd(), 1.5) * 0.95 : 0.0;
    misc[i * 4 + 1] = 0.28 + rnd() * 0.6;
    misc[i * 4 + 2] = rnd(); // 与 disperseRatio 比较
    misc[i * 4 + 3] = dN;

    i++;
  }

  return { position, start, normal, rand, misc, count: i, field, disperseRatio };
}
