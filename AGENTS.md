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

### 改账号 / 班级权限前必读

账号体系有两层身份，别搞混：

- **账号身份**（`phonics_accounts.role`）：`teacher` / `student`。注册时就定死。
  - 学生：随便注册，只能拿班级码加入别人的班。
  - 老师：注册时必须带上**教师邀请码**（Pages secret `TEACHER_INVITE_CODE`，不进前端包），校验通过才算老师。
- **班级身份**（`phonics_members.role`）：`owner` / `student`。建班的人自动是 owner。

**建班权限在服务端兜死**：`handleCreateClass` 先过 `canCreateClass(auth.account)`，学生账号直接 403。前端只是不给入口 —— 学生绕过界面直接调接口一样会被拒。

改这块必须同步这四处，漏一处就漏判：

1. `backend/cloudflare/pages/functions/api/[[path]].ts`：`resolveRegisterRole()` / `canCreateClass()` / `accountPayload()`（三个接口都走它返回 role）。
2. `backend/cloudflare/schema.sql` + `backend/cloudflare/migrations/`：role 列与迁移脚本。
3. `src/services/backend/types.ts`：`AccountInfo.role`、`RegisterInput.role/teacherCode`。
4. `src/components/UserDataPanel.tsx`：「创建班级」按钮必须被 `isTeacher` 门控；注册表单的身份选择在 `user-data-role-switch`。

**文案别再用「还没进班级」** —— 用户看不懂。学生看「还没加入班级」，老师看「还没建班级」，后面跟一句解释这进度只存在本机。

**老账号兼容**：`parseSession` 里没有 role 字段的老会话，按「班级里是不是 owner」兜底成老师；D1 迁移脚本也把老 owner 账号升成 teacher。

改完必须 `npm run check:role` **30/30 通过**再提交。

### 改账号链路（弱网 / 身份校准）前必读

后端在 `*.pages.dev`（**跨境**），前端在 `*.space.mcode.cn`（国内）。这条链路的抖动是真实存在的，第 9 轮实测抓到三个坑：

1. **超时不能是 8 秒。** `REQUEST_TIMEOUT_MS`（`src/services/backend/worker-backend.ts`）现在是 **15000ms**。实测有请求整整挂了 9 秒才被掐断（TCP 丢包重传），8 秒一刀切下去，用户点「创建班级」会**失败且班级没建出来**。别为了"界面别卡住"把它调回 8 秒。
2. **错误必须归一化，不许把技术串甩给用户。** `src/services/backend/error-messages.ts` 的 `normalizeBackendError()` 是唯一出口：掐断 → 「网络太慢没连上，等一会儿再试一次」，网络不可达 → 「连不上服务器，检查一下网络再试一次」，**服务端给的中文提示原样保留**，看不懂的英文 → 调用方的中文兜底。改任何会抛错的地方，都要把错误过一遍这个函数 —— 之前 AbortError 原文「signal is aborted without reason」直接显示在界面上。
3. **界面必须信服务端，不能只信 localStorage。** `syncAccountState()`（`src/hooks/usePhonicsProgress.ts`）做两件事：`ping()` 预热连接 + `me()` 校准身份与班级状态。它在**挂载时**和**打开「我的数据」面板时**都会跑（30 秒内不重复）。不校准的话，界面会一直显示「还没建班级」，而服务端回 409「你已经在一个班级里了」—— 用户被卡死。建班失败后还要回头 `refreshMembership()`：请求可能其实成功了（响应在路上丢了），班级码该显示出来。

**建班不是幂等的，所以不要自动重试** —— 超时后重试可能建出两个班。正确做法是「失败后刷新班级状态」，让界面自己看出到底建没建成。

**`worker-backend.ts` 的运行时 import 必须带 `.ts` 扩展**（`from './types.ts'`）：体检器要在纯 node 下 import 这个模块真跑，没有扩展名 node 解析不了（`allowImportingTsExtensions` 已经是开的，vite 也认）。

改完必须 `npm run check:account-net` **16/16 通过**再提交。

### 改「班级看板」前必读

第 10 轮实测（2026-11-21）。老师反馈「班级看板读取数据慢」，量完发现**慢的根因是跨境网络，不是代码**：

同一个 `/api/health`（11 字节、零 D1 查询），同一台机器：

| 测法 | 耗时 |
| --- | --- |
| Node 直连 | 中位 268ms |
| Chrome 里 | 310 ~ 3151ms（抖动 10 倍） |
| Chrome + `--disable-quic` | 无差别（`nextHopProtocol` 本来就是 http/1.1，不是 QUIC 的锅） |

所以**单次请求耗时不可控**，别再指望「优化接口实现」能把它压下去。能压的只有两件事：**少跑一趟** + **把等待藏起来**。

1. **后端少跑一趟。** `requireAuth` 原来是**串行 4 次** D1 查询（session → account → member → space），现在合成**一条 JOIN**（`AUTH_LOOKUP_SQL`）。看板接口自身再查一次成员表（`CLASS_MEMBERS_SQL`，一条 LEFT JOIN accounts，**不是 N+1**）。整条链路 5 次往返 → 2 次。

2. **前端藏等待。** `src/services/backend/class-overview-cache.ts` 做 stale-while-revalidate：上次看过的数据存 localStorage，再打开**立刻亮出来**，同时后台刷新。

3. **预取要早。** 老师点「打开班级看板」之前往往只隔几百毫秒 —— 等点「我的数据」才拉来不及。`App.tsx` 在**登录态就绪时**（`useEffect` 依赖 `session?.token` / `membership?.role`）就预取；打开面板时再补一次（30 秒节流，`shouldPrefetchClassOverview`）。

4. **数据够新就别再打接口。** `isClassOverviewFresh()`（30 秒门槛）：预取刚回来老师就点看板，再发一次就是白等 300~3000ms。但**手动点「刷新」和改名单之后必须 `load(true)` 强制拉最新** —— 别拿缓存糊弄老师。

5. **慢的时候要说人话。** 超过 600ms（`SLOW_LOAD_HINT_MS`）显示「网络有点慢，还在读班级数据…」，别让人干瞪眼。

6. **缓存按班级隔离** —— 换班 / 退班不能把上一个班的成绩串过来（`readClassOverviewCache(storage, spaceId)`）；缓存内容坏了要**安全退化成空**，不许抛错把页面搞崩。

线上实测（跨境抖动 300~3000ms 的真实环境）：

| 场景 | 改之前 | 改之后 |
| --- | --- | --- |
| 第一次打开看板 | 1442ms | 292ms |
| 第二次打开 | 1459ms | 71ms |
| 点看板时额外发几次请求 | 1 | 0 |

改完必须 `npm run check:dash-perf` **24/24 通过**再提交。

### 改「学习主道场」（五维闭环）前必读

**第 11 轮（2026-11-21）把学习主道场整个重做了**，不再是「卡片 → 圈出区 → 跟读区」的三段式。现在是**两个阶段 tab 切换**：

| 阶段 | tab 文案 | 组件 | 内容 |
| --- | --- | --- | --- |
| 1（decode） | 「看口型 · 拼装解码」 | `src/components/PhonicsBlenderStage.tsx` | 口型视频（可 0.75x 慢速 / 循环）+ **字母拼写密码**（`PHONEME_DECODING_MAP`）+ **一键合体拼读**（逐音 → 整词）+ 折叠式手绘记忆卡（圈出代表词在这里） |
| 2（practice） | 「开口纠偏 · 真词验耳」 | `src/components/PronunciationRadarStage.tsx` | **声学纠偏仪**（先听原声 → 跟读 → 偏移靶尺）+ **最小对立真词关**（连对 2 题解锁） |

几条不能改坏的规矩：

1. **「先听一遍原声」必须排在录音按钮前面**（DOM 序 + 同排时看 X）。这是老规矩，从没变过，只是搬进了新阶段。旧文案「只听原声」不许再当主按钮出现。
2. **圈出最顺口词没被删，是搬进了「手绘记忆卡片 & 备忘代表词」折叠抽屉**（`showMemoryCard` 默认 false）。**圈层 SVG 只有在用户选了代表词之后才渲染** —— 没选词就没有 `svg.card-circle-layer` 节点，这跟「圈功能坏了」不是一回事，别误判。
3. **圈的坐标系仍是 `viewBox="0 0 1050 623"` + `preserveAspectRatio="none"` + `pointer-events: none`**（圈层 className 挂在 `<svg>` 本身，不是外层 div）。
4. **不许拿「点代表词」当完成**：`progress.representativeWord` 只是记忆标签，`completed` 必须靠实操解锁（拼读通关 / 开口达标 / 对立验耳三枚印章）。
5. **新增的进度字段**（`PhonemeProgress`）：`speakingBestScore` / `lastConfusedWithId` / `blendedCompleted` / `minimalPairPassed` / `nextReviewAt`。合并规则见 `src/services/backend/merge.ts` —— `speakingBestScore` 取 **max**，布尔标记取**或**，别写成「取较新的一方」（那会把更好的分数丢掉）。
6. **后端只往 `stats_json` 这个 JSON 列里加字段**（`weakTopIds` / `speakingPassedCount`），**不改表结构，不需要 D1 迁移**。
7. **静态尺子与浏览器尺子必须一起改**。第 11 轮就出过事故：源码和 `check-learning-flow.ts` 都改了，唯独漏了 `scripts/e2e-learning-flow.ts` —— 它还在等 `.illustrated-card-img` 可见，而新架构里卡片图在**默认折叠**的抽屉里，首屏根本不渲染 → 脚本 20 秒超时崩溃，**一条断言都没跑出来**。改完必须 `npm run e2e:flow` 真跑一次，看到断言列表才算数。

改完必须 `npm run check:flow` **8/8 通过** + `npm run e2e:flow` **24/24 通过**再提交。

### ⚠️ 印刷语 ↔ 网站步骤：目前是**脱钩**的（待处理）

**卡片图上印的仍然是**「听一遍、圈一圈，再跟读一遍。」**（`src/data/learning-flow.ts` 的 `CARD_INSTRUCTION`），48 张 `.v3.webp` 卡没重印。**

但网站上的步骤徽标在第 11 轮重做时被**整个删掉了** —— `step-num` / `step-badge` / `LEARNING_STEPS` 现在**全仓无人引用**，`src/data/learning-flow.ts` 事实上成了死文件。孩子照着纸质卡做，网站上却只有「看口型 · 拼装解码 / 开口纠偏 · 真词验耳」，对不上。

**为什么 `npm run check:print` 还是 11/11 全绿？** 因为它只在**自己内部**比对「重印脚本 NEW ↔ `learning-flow.ts` 常量 ↔ 卡片图墨迹」，**从来没校验网站组件真的用了这个常量**。这是尺子漏检（假绿），不是网站没问题。

要对齐有两条路（重印卡片是重活：python 重印 48 张 → 换文件名 `.v3`→`.v4` → 重新推圈槽位 → 跑 `check:print`/`check:circle`/`check:cards`）：

- **A. 网站加回两步徽标**：用现成的 `STEP_LISTEN_CIRCLE` / `STEP_READ_ALONG` 常量渲染回道场顶部，不动卡片图。
- **B. 重印卡片印刷语**：承认新流程，改 `CARD_INSTRUCTION` + 重印 48 张卡。

不管走哪条，都要给 `check:print` 补一条**「网站组件确实引用了 `learning-flow.ts` 的常量」**的断言，否则下次照样假绿。

### 改「圈出最顺口的词」前必读

卡片图上印着「听一遍，跟读一遍，再圈出读起来最顺口的那个词」—— 圈这个动作以前**只存在于图片里**，代码里没有。现在补上了，改这块前必须知道这几条：

1. **圈的坐标不是写死的常量，是每张卡一套槽位。** 各卡词行 cy 在 495~510 之间浮动，`s` 卡还会定位失败，所以不能用一个中位数常量糊弄。槽位由 `scripts/derive-card-word-slots.ts` 从卡片素材实测推导（ffmpeg 解灰度 → 找词文字行 → 列聚类），生成 `src/data/card-word-slots.ts`。**换卡片素材必须重新生成**：

   ```powershell
   node scripts/derive-card-word-slots.ts --write src/data/card-word-slots.ts
   ```

2. **坐标系必须锁死 `viewBox="0 0 1050 623"` + `preserveAspectRatio="none"`。** 卡片图就是 1050×623，SVG 用同一套 viewBox 才能和词像素级对齐；`preserveAspectRatio="none"` 让 SVG 铺满图片盒子（图片本身 `width:100%; height:auto`，比例不变）。

3. **圈层必须 `pointer-events: none`。** 否则圈会盖住卡片热点的「点词朗读」。

4. **圈只认卡片上印着的三个词。** 用户自己写的词不在卡片上 → `circleSlotFor` 返回 -1 → 不画圈（但词仍然被记住）。

5. **状态只有一个源：`currentProgress.representativeWord`。** 圈完全由它驱动，**不新增字段、不做 D1 迁移**（这个字段早就随进度同步到后端 `stats_json`）。

6. **卡片上点词仍然只朗读，不改答案。** 「圈」的唯一入口是下方 A/B/C 那一排；再点同一个 chip = 取消圈（toggle）。

改完必须 `npm run check:circle` **24/24 通过** + `node scripts/e2e-card-circle.ts` **18/18 通过**再提交。

**坑：卡片插画里本来就有大面积红色**（苹果、船…）。做像素级验证时不能全图找红像素 —— 会把插画当成圈。必须先取圈层 `<ellipse>` 的屏幕矩形，只在那一个窗口里找红像素。

### 改「学习流程顺序」前必读

> **本节已被第 11 轮的重构取代 —— 现在的主道场是「五维闭环」两阶段 tab（decode / practice）。**
> 见上面「改「学习主道场」（五维闭环）前必读」。下面保留的是**仍然有效的历史规矩**（圈出属于学习流程的一部分、先听后录、两条尺子并行）。

卡片上印的是「听一遍、**圈一圈**，再跟读一遍」，网站上是**两步**，别照着旧的三步式做成三步：

1. **第 1 步 = 听一遍 + 圈一圈**。徽标文案是「听一遍，圈一圈」，提示「点卡片听发音，把读起来最顺口的那个词圈出来」。**圈出是第 1 步的一部分，不是独立的第 3 步**。
2. **物理顺序：卡片 → 圈出区 → 跟读区**。跟读是最后一步。
3. **跟读区内部也是两步**：先放「① 先听原声 → ② 跟我读一遍」提示行，**第一个按钮必须是「先听一遍原声」**，录音按钮排在它后面。旧的「只听原声」按钮已删除，别加回来。
4. **顺序有两条独立的尺子**：`check:flow` 看源码 DOM 顺序，`e2e-learning-flow.ts` 看浏览器里的**实际像素位置**和按钮顺序。DOM 对 ≠ 用户看到的对（CSS 也能改视觉顺序）。

**所有步骤文案都从 `src/data/learning-flow.ts` 取**（`STEP_LISTEN_CIRCLE` / `STEP_READ_ALONG` / `CARD_INSTRUCTION`），组件里不写死字面量。改文案改那个文件。

**坑（尺子自身的坑，历史踩到）**：

- `scripts/check-learning-flow.ts` 里所有「某文案不该出现 / 该出现在第几个」的断言都必须在**剥掉注释后的源码**上做。JSX 注释里也写着按钮文案，全文 grep 会把注释当成真按钮 —— 改坏按钮文案尺子照样全绿（假绿）。尺子里有 `stripComments()` 处理这个。
- **「徽标在 X 之前」这类顺序断言要加「徽标存在才判」的守卫**。否则「删掉徽标」这个缺陷会同时红在「有编号徽标」和「徽标在卡片之前」两条上，逐项退回时对不上号（用户铁律：每条缺陷精确红在自己那条）。存在性归一条、顺序归另一条。
- **组件里的文案改成常量后，尺子不能再 grep 字面量** —— 要 `import` 常量真跑，否则尺子假红。

改完必须 `npm run check:flow` **8/8 通过** + `npm run e2e:flow` **24/24 通过**再提交。

### 改「卡片印刷语」前必读

卡片图上**印着**一行教学指令。它和网站步骤必须永远一致（孩子照着卡片做，网站不能是另一套）。

1. **文案只有一个源**：`src/data/learning-flow.ts` 的 `CARD_INSTRUCTION`（= 卡片上印的那句）+ `LEARNING_STEPS`（网站步骤）。`scripts/reprint_card_instruction.py` 的 `NEW` 必须与它**一字不差**，`npm run check:print` 会查。
2. **改印刷语要重印 48 张卡**：擦掉旧句那一行，用同样的字体/字号/左边界/垂直中心印新句。**换文件名**（`.v2` → `.v3`）—— 阿里 CDN 边缘缓存 30 天，不换名字线上不生效。
   ```bash
   python scripts/reprint_card_instruction.py --cards public/assets/cards --out public/assets/cards
   node scripts/derive-card-word-slots.ts --write src/data/card-word-slots.ts   # 图片换了版本，槽位要重推
   npm run check:print && npm run check:circle && npm run check:cards
   ```
3. **字体字号是校准出来的**：用**原句复现**比对（msyhbd.ttc 24 号，复现宽度 552 vs 原图 547，差 0.9%，叠图肉眼一致）。别随手换字体/字号。
4. **印刷语的几何实测值**（1050×623 坐标系）：背景 `#F7F4EE`、墨迹行 y=246~271、左边界 x=39、字色 `#2A223D`、字高 26px、旧句宽 547px、新句宽 336px。`check:print` 用**墨迹宽度**当判据（旧句 547 会被抓住）。
5. **擦除要保留渐变**：逐行用「同行左侧无墨迹区平均色」填充，别整块填死色 —— 否则留下一块明显补丁。

**坑**：

- **`derive-card-word-slots.ts` 的选行判据已改成「墨迹密度最高」**。原来用「带高最大」，ch 卡的**插画带**（378~442，高 65）比英文词行（471~519，高 49）还高，于是挑中插画、词槽全错。词行密度 15.8%~25.3%，插画带只有 3.2%~8.0%，差一个数量级。`check:circle` 有守护断言：**48 张卡的词行中心必须落在 460~530**。
- **PIL 存 webp 的有损程度比 ffmpeg `-q:v` 重**（ffmpeg 的 q:v 82 会被 clamp 到 63，接近无损）。影响素材细节时优先走「PIL 处理 → 存 PNG → ffmpeg 转 webp」。
- **中途 stop 掉退回验证脚本会留下脏仓库** —— 脚本靠 `finally` 还原文件，被强杀时不还原，下一轮跑会报莫名其妙的失败。中断后先看 `git status`。

改完必须 `npm run check:print` **11/11 通过**再提交。

### 体检器（尺子）

| 命令 | 管什么 |
| --- | --- |
| `npm run check:video` | 视频体积预算、**每个视频必须有音轨且为 AAC**、poster 齐全、catalog 字段、**catalog 路径版本与素材目录一致**、每个 `<video>` 都有 `preload`+`poster`（11 项） |
| `npm run check:audio` | 音频数量/版本/体积预算、卡片词与例词全覆盖、路径版本化、预加载并发上限、`pendingKey` 存在、UI 里 pending 优先级（16 项） |
| `npm run check:cards` | 卡片图数量/版本/体积预算、旧 PNG 已清、catalog 路径版本化、**真读 WebP 头验像素尺寸与宽高比**（10 项） |
| `npm run check:js` | 首屏 JS 总量/单 chunk 预算、chunk 数、非首屏组件是否拆出且不进首屏、首屏源码清单、**浮层条件渲染**、**预取延迟 ≥1500ms**（9 项） |
| `npm run check:record` | 录音链路：AudioContext 用户手势内 resume、MediaRecorder 按片录制、分析模块预取、非 HTTPS 提示可操作、动态 import 带 catch（12 项） |
| `npm run check:motion` | 动效：无 infinite 无限动画、存在 `prefers-reduced-motion` 降级、动画类全被覆盖、forwards 终态同时 `display:none`（4 项） |
| `npm run check:role` | 账号身份/班级权限：邀请码判定（真跑纯函数）、建班门禁、role 落库、三个接口都返回身份、会话保留身份、**学生看不到「创建班级」**、文案说人话（30 项） |
| `npm run check:role-e2e` | 上面那条尺子的**线上真机版**（Playwright，20 项）：身份切换、邀请码必填、学生面板无「创建班级」、老师建班 → 学生加入的闭环。改账号/班级权限后除了 `check:role` 还要跑它 |
| `npm run check:account-net` | 账号链路的弱网健壮性：错误归一化纯函数**真跑**（AbortError / Failed to fetch / 服务端中文 / 英文兜底）、默认超时 ≥15s、**对着挂死的本地服务器真跑建班**（必须抛中文人话）、有「ping 预热 + me 校准」一体的同步逻辑、挂载与打开面板都触发它、建班失败会回头刷新班级状态、代码里不出现技术错误串（16 项） |
| `npm run check:dash-perf` | 「班级看板读取速度」：后端鉴权合 **1 条 JOIN**、看板接口 **1 次查询**、成员表一条 JOIN 带 LIMIT、缓存模块导出齐全、缓存 key 固定、**按班级隔离**、坏 JSON 安全退化、TTL ≥30s、预取节流、看板先读缓存再发请求、慢提示阈值 ≥600ms、看板**会调用**缓存读写、缓存够新不重复打、刷新/改名单强制 `load(true)`、App 在登录态就绪即预取 + 打开面板也预取（24 项） |
| `npm run check:circle` | 「圈出最顺口的词」：槽位数据与卡片素材**一一对应**、槽位与素材实测误差 ≤4px、**圈覆盖率 ≥85%**、viewBox/preserveAspectRatio 坐标系、`pointer-events: none`、匹配纯函数真跑、旧口径文案全仓清零（24 项） |
| `node scripts/e2e-card-circle.ts` | 上面那条尺子的**浏览器真机版**（Playwright，18 项）：点词出圈 → 坐标等于该卡槽位 → 再点取消 → 点卡片词只朗读不画圈 → 自写词不画圈 → 换音标圈不串 → **截图取红色像素换算回 1050×623 坐标系，与原图词的包围盒比对** |
| `npm run check:flow` | 「学习主道场」：阶段 tab 只有 2 个且顺序为 decode → practice、三枚真掌握印章齐全、阶段 1 有拼写密码与合体拼读、**「先听一遍原声」排在录音按钮之前**、阶段 2 有声学偏移靶尺与最小对立真词关、**没有「点代表词直接标 completed」的伪完成**、新道场 CSS 就绪（8 项） |
| `npm run e2e:flow` | 上面那条尺子的**浏览器真机版**（Playwright，24 项）：两个阶段 tab 与切换、口型视频真能播（currentTime>0）、点「一键合体拼读」出通关反馈、**展开记忆卡抽屉后**选代表词真能画圈（viewBox 对 / pointer-events:none）、再点能取消圈、「先听一遍原声」DOM 序与 X 序都在录音之前、旧「只听原声」不出现、阶段 2 有声学纠偏仪与最小对立关、整轮零控制台错误、零站内请求失败 |
| `npm run check:print` | 「卡片印刷语 ↔ 网站步骤」：印刷语含每步关键词（**每个关键词一条断言**）、关键词顺序一致、不含旧三步式、重印脚本与常量一字不差、48 张 .v3.webp、catalog 指 v3、**实际印出来的墨迹宽度/高度/左边距在区间**（11 项） |
| `npm test` | 「待巩固」判定规则纯函数回归（8 项） |
| `npm run lint` | oxlint |

改 `<video>` 标签或视频素材后，**`npm run check:video` 必须 11/11 通过**再提交；改音频后 **`npm run check:audio` 必须 16/16 通过**再提交；改卡片图后 **`npm run check:cards` 必须 10/10 通过**再提交；动分包/运行时后 **`npm run check:js` 必须 9/9 通过**再提交；动录音链路后 **`npm run check:record` 必须 12/12 通过**再提交；动账号链路（超时 / 错误文案 / 身份校准）后 **`npm run check:account-net` 必须 16/16 通过**再提交。

**每加一条守护断言，都要实测退回验证**：把被守护的写法改回旧样子，确认体检器**精确红在自己那条**、其余全绿。断言本身也要验 —— 本轮就抓到过「只判有没有 `setTimeout`」的假阳性（把延迟写成 0 照样绿），已改成校验延迟值本身。


### 提交与发版

```powershell
npm run lint; npm test; npm run check:video; npm run check:audio; npm run check:cards; npm run check:js; npm run check:record; npm run check:motion; npm run check:role; npm run check:circle; npm run check:flow; npm run check:print; npm run check:account-net; npm run check:dash-perf; npm run build
npm run e2e:flow   # 浏览器尺子，必须真跑、看到断言列表（崩了不算数）
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
- **别用子串匹配类名当断言** —— `includes('user-data-role-switch')` 会被 `user-data-role-switch-x` 骗过（尺子假绿）。断言类名要连引号一起匹配（`className="user-data-role-switch"`）。本轮退回验证就抓到过这一条。
- **账号身份 ≠ 班级身份** —— `phonics_accounts.role`（teacher/student）是账号级，`phonics_members.role`（owner/student）是班级内。建班权限看前者，看板权限看后者。见上面「改账号 / 班级权限前必读」。
- ffmpeg 转音频时 `-ar` 必须写 `24000`（写 `24` 会报 "Specified sample rate 24 is not supported"），转完用 ffprobe 校验 duration 与原文件一致。
- `pumpRef.current = pumpPreloadQueue` 这种**渲染期写 ref** 会被 oxlint 判 `react(refs)` 警告，且 StrictMode 双渲染下时序不可靠 —— 一律放 `useEffect` 里。
- **UI 里 pending 必须排在 playing 前面**（2026-11 已修）：`useAudioPlayer` 的 `setPlayingId` 是在 `play()` **之前**调用的，所以只要点了 `isPlayingCurrentAudio` 立刻为 true。把「正在播放...」写在「加载中...」前面，pending 反馈就永远显示不出来 —— 弱网下用户点了没声、按钮却说在播。`npm run check:audio` 里有两条守护断言专门盯这个顺序（且断言前会把源码空白归一化，避免 JSX 多行造成假阳性）。
- Lucide 图标组件不接受 `title` prop（TS2322），要 tooltip 得外包 `<span title=...>`。
- **Playwright 的 JS API 和 Python API 不是一套东西** —— JS 里是 `page.$()` / `page.locator()` / `page.$$eval()` / `element.textContent()`；`page.querySelector()` / `context.new_page()` 在 JS 里根本不存在（那是 Python 的写法）。写 E2E 前先照着 `scripts/e2e-role-ui.cjs` 的写法抄，别凭记忆写。
- **别在 JSDoc 里写 `*/}`** —— 会把注释提前闭合，Node 的类型剥离直接报 `ERR_INVALID_TYPESCRIPT_SYNTAX`。要举 JSX 注释的例子就把 `*/` 拆开写。
- **尺子断言文案前先剥注释** —— JSX 注释里也写着按钮文案，全文 grep 会把注释当真按钮，改坏按钮文案尺子照样全绿（假绿）。见上面「改三步学习流程顺序前必读」。
- **别用 PowerShell 批量正则改 JS 脚本** —— 双引号里的 `$(` 会被当子表达式吃掉，`page.$('.x')` 直接被改坏成 `page..x`，语法全崩。要改就用 edit/write 工具重写整个文件。
- **仓库里没有 playwright 依赖** —— `scripts/e2e-role-ui.cjs` 自己会去找全局 `node_modules`（含 `NODE_PATH`），找不到就报错退出（exit 2），不会静默跳过。
- `@vue-macros/nuxt` 那类 reactivity transform 下 `$ref` 变量在 script 里**不能写 `.value`**（静默 undefined）。
- **跨境单次往返耗时不可控** —— 后端在 `*.pages.dev`、前端在国内，同一个 11 字节的 `/api/health` 在 Chrome 里实测 310~3151ms（抖动 10 倍），`--disable-quic` 无差别（本来就是 http/1.1）。**别再指望「优化接口实现」能压下来**，能压的只有「少跑一趟」+「把等待藏起来」。见上面「改「班级看板」前必读」。
- **尺子断言「某函数被调用」必须带括号查调用点** —— 只查函数名或只查 import 会假绿（「会写缓存」原来查的是 `writeClassOverviewCache` 这个名字，函数定义本身就命中）。要查 `writeClassOverviewCache(`。本轮退回验证就靠这一条抓出了三条假绿。
- **退回验证的 patch 必须全局替换** —— 只替换第一处等于没测到那个断言（同一个常量在源码里出现多次）。副本放**纯 ASCII 临时目录**（`%TEMP%`），中文路径下 Node 的 `fs.rmSync` / `fs.cpSync` 会「假成功」—— 报成功但文件还在。
- **Node `fs.rmSync` / `fs.cpSync` 在含中文的路径上静默失效** —— 报 ok、返回成功，但文件还在 / 目标目录是空的（同一个路径的 `existsSync` / `readFileSync` 却正常）。删改完用 PowerShell `Test-Path` 复核。
- **SQLite 的 `LIKE 'x\_%'` 不认反斜杠转义** —— 想删 `perf_` 前缀的行要用 `LIKE 'perf%'` 或显式 `ESCAPE` 子句，否则删 0 行还不报错。
- **Playwright 日志分段打印会有竞态误读** —— 迟到的 response 会被打进上一段日志，看起来像「预取没生效」或「预取在点面板之后才发」。判断时序要用**同一个分段内的连续序号**，别跨段拼时间线。
- **`wrangler` 走本机代理会报「auth token has expired」** —— 那是代理的 TLS 问题，不是凭据问题。跑 D1 命令前先 `$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:ALL_PROXY=''; $env:NO_PROXY='*'` 直连。另外 `d1 execute --command` **只执行第一条语句**，多条要拆开跑。
- **改了源码，别忘了改浏览器尺子** —— 第 11 轮就栽在这：源码和 `check-learning-flow.ts` 都改了，唯独漏了 `scripts/e2e-learning-flow.ts`，它还在等 `.illustrated-card-img` 可见（现在卡片图在默认折叠的抽屉里，首屏不渲染）→ 20 秒超时、**一条断言都没跑出来**、脚本直接崩。**尺子崩了比尺子红更可怕**：崩了没人知道它本来在守什么。
- **尺子「全绿」不等于网站对** —— `check:print` 11/11 全绿，但网站上的步骤徽标已经被删了：它只在**自己内部**比对「重印脚本 ↔ 常量 ↔ 卡片墨迹」，**从没校验网站组件真的用了那个常量**。凡是「X 和 Y 要一致」的尺子，必须有一条断言真的去查**消费方**（谁 import 了它、谁渲染了它）。
- **元素可能压根不在 DOM 里** —— 新架构里圈层 SVG **只有用户选了代表词之后才渲染**（`{circleSlot && (<svg …>)}`），记忆卡抽屉还默认折叠。断言「圈层存在」之前必须先展开抽屉 + 先选一个词，否则会误判成「圈功能坏了」。
- **`svg.card-circle-layer` 的 className 挂在 svg 本身** —— 不是外层 div。选择器写 `.card-circle-layer svg` 会一个都选不到。
- **首屏 JS 又胖了 42KB** —— 第 11 轮后首屏 chunk 119KB → **161KB**（`src/data/phonics-decoding.ts` 静态数据 34KB + 两个新阶段组件）。阿里 CDN **不压 `.js`**，字节数就是国内下载时间。`npm run check:js` 预算 300KB 拦不住这类「合法但很贵」的增长，动这块要盯着 `check:js` 报的首屏总量。
