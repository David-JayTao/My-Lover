/**
 * 极简 Web Audio 氛围音：
 *   · 一层缓慢移动的 pad（四个失谐振荡器 + 低通 + 卷积混响）
 *   · 事件触发的 sparkle（五声音阶短音，衰减很长）
 *   · 终章一次柔和的 swell
 * 全部在用户点击后才创建，规避 autoplay policy。
 */

const CHORDS = [
  [146.83, 220.0, 349.23, 523.25], // Dm9 —— 寂静
  [130.81, 196.0, 329.63, 493.88], // Cmaj9 —— 苏醒
  [174.61, 261.63, 392.0, 587.33], // Fmaj9 —— 成形
  [196.0, 293.66, 440.0, 659.26], // Gmaj9 —— 终章
];

const PENTA = [523.25, 587.33, 659.26, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

export class Ambient {
  constructor(config) {
    this.config = config;
    this.ctx = null;
    this.started = false;
    this.oscs = [];
    this.gains = [];
  }

  _reverb(seconds = 3.2, decay = 2.6) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  start() {
    if (!this.config.audio.enabled || this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // 混响总线
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.85;
    const rev = this._reverb();
    this.wet.connect(rev);
    rev.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.5;
    this.dry.connect(this.master);

    // pad
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 480;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.dry);
    this.padFilter.connect(this.wet);

    const chord = CHORDS[0];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = chord[i];
      osc.detune.value = (i - 1.5) * 6;

      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.34 : 0.2 - i * 0.03;

      // 每个声部一个极慢的音量 LFO，避免死板
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.035 + i * 0.021;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.07;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();

      osc.connect(g);
      g.connect(this.padFilter);
      osc.start();
      this.oscs.push(osc);
      this.gains.push(g);
    }

    // 一层极低的底噪（空气感）
    const noiseLen = ctx.sampleRate * 2;
    const nbuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = nbuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.4;
    const ng = ctx.createGain();
    ng.gain.value = 0.012;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(this.wet);
    noise.start();
    this.noise = noise;

    // 主音量淡入
    const now = ctx.currentTime;
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.config.audio.volume, now + 4.5);
  }

  /** 和声推进（0..3） */
  chord(idx) {
    if (!this.ctx) return;
    const c = CHORDS[Math.min(idx, CHORDS.length - 1)];
    const now = this.ctx.currentTime;
    this.oscs.forEach((osc, i) => {
      osc.frequency.setTargetAtTime(c[i], now, 1.6);
    });
  }

  /** 打开滤镜 = 情绪变亮 */
  brightness(hz, time = 2.5) {
    if (!this.ctx) return;
    this.padFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, time);
  }

  sparkle(count = 3, spread = 1.1, gainScale = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + Math.random() * spread;
      const osc = ctx.createOscillator();
      osc.type = Math.random() < 0.5 ? 'sine' : 'triangle';
      osc.frequency.value = PENTA[(Math.random() * PENTA.length) | 0] * (Math.random() < 0.25 ? 2 : 1);
      const g = ctx.createGain();
      const peak = (0.05 + Math.random() * 0.05) * gainScale;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4 + Math.random());
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.connect(g);
      if (pan) {
        pan.pan.value = (Math.random() * 2 - 1) * 0.7;
        g.connect(pan);
        pan.connect(this.wet);
        pan.connect(this.dry);
      } else {
        g.connect(this.wet);
      }
      osc.start(t);
      osc.stop(t + 2.6);
    }
  }

  /** 终章的一次柔和涌起 */
  swell() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 98;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.16, t + 0.5);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    sub.connect(sg);
    sg.connect(this.dry);
    sg.connect(this.wet);
    sub.start(t);
    sub.stop(t + 4.5);

    this.brightness(2600, 1.2);
    this.sparkle(9, 2.4, 1.15);
    setTimeout(() => this.brightness(1500, 3.0), 2200);
  }

  fadeOut(seconds = 2.5) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, seconds / 3);
  }

  /** Replay：把状态拉回起点 */
  restart() {
    if (!this.ctx) {
      this.start();
      return;
    }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.config.audio.volume, now + 3.0);
    this.chord(0);
    this.brightness(480, 1.0);
  }
}
