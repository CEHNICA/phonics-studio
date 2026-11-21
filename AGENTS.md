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

### 体检器（尺子）

| 命令 | 管什么 |
| --- | --- |
| `npm run check:video` | 视频体积预算、poster 齐全、catalog 字段、每个 `<video>` 都有 `preload`+`poster`（8 项） |
| `npm run check:audio` | 音频数量/版本/体积预算、卡片词与例词全覆盖、路径版本化、预加载并发上限、`pendingKey` 存在（14 项） |
| `npm test` | 「待巩固」判定规则纯函数回归（8 项） |
| `npm run lint` | oxlint |

改 `<video>` 标签或视频素材后，**`npm run check:video` 必须 8/8 通过**再提交；改音频后 **`npm run check:audio` 必须 14/14 通过**再提交。

### 提交与发版

```powershell
npm run lint; npm test; npm run check:video; npm run check:audio; npm run build
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
- Lucide 图标组件不接受 `title` prop（TS2322），要 tooltip 得外包 `<span title=...>`。
- `@vue-macros/nuxt` 那类 reactivity transform 下 `$ref` 变量在 script 里**不能写 `.value`**（静默 undefined）。
