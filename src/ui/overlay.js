/**
 * DOM 字幕 / 入口 / Replay。
 * 文案全部来自 config.js —— 这里只负责“怎么优雅地出现”。
 */

/** 把一行文字拆成可逐字入场的 span */
function buildLine(el, text) {
  el.innerHTML = '';
  const tokens = text.match(/[A-Za-z]+|\s+|[^\s]/g) || [];
  let i = 0;
  for (const tk of tokens) {
    const span = document.createElement('span');
    if (/^\s+$/.test(tk)) {
      span.className = 'ch sp';
      span.innerHTML = '&nbsp;';
    } else if (/^[A-Za-z]+$/.test(tk)) {
      span.className = 'ch amp';
      span.textContent = tk;
    } else {
      span.className = 'ch';
      span.textContent = tk;
    }
    span.style.setProperty('--i', String(i++));
    el.appendChild(span);
  }
  // --n 用于让「字距收紧」的位移相对行中心对称展开
  el.style.setProperty('--n', String(i));
}

export class Overlay {
  constructor(config) {
    this.config = config;
    this.cinema = document.getElementById('cinema');
    this.entry = document.getElementById('entry');
    this.replayBtn = document.getElementById('replay');

    document.getElementById('entryTitle').textContent = config.text.entry;
    document.getElementById('entryHint').textContent = config.text.entryHint;
    this.replayBtn.textContent = config.text.replay;

    const lines = [config.text.title, config.text.subtitle, config.text.finale];
    this.lines = lines.map((txt, idx) => {
      const el = document.createElement('div');
      el.className = 'line';
      el.id = `line${idx + 1}`;
      buildLine(el, txt);
      this.cinema.appendChild(el);
      return el;
    });

    // 标题下方的细光线
    this.hairline = document.createElement('div');
    this.hairline.className = 'hairline';
    this.cinema.appendChild(this.hairline);
  }

  setLoading() {
    this.entry.classList.add('is-loading');
  }

  setReady() {
    this.entry.classList.remove('is-loading');
    this.entry.classList.add('is-ready');
  }

  dismissEntry() {
    this.entry.classList.add('is-gone');
    this.replayBtn.hidden = false;
  }

  showEntry() {
    this.entry.classList.remove('is-gone');
  }

  showLine(i) {
    const el = this.lines[i];
    if (!el) return;
    el.classList.remove('is-out');
    el.classList.add('is-in');
    if (i === 0) {
      this.hairline.classList.remove('is-out');
      this.hairline.classList.add('is-in');
    }
  }

  hideLine(i) {
    const el = this.lines[i];
    if (!el) return;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    if (i === 0) {
      this.hairline.classList.remove('is-in');
      this.hairline.classList.add('is-out');
    }
  }

  /** 立刻把某一行恢复成“还没出现”（无反向动画） */
  resetLine(i) {
    const el = this.lines[i];
    if (!el) return;
    el.classList.remove('is-in', 'is-out');
    el.style.transition = 'none';
    for (const ch of el.children) ch.style.transition = 'none';
    void el.offsetWidth; // 强制回流
    el.style.transition = '';
    for (const ch of el.children) ch.style.transition = '';
    if (i === 0) {
      this.hairline.classList.remove('is-in', 'is-out');
      this.hairline.style.transition = 'none';
      void this.hairline.offsetWidth;
      this.hairline.style.transition = '';
    }
  }

  /** 立刻恢复到“什么都没出现”的状态（Replay） */
  resetLines() {
    for (let i = 0; i < this.lines.length; i++) this.resetLine(i);
  }

  onStart(fn) {
    this.entry.addEventListener('click', fn);
    this.entry.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') fn();
      },
      false
    );
  }

  onReplay(fn) {
    this.replayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      this.replayBtn.blur();
    });
  }

  toggleUI(hidden) {
    this.replayBtn.classList.toggle('is-hidden', hidden);
  }
}
