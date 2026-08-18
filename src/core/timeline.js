import { clamp01, linear } from './easing.js';

/**
 * 极简确定性时间轴。
 *
 * 特点：每一帧都由绝对时间重新求值（而不是累加），
 * 因此 Replay / 跳转 / 掉帧 都不会让状态漂移 —— 对录屏很重要。
 *
 *   tl.track(2, 3, easeOutCubic, k => state.opacity = k);   // 第 2s 起，3s 内 0→1
 *   tl.cue(16.2, () => showText(), () => hideText());        // 事件（含回退）
 */
export class Timeline {
  constructor(duration = 30) {
    this.duration = duration;
    this.tracks = [];
    this.cues = [];
    this.time = 0;
    this._prev = -1;
  }

  /** @param {number} start 秒 @param {number} dur 秒 @param {(t:number)=>number} ease @param {(k:number)=>void} apply */
  track(start, dur, ease, apply) {
    this.tracks.push({ start, dur: Math.max(dur, 1e-6), ease: ease || linear, apply });
    return this;
  }

  /** 区间写法：[start, end] */
  span(range, ease, apply) {
    return this.track(range[0], range[1] - range[0], ease, apply);
  }

  /** 自定义包络（apply 收到 0..1 的原始进度，自行决定形状） */
  raw(start, dur, apply) {
    return this.track(start, dur, linear, apply);
  }

  /** 时间点事件；undo 用于时间轴回退（Replay） */
  cue(time, fire, undo) {
    this.cues.push({ time, fire, undo, done: false });
    this.cues.sort((a, b) => a.time - b.time);
    return this;
  }

  reset() {
    this._prev = -1;
    // 必须按时间倒序回退：先撤销晚发生的事件，再撤销早发生的。
    // 否则「隐藏字幕」的 undo（= 重新显示）会跑在「显示字幕」的 undo 之后，
    // 导致 Replay 后字幕还留在屏幕上。
    for (let i = this.cues.length - 1; i >= 0; i--) {
      const c = this.cues[i];
      if (c.done && c.undo) c.undo();
      c.done = false;
    }
    this.evaluate(0);
  }

  /** 求值到绝对时间 t（不推进内部时钟） */
  evaluate(t) {
    this.time = t;
    for (const tr of this.tracks) {
      const k = clamp01((t - tr.start) / tr.dur);
      tr.apply(tr.ease(k), t);
    }
    // 前进：按时间正序触发
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i];
      if (!c.done && t >= c.time) {
        c.done = true;
        c.fire && c.fire();
      }
    }
    // 回退：按时间倒序撤销
    for (let i = this.cues.length - 1; i >= 0; i--) {
      const c = this.cues[i];
      if (c.done && t < c.time) {
        c.done = false;
        c.undo && c.undo();
      }
    }
    this._prev = t;
  }
}

/** 攻击 → 衰减 包络，用于“光脉冲”这类一次性冲击 */
export function impulse(k, attackRatio = 0.18) {
  if (k <= 0 || k >= 1) return 0;
  if (k < attackRatio) {
    const a = k / attackRatio;
    return a * a * (3 - 2 * a); // smoothstep 上升
  }
  const d = (k - attackRatio) / (1 - attackRatio);
  return Math.pow(1 - d, 2.2); // 平滑衰减
}
