# AGENTS.md · 48 音标小铺（phonics-studio）

React 19 + TypeScript + Vite 8。线上站 https://5p3wt4cgcivtd.space.mcode.cn ，GitHub https://github.com/CEHNICA/phonics-studio 。

## 规矩

### 改视频 / 素材前必读

素材托管在**阿里云 OSS + 阿里 CDN**，有两个硬约束：

1. **源站对浏览器下发 `Cache-Control: no-store`** —— 浏览器永不落盘缓存，每次切音标、重播都要完整重下一遍。**体积就是首帧延迟**，视频必须压到最小。
2. **CDN 边缘缓存 TTL 30 天**（`X-Swift-CacheTime: 2592000`）—— `no-store` 只约束浏览器，管不了 CDN。**改了视频内容必须换文件名**（`{id}.v2.mp4` → `{id}.v3.mp4`），否则线上还是旧文件，会误判成"部署失败"。

当前基线：48 个视频 640×360 / h264 main / CRF 27 / faststart，总体积 1.44 MB，单文件 ≤ 60 KB；每个视频配一张首帧封面 `public/assets/poster/{id}.v2.jpg`（~15 KB）。

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

### 体检器（尺子）

| 命令 | 管什么 |
| --- | --- |
| `npm run check:video` | 视频体积预算、poster 齐全、catalog 字段、每个 `<video>` 都有 `preload`+`poster`（8 项） |
| `npm run check:audio` | 音频数量/版本/体积预算、卡片词与例词全覆盖、路径版本化、预加载并发上限、`pendingKey` 存在、UI 里 pending 优先级（16 项） |
| `npm run check:cards` | 卡片图数量/版本/体积预算、旧 PNG 已清、catalog 路径版本化、**真读 WebP 头验像素尺寸与宽高比**（10 项） |
| `npm test` | 「待巩固」判定规则纯函数回归（8 项） |
| `npm run lint` | oxlint |

改 `<video>` 标签或视频素材后，**`npm run check:video` 必须 8/8 通过**再提交；改音频后 **`npm run check:audio` 必须 16/16 通过**再提交；改卡片图后 **`npm run check:cards` 必须 10/10 通过**再提交。

### 提交与发版

```powershell
npm run lint; npm test; npm run check:video; npm run check:audio; npm run check:cards; npm run build
git add -A; git commit -m "..."; git push origin main
# 刷新发布快照（_deploy\phonics-studio\site 与 \source），再 website_deploy(node_id=465432120414792)
```

- 发布产物与源码快照都放工作区 `_deploy\phonics-studio\{site,source}`，**不要破坏原始工程目录**。
- 复验线上必须带 `?cb=<毫秒时间戳>`，否则会被 CDN 边缘缓存骗。
- git 身份用**仓库级** `CEHNICA / CEHNICA@users.noreply.github.com`，不要动全局。
- `dist` 不入库（.gitignore 已排除），README 已说明克隆后需自行构建。

### 已知的坑

- 阿里 CDN 对**带任意 query 参数**的静态资源请求，可能直接回源到 SPA fallback 返回 index.html（Content-Type: text/html）。生产代码不要给静态资源加随机 query 参数。
- `src/data/phonetics.json` 里的 `audioSrc` / `videoSrc` 是**死字段**（指向不存在的 `/sound/phonetics/` 目录）。真正生效的是 `phonics-catalog.ts` 生成的 `localAudioSrc` / `localVideoSrc` / `posterSrc`。别去改 json 里那两个字段，改了没用。
- ffmpeg 转音频时 `-ar` 必须写 `24000`（写 `24` 会报 "Specified sample rate 24 is not supported"），转完用 ffprobe 校验 duration 与原文件一致。
- `pumpRef.current = pumpPreloadQueue` 这种**渲染期写 ref** 会被 oxlint 判 `react(refs)` 警告，且 StrictMode 双渲染下时序不可靠 —— 一律放 `useEffect` 里。
- **UI 里 pending 必须排在 playing 前面**（2026-11 已修）：`useAudioPlayer` 的 `setPlayingId` 是在 `play()` **之前**调用的，所以只要点了 `isPlayingCurrentAudio` 立刻为 true。把「正在播放...」写在「加载中...」前面，pending 反馈就永远显示不出来 —— 弱网下用户点了没声、按钮却说在播。`npm run check:audio` 里有两条守护断言专门盯这个顺序（且断言前会把源码空白归一化，避免 JSX 多行造成假阳性）。
- Lucide 图标组件不接受 `title` prop（TS2322），要 tooltip 得外包 `<span title=...>`。
- `@vue-macros/nuxt` 那类 reactivity transform 下 `$ref` 变量在 script 里**不能写 `.value`**（静默 undefined）。
