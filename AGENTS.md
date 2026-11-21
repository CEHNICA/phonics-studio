# AGENTS.md · 48 音标小铺（phonics-studio）

React 19 + TypeScript + Vite 8。线上站 https://5p3wt4cgcivtd.space.mcode.cn ，GitHub https://github.com/CEHNICA/phonics-studio 。

## 规矩

### 改视频 / 素材前必读

素材托管在**阿里云 OSS + 阿里 CDN**，有两个硬约束：

1. **源站对浏览器下发 `Cache-Control: no-store`** —— 浏览器永不落盘缓存，每次切音标、重播都要完整重下一遍。**体积就是首帧延迟**，视频必须压到最小。
2. **CDN 边缘缓存 TTL 30 天**（`X-Swift-CacheTime: 2592000`）—— `no-store` 只约束浏览器，管不了 CDN。**改了视频内容必须换文件名**（`{id}.v2.mp4` → `{id}.v3.mp4`），否则线上还是旧文件，会误判成"部署失败"。

当前基线：48 个视频 640×360 / h264 main / CRF 27 / faststart，**带示范发音音轨**（AAC 32 kHz 单声道 48 kbps），总体积 1.95 MB，单文件 ≤ 81 KB；每个视频配一张首帧封面 `public/assets/poster/{id}.v2.jpg`（~15 KB）。

**视频必须带音轨。** 口型演示视频本来就带示范发音，重编码时如果只写 `-c:v libx264` 或带 `-an`，音轨会被整个丢掉 —— 画面照播、就是没声音，而且 ffmpeg **不报错**，不专门去 probe 文件根本发现不了（v2 那批 48 个全是哑片）。

正确的重编码命令（原始素材在 git `51b3a63` 提交里，用 `git archive` 导出）：

```powershell
& $ff -y -loglevel error -i in.mp4 -vf "scale=640:360" `
  -c:v libx264 -crf 27 -preset medium -pix_fmt yuv420p `
  -c:a aac -b:a 48k -ac 1 -ar 32000 -movflags +faststart out.v3.mp4
```

`-c:a` 那行**不能省**。`npm run check:video` 会用纯 JS 解析 MP4 的 `moov/trak/mdia/hdlr` box，逐个确认有 `soun` handler 且 codec 是 `mp4a`，少一个音轨就红。

另外：**poster 按基名匹配，不必跟着视频升版本号**。poster 内容没变时换名会让 CDN 缓存全失效、白重下一遍 700 KB。

### 改音频前必读

音频走的是**同一套阿里 OSS + CDN**，所以上面两条约束**同样适用**：

1. `Cache-Control: no-store` → 浏览器永不缓存，**音频体积就是点击到出声的延迟**。
2. CDN 边缘 TTL 30 天 → **改音频内容必须换文件名**（`{id}.mp3` → `{id}.v2.mp3`）。

当前基线：

| 素材 | 数量 | 规格 | 总体积 | 单文件上限 |
| --- | --- | --- | --- | --- |
| 音标发音 `public/assets/sound/{id}.v2.mp3` | 48 | 24 kHz 单声道 48 kbps | 307 KB | 9 KB |
| 单词朗读 `public/assets/words/{word}.v2.mp3` | 190 | 24 kHz 单声道 32 kbps | 800 KB | 6 KB |

原先音标音频是 44.1 kHz 立体声 105 kbps（578 KB），单词 32 kHz 立体声（1.44 MB），对纯语音是纯浪费。

播放逻辑（`src/hooks/useAudioPlayer.ts`）三条硬规矩：

- **预加载走队列 + 并发上限 2**（`MAX_PARALLEL_PRELOAD`）。弱网下并发预载会互相抢带宽，把「马上要点的那一个」拖慢。队列先进先出，音标音频天然排在单词前面。
- **预加载缓存上限 16**（`MAX_PRELOAD_CACHE`），淘汰时同步把排队项摘掉。
- **播放未就绪要亮「加载中」**（`pendingKey`，格式 `phoneme:<id>` / `word:<word>`），不能让用户以为点了没反应。

改完音频素材或播放逻辑，`npm run check:audio` 必须 14/14 通过再提交。

### 改卡片图前必读

卡片图同样走阿里 OSS + CDN，`no-store` + 边缘 30 天缓存两条约束照样适用。

当前基线：48 张手绘卡片图 **1050×623 WebP q82**，总体积 **1.55 MB**（原 1500×890 PNG 共 5.87 MB，-74%），单张 30–40 KB。

两个硬约束：

1. **必须严格同比例**。原图 1500×890 = 150:89，缩放后的整数尺寸必须是 150:89 的整数倍 —— 当前用 **1050×623**（×7）。卡片上的单词热区是按**百分比**定位的，比例一变热区就整体偏移。`npm run check:cards` 会真读 WebP 文件头解析像素尺寸来验这条。
2. **不能超采样**。卡片展示区只有 463×275 CSS px，@2x DPR 需要 926px 宽，1050px 已有余量。原图 1500px 宽属于 3.2 倍超采样，纯浪费。

改用 `ffmpeg -i in.png -vf scale=1050:623 -frames:v 1 -c:v libwebp -q:v 82 out.v2.webp`；转完用 SSIM 验视觉（阈值 0.98，当前全量最低 0.9932）。

WebP 完胜 JPEG：同尺寸下 WebP q82 的 SSIM 0.994，JPEG q85 只有 0.959。

### 改首屏 JS 前必读

**最重要的一条事实：阿里 CDN 对 `.js` 不启用 gzip/br。**

实测（2026-11，线上 `curl -H 'Accept-Encoding: gzip, br'`）：

| 资源 | 是否压缩 |
| --- | --- |
| HTML | ✅ gzip |
| CSS | ✅ gzip |
| **JS（33B / 24KB / 220KB 全测了）** | ❌ **一律不压** |
| `.mjs` / `.json` | ❌ 不压 |

所以**产物的字节数就是国内用户的真实下载量**，压缩不掉，只能少加载。3G 限速实测：JS 下载 8842ms ≈ 8.8 秒全是带宽问题。

改造前后：

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 首屏 JS（未压缩） | 425.8 KB | **105 KB** |
| 首屏请求数 | 20 | **10** |
| 首屏总传输 | 540 KB | **229 KB** |
| 3G 下首屏全部资源就绪 | 12104 ms | **5861 ms** |

四条硬规矩：

1. **运行时是 preact/compat**（`vite.config.ts` 里 `resolve.alias`）。react-dom 单模块就 202 KB，占改造前首屏的 2/3，换成 preact 后约 25 KB。本项目只用到 `createRoot` / hooks / `lazy` / `Suspense` / `forwardRef`，**没有用 React 19 特有 API**（`use` / `useOptimistic` / `useActionState`），所以能直接替换。**别把 React 19 特有 API 引进来**，会破兼容。
2. **非首屏组件必须 `React.lazy` + 条件渲染**。只写 lazy 不够 —— 组件一旦被渲染（哪怕 `open=false`），lazy 照样会去拉 chunk。必须写成 `{userDataOpen && (<Suspense>…</Suspense>)}`。
3. **预取必须等 `window.load` 之后再延后 ≥1500ms**。弱网下预取会和首屏媒体抢带宽：实测把卡片图从 1.5s 拖到 3.5s、视频拖到 8s。弱网（`navigator.connection.effectiveType` 为 2g/3g）直接不预取。
4. **`pronunciation-analyzer`（含 63 KB 模板表 + DSP）只在录音后用**，必须动态 import + idle 预抢，别把它拖回首屏。

改完必须 `npm run check:js` **9/9 通过**再提交。

### 改录音前必读

录音链路的**逻辑**在移动端视口下实测是通的（真人读 `/iː/` 拿 99 分），但**真机环境**有四个 Chromium 测不出的坑：

1. **iOS Safari 的 AudioContext 必须在用户手势里 resume。** 无手势创建会停在 `suspended`，此时 `decodeAudioData` 拿不到有效音频 → 表现为「录完没声音」+ 提示「只检测到环境背景声，请靠近麦克风清晰读一遍再试试哦」。修法：`src/utils/audio-context.ts` 的 `resumeSharedAudioContext()`，在 `startRecording` 里（用户手势的同步栈内）调用。

   **别为了激活 context 去 import `pronunciation-analyzer`** —— 那模块 78 KB（含 48 音素模板表）。所以 context 管理单独抽成 `src/utils/audio-context.ts`，两边共用同一个实例。
2. **`MediaRecorder.start()` 必须带 timeslice**（`start(250)`）。不切片时移动端长录音会丢尾段。
3. **分析模块要提前预取**。录音开始时就 `import('../utils/pronunciation-analyzer')`，录完立刻出分，不用干等一次下载。
4. **非 HTTPS（`isSecureContext` 为假）浏览器直接禁用麦克风**。提示必须给出可操作方案（换线上 https 地址 / localhost），只写「请在电脑端打开」等于在手机上把路堵死。

**动态 import 必须带 `.catch()`** —— 链式写法 `import(...).then(...).catch(...)` 的 catch 在链尾，同样能兜住整条链。别只判「紧邻 import 的 catch」，那是假阳性。

改完必须 `npm run check:record` **12/12 通过**再提交。

### 加交互动效前必读

本项目加了一大批交互动效（卡片弹跳、庆祝音弹跳、连击爆发、选项抖动、结算入场）。两条硬规矩：

1. **不许写 `infinite`。** `.combo-badge.hot` 的脉冲原本是 `animation: combo-pulse 0.9s ease infinite` —— 连击徽章一直挂在顶栏，无限重绘吃移动端 GPU，视觉上也是永远在闪。改成 `ease 3`（播 3 次就停）。

2. **必须写 `prefers-reduced-motion` 降级。** 系统里开了「减弱动态效果」的用户（尤其前庭功能障碍用户）不能看到全屏位移/缩放动画。降级块在 `src/index.css` 末尾：

   ```css
   @media (prefers-reduced-motion: reduce) {
     /* 所有带 animation 的类：animation:none + transition:none */
     /* forwards 终态的额外写 display:none —— 只 animation:none 会让它永远留在屏幕上 */
   }
   ```

   **坑：`forwards` 终态**。`combo-burst-overlay` / `combo-burst-text` 用的是 `animation: ... forwards`，动画结束后元素停在最后一帧。降级时只写 `animation: none` 会让「×3 连击！」永远挂在屏幕正中央 —— 必须同时 `display: none`。

改完必须 `npm run check:motion` **4/4 通过**再提交。

### 体检器（尺子）

| 命令 | 管什么 |
| --- | --- |
| `npm run check:video` | 视频体积预算、**每个视频必须有音轨且为 AAC**、poster 齐全、catalog 字段、**catalog 路径版本与素材目录一致**、每个 `<video>` 都有 `preload`+`poster`（11 项） |
| `npm run check:audio` | 音频数量/版本/体积预算、卡片词与例词全覆盖、路径版本化、预加载并发上限、`pendingKey` 存在、UI 里 pending 优先级（16 项） |
| `npm run check:cards` | 卡片图数量/版本/体积预算、旧 PNG 已清、catalog 路径版本化、**真读 WebP 头验像素尺寸与宽高比**（10 项） |
| `npm run check:js` | 首屏 JS 总量/单 chunk 预算、chunk 数、非首屏组件是否拆出且不进首屏、首屏源码清单、**浮层条件渲染**、**预取延迟 ≥1500ms**（9 项） |
| `npm run check:record` | 录音链路：AudioContext 用户手势内 resume、MediaRecorder 按片录制、分析模块预取、非 HTTPS 提示可操作、动态 import 带 catch（12 项） |
| `npm run check:motion` | 动效：无 infinite 无限动画、存在 `prefers-reduced-motion` 降级、动画类全被覆盖、forwards 终态同时 `display:none`（4 项） |
| `npm test` | 「待巩固」判定规则纯函数回归（8 项） |
| `npm run lint` | oxlint |

改 `<video>` 标签或视频素材后，**`npm run check:video` 必须 11/11 通过**再提交；改音频后 **`npm run check:audio` 必须 16/16 通过**再提交；改卡片图后 **`npm run check:cards` 必须 10/10 通过**再提交；动分包/运行时后 **`npm run check:js` 必须 9/9 通过**再提交；动录音链路后 **`npm run check:record` 必须 12/12 通过**再提交。

**每加一条守护断言，都要实测退回验证**：把被守护的写法改回旧样子，确认体检器**精确红在自己那条**、其余全绿。断言本身也要验 —— 本轮就抓到过「只判有没有 `setTimeout`」的假阳性（把延迟写成 0 照样绿），已改成校验延迟值本身。


### 提交与发版

```powershell
npm run lint; npm test; npm run check:video; npm run check:audio; npm run check:cards; npm run check:js; npm run check:record; npm run check:motion; npm run build
git add -A; git commit -m "..."; git push origin main
# 刷新发布快照（_deploy\phonics-studio\site 与 \source），再 website_deploy(node_id=465432120414792)
```

- 发布产物与源码快照都放工作区 `_deploy\phonics-studio\{site,source}`，**不要破坏原始工程目录**。
- 复验线上必须带 `?cb=<毫秒时间戳>`，否则会被 CDN 边缘缓存骗。
- git 身份用**仓库级** `CEHNICA / CEHNICA@users.noreply.github.com`，不要动全局。
- `dist` 不入库（.gitignore 已排除），README 已说明克隆后需自行构建。

### 已知的坑

- **ffmpeg 重编码丢音轨不报错** —— 只写 `-c:v libx264`（或带 `-an`）时，音轨会被整个丢掉，画面照播但一点声音没有，ffmpeg 退出码还是 0。**每次重编码后必须 probe 文件**，或直接依赖 `npm run check:video` 的音轨断言。
- **iOS Safari 的 AudioContext 会停在 suspended** —— 无用户手势创建/不 resume，解码拿不到音频，表现为「录完没声音」。见上面「改录音前必读」。
- **`animation: ... forwards` 的元素在 reduced-motion 下要 `display:none`** —— 只 `animation:none` 会让它停在最后一帧永远留在屏幕上（连击爆发文字就会一直挂正中）。见上面「加交互动效前必读」。
- **别在文件里搜 `import(...)` 就断言「已预取」** —— `onstop` 回调里的链式 import 在语法位置上就位于 `recorder.start()` 之前，会让断言假绿。唯一可靠特征是「独立语句 + 紧跟 `.catch(`」。同理，「紧邻 import 的 catch」也不成立，链式 catch 在链尾。
- **阿里 CDN 不压 `.js`**（HTML/CSS 会压，JS 一律不压）—— 见上面「改首屏 JS 前必读」。JS 体积就是国内下载时间，只能靠少加载来降。
- **React.lazy 的组件必须条件渲染** —— 只包 lazy 不够，被渲染就会拉 chunk。首屏照样多请求。
- **弱网下别急着预取** —— 预取和首屏媒体抢带宽，实测能把卡片图拖慢 2 倍多。
- **preact/compat 是运行时替换，类型仍是 @types/react** —— 别引 React 19 特有 API（`use` / `useOptimistic` / `useActionState` / `useFormStatus`），那些在 preact/compat 里没有。
- 阿里 CDN 对**带任意 query 参数**的静态资源请求，可能直接回源到 SPA fallback 返回 index.html（Content-Type: text/html）。生产代码不要给静态资源加随机 query 参数。
- `src/data/phonetics.json` 里的 `audioSrc` / `videoSrc` 是**死字段**（指向不存在的 `/sound/phonetics/` 目录）。真正生效的是 `phonics-catalog.ts` 生成的 `localAudioSrc` / `localVideoSrc` / `posterSrc`。别去改 json 里那两个字段，改了没用。
- ffmpeg 转音频时 `-ar` 必须写 `24000`（写 `24` 会报 "Specified sample rate 24 is not supported"），转完用 ffprobe 校验 duration 与原文件一致。
- `pumpRef.current = pumpPreloadQueue` 这种**渲染期写 ref** 会被 oxlint 判 `react(refs)` 警告，且 StrictMode 双渲染下时序不可靠 —— 一律放 `useEffect` 里。
- **UI 里 pending 必须排在 playing 前面**（2026-11 已修）：`useAudioPlayer` 的 `setPlayingId` 是在 `play()` **之前**调用的，所以只要点了 `isPlayingCurrentAudio` 立刻为 true。把「正在播放...」写在「加载中...」前面，pending 反馈就永远显示不出来 —— 弱网下用户点了没声、按钮却说在播。`npm run check:audio` 里有两条守护断言专门盯这个顺序（且断言前会把源码空白归一化，避免 JSX 多行造成假阳性）。
- Lucide 图标组件不接受 `title` prop（TS2322），要 tooltip 得外包 `<span title=...>`。
- `@vue-macros/nuxt` 那类 reactivity transform 下 `$ref` 变量在 script 里**不能写 `.value`**（静默 undefined）。
