# To My Lover：雪

一个用 WebGL 实时渲染的七夕视觉作品：深蓝夜空、被吸引聚合的粒子爱心、蓝色光蝶、
柔和 bloom 与电影式字幕。约 34 秒的完整时间轴，最后停在一帧适合录屏收尾的静态画面上。

不是网页模板，是一个专门为 1920×1080 全屏播放 / 录屏设计的实时场景。

---

## 快速开始

```bash
npm install
npm run dev          # 开发预览 → http://localhost:5173
```

```bash
npm run build        # 产出 dist/
npm run preview      # 本地预览构建结果 → http://localhost:4173
```

> `dist/index.html` 不能直接用 `file://` 打开（ES module 会被浏览器的 CORS 策略拦住），
> 用 `npm run preview` 或任意静态服务器即可。

推荐浏览器：Chrome / Edge（最新版）。

---

## 录屏建议

1. 打开页面，等中间的小光点和文字浮现（说明场景已经准备好）。
2. 点击画面任意位置 → 自动进入全屏并从第 0 秒开始播放。
3. 从点击后开始录制，录约 34～38 秒；最后 3～5 秒画面会稳定在一帧漂亮的收尾上。
4. 需要重录时点右下角非常低调的 `Replay`，或直接按 `R`。

本机实测：屏幕 1536×864 @ DPR 1.25 → 全屏时画布正好是 **1920×1080**，
在 Intel Iris Xe 集显上可稳定 60 FPS 以上。

### 快捷键

| 键 | 作用 |
| --- | --- |
| `R` | 重播 |
| `F` | 切换全屏 |
| `空格` | 暂停 / 继续（挑选定帧时很有用） |
| `H` | 隐藏 / 显示右下角 Replay 按钮（录屏时可以彻底清屏） |

### URL 参数（仅调试 / 录制辅助用）

| 参数 | 作用 |
| --- | --- |
| `?t=20` | 直接从第 20 秒开始播放（自动跳过全屏请求） |
| `?auto=1` | 加载完自动播放 |
| `?fps=1` | 左上角显示帧率 / DPR / 当前时间 |
| `?nofs=1` | 不请求全屏 |
| `?dpr=1.25` | 强制像素比（用于按录制分辨率测性能） |

---

## 改文案在哪里

**`src/config.js` 最上面的 `text` 字段**，三句核心文案就是这里：

```js
text: {
  title: '雪 and 潇',                 // Scene 5（英文单词 and 会自动用衬线斜体排版）
  subtitle: '这是我们的第一个七夕！',    // Scene 6
  finale: '七夕快乐，宝宝',            // Scene 7
  entry: '点击开启我们的第一个七夕',     // 启动入口
  entryHint: 'Click to begin · 建议全屏观看',
  replay: 'Replay',
}
```

改完保存即可，开发服务器会热更新，不需要动任何 Three.js 代码。

字数变多时如果想调节奏，改同一个文件里的 `timeline.text1 / text2 / text3`（单位：秒）。

---

## 核心文件

| 文件 | 作用 |
| --- | --- |
| **`src/config.js`** | **唯一需要改的地方**：文案、配色、粒子数量、相机关键帧、时间轴、画质 |
| `src/main.js` | 渲染器 / 相机路径 / 主循环 / 播放控制 / 自适应画质 |
| `src/core/timeline.js` | 确定性时间轴（按绝对时间求值，所以 Replay 和掉帧都不会让状态漂移） |
| `src/core/easing.js` | 缓动曲线，其中 `easeGather` 是粒子聚合的主曲线 |
| `src/core/postfx.js` | 后处理：UnrealBloom + 最终调色（暗角 / 颗粒 / 极轻色差），含 bloom 高斯核修正 |
| `src/scene/heartShape.js` | 心形采样：轮廓 → SDF → 按曲面面积采样的立体粒子场 |
| `src/scene/heart.js` | 主体粒子心（聚合、旋涡、呼吸、离散回归、光脉冲、终章扩散） |
| `src/scene/glow.js` | 心内部体积柔光 + 心形星云光晕（一次性烘贴图） |
| `src/scene/butterflies.js` | 蓝色光蝶：Canvas2D 手绘蝶翼贴图 + 可形变翅膀网格 + 轨道飞行 + 拖尾星尘 |
| `src/scene/stars.js` / `dust.js` / `backdrop.js` | 星空两层 / 雪尘微晶 / 背景渐变与星云 |
| `src/ui/overlay.js` | 字幕逐字入场、入口、Replay |
| `src/audio/ambient.js` | Web Audio 氛围 pad + sparkle（点击后才创建，避开 autoplay 限制） |
| `src/style.css` | 字幕排版与入口样式 |
| `qa/` | 视觉验收脚本（Playwright 定点截图 / 性能探针），不参与构建 |

---

## 时间轴（34s）

| 时间 | 场景 |
| --- | --- |
| 0.0 – 3.4 | **寂静**：近乎纯黑，星光缓慢浮现，雪尘出现 |
| 3.4 – 12.8 | **苏醒**：粒子云在画面中旋入，被流场牵引着向中心汇聚 |
| 10.5 – 15.2 | **成形**：落位成有厚度的发光爱心，开始呼吸、表面流动、少量粒子离表面后回归 |
| 13.0 – 18.5 | **光蝶**：7 只依次进入，各自不同的尺度、深度、轨道与速度 |
| 15.6 – 20.6 | `雪 and 潇` 逐字浮现（模糊 → 清晰，字距收紧） |
| 21.6 – 26.4 | `这是我们的第一个七夕！` |
| 27.4 → | `七夕快乐，宝宝` |
| 27.7 | **光脉冲**：一次克制的呼吸式爆发（bloom 同步上扬） |
| 28.0 – 32.0 | **扩散**：约 1/3 粒子像火花一样飘散，主体保持完整；部分蝴蝶飞离画面 |
| 30.5 – 34.0 | **收尾**：画面稳定，适合录屏最后停留 |

---

## 性能说明

本机（Intel Iris Xe 集显）实测 **1920×1080 全时间轴：平均 88 FPS，95% 分位 65 FPS**，
全程不会触发降画质。做到这个数字的几件事：

- **心形粒子 15 万**，一个 `BufferGeometry` + 一次 draw call，
  聚合 / 旋涡 / 呼吸 / 离散 / 扩散全部在顶点着色器里解析求值，CPU 每帧不碰顶点数据。
- **蝴蝶也完全是解析的**：轨道位置、朝向（GPU 里现算 look-at 基）、扇翅、登场淡入、
  终章飞离都在 shader 里，实例属性全是静态的。
  最初的写法是每帧上传 `instanceMatrix` + 拖尾坐标，在 ANGLE/D3D11 上会造成
  **约 6 ms/帧的管线停顿**（1080p 下相当于掉 30 FPS），改成零上传后这项开销消失。
- **拖尾星尘**是同一条解析轨道上的「过去时刻」采样，静态几何 + 一个 `uTime`。
- 背景星云和心形光晕都**只烘一次**到贴图（整屏多层 noise 在集显上非常贵）。
- 字幕的「字距收紧」用 `transform` 实现而不是过渡 `letter-spacing`：
  后者每帧触发文本重排并连带重算 blur / text-shadow，实测要吃掉十几帧。
- 不开 MSAA：粒子与柔光本身没有硬边，蝶翼边缘在片元里已是平滑过渡。
- bloom 在 0.6 倍分辨率上计算；并修正了 three 自带 `UnrealBloomPass`
  高斯核被截断（`sigma = kernelRadius`）导致的**方块状光晕** ——
  亮星周围原本会出现清晰可见的方框，见 `src/core/postfx.js` 的 `fixBloomKernel`。
- DPR 上限 1.5 并有像素总量上限；连续 3 秒低于 48 FPS 才降一档画质，
  避免偶发卡顿永久影响录制质量。

需要更高 / 更低画质时改 `config.js` 的 `counts` 与 `quality`。

## qa/ 里的验收脚本

需要 `npm i -D playwright` 与 `npx playwright install chromium`（已在 devDependencies 中）。
开发服务器要先跑起来。

```bash
node qa/shoot.mjs               # 按时间轴关键时刻逐帧截图 → qa/shots/
node qa/shoot.mjs 16.5 28       # 只截指定时刻
node qa/perf.mjs                # 按 1920×1080 跑完整时间轴，输出分段帧率
node qa/perf-ab.mjs             # 逐图层 A/B 性能对比（含预热，排除集显升频偏差）
node qa/zoom.mjs 24 1060 350 260  # 放大某一帧的局部，检查细节
node qa/replay-test.mjs         # 验证 Replay 是否把状态完全复位
node qa/entry.mjs               # 入口画面 + console 检查
node qa/prod-check.mjs          # 检查 npm run preview 的构建产物
```
