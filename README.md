# 48 音标小铺 · Phonics Studio

面向初一学生的 **48 个国际音标** 互动伴学网页。看图辨音、听音辨形、跟读打分、易混音标对比、14 天闯关计划，一个页面全包。

技术栈：**React 19 兼容层（preact/compat）+ TypeScript + Vite 8 + Oxlint**，默认**纯前端、无后端依赖**，学习进度存在浏览器 localStorage 里；接入 Cloudflare Pages Functions + D1 后可用「用户名 + 密码」账号体系跨设备同步、按班级码组班、老师看全班看板。

线上体验：<https://5p3wt4cgcivtd.space.mcode.cn>

## 功能

| 模块 | 说明 |
| --- | --- |
| 卡片工坊 | 48 张手绘音标卡 + 发音音频 + 口型演示视频 + 单词例词，支持完成打卡、**圈出最顺口的词** |
| 14 天计划 | 把 48 个音标排进 14 天闯关路线，可按天筛选进入工坊 |
| 易混音标对 | 专治 `/ɪ/` vs `/iː/`、`/θ/` vs `/s/` 这类易混组合，横向对比 |
| 听力测验 | 听音选音标，自动挑出你的薄弱项并跳转复习 |
| 跟读打分 | 浏览器录音 → 提取声学特征 → 与离线模板比对，给出发音相似度 |
| 我的数据 | 收藏夹（可筛选）、答题记录回顾、账号登录/注册、班级码加入、老师看板 |

## 快速开始

```bash
npm install       # 安装依赖
npm run dev       # 开发服务器
npm run build     # 生产构建，产物在 dist/
npm run preview   # 预览生产构建
npm run lint      # Oxlint 检查
npm test          # 「待巩固」规则回归测试（纯 Node，无需浏览器）
node scripts/test-backend-sync.ts     # 云同步合并规则回归测试（纯 Node）
node scripts/test-account-auth.ts     # 账号 / 密码 / 令牌 / 班级码纯函数体检（纯 Node）
node scripts/test-account-session.ts  # 会话持久化体检（纯 Node）
```

Windows 用户也可以直接双击 **`start-study.bat`**：它会拉起本地静态服务并打开 <http://localhost:4173>。

## 目录结构

```
src/
  components/     卡片工坊、听力测验、易混音标对、14 天计划、顶栏等界面组件
  data/
    phonetics.json          48 个音标的基础数据（符号、分类、例词）
    phonics-catalog.ts      应用侧音标目录与易混音标对定义
    phoneme-templates.json  离线生成的音素声学特征模板（见下）
  hooks/
    usePhonicsProgress.ts   学习进度 / 测验统计 / 收藏 / 答题明细（localStorage + 云同步）
    useVoiceRecorder.ts     录音采集与音量监测
    useAudioPlayer.ts       音频播放
  services/
    backend/                数据后端适配层（本地 / Cloudflare Pages Functions 可换）
      types.ts              后端契约（BackendProvider）
      merge.ts              本地与云端状态的合并规则
      account-client.ts     用户名 / 密码哈希 / 令牌 / 班级码纯函数（浏览器侧）
      account-session.ts    会话持久化（令牌 + 账号 + 班级状态）
      worker-backend.ts     Cloudflare Pages Functions + D1 实现
      local-backend.ts      本地模式与远端快照缓存
  utils/
    acoustic-features.ts       声学特征提取与量化
    pronunciation-analyzer.ts  跟读打分与相似度计算
    recording-store.ts         录音数据落盘（IndexedDB）
    sound-effects.ts           界面音效
public/assets/
  cards/   48 张手绘音标卡（PNG）
  sound/   音标发音音频（MP3）
  video/   口型演示视频（MP4）
  words/   单词发音音频（MP3）
backend/
  cloudflare/   Pages Function 源码 + D1 建表 SQL + wrangler 配置
  supabase/     早期 Supabase 建表 SQL（已废弃，前端不再实现该 provider）
scripts/
  build-phoneme-templates.ts   离线重建音素模板
  test-consolidation.ts        「待巩固」规则回归测试
  test-backend-sync.ts         云同步合并规则回归测试
  test-account-auth.ts         账号 / 密码 / 令牌 / 班级码纯函数体检
  test-account-session.ts      会话持久化体检
print/    A4 打印版测验表（HTML + PDF）
```

## 数据存储与云同步

数据一律**本地优先**：所有操作先写浏览器 localStorage 并立即响应界面；接入云端后才在后台异步同步。

存三类数据：

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 学习进度 | `phonemes` / `checkedDays` / `quizStats` | 每个音标的代表词、已学标记、错题与连对次数、打卡日期、闯关统计 |
| 收藏 | `favorites` / `favoriteTombstones` | 收藏时间戳 + 取消收藏时间戳（墓碑），保证「取消收藏」跨设备也能生效 |
| 答题记录 | `attempts` | 逐条记录音标、对错、连对数、时间，最多保留 500 条 |

### 不配后端也能用

什么都不配就是纯本地模式：不发起任何网络请求，行为与早期版本完全一致。顶栏云朵图标会显示「仅保存在本机」。

### 接入 Cloudflare Workers + D1（推荐，国内访问稳）

> ⚠️ **不要用 `*.workers.dev`**：中国大陆对 `*.workers.dev` 做了 DNS 污染 + TLS 重置，国内用户根本连不上。
> 线上站点在国内（`*.space.mcode.cn`）时，后端必须走 `*.pages.dev`（Cloudflare Pages Function，同一个账号、同一个 D1 绑定、未被拦截）。

```bash
cd backend/cloudflare
npx wrangler d1 create phonics-studio        # 把返回的 database_id 填进 wrangler.toml
npx wrangler d1 execute phonics-studio --file=./schema.sql

# 方式 A：Pages Function（国内可用，推荐）
cd pages
npx wrangler pages project create phonics-studio-api
npx wrangler pages deploy ./public --project-name phonics-studio-api
# → https://phonics-studio-api.pages.dev

# 方式 B：传统 Worker（仅海外/已自备可达域名时使用）
cd ..
npx wrangler deploy                           # → https://xxx.workers.dev
```

然后在项目根建 `.env`：

```
VITE_BACKEND_KIND=worker
VITE_BACKEND_URL=https://phonics-studio-api.pages.dev
```

### 接入 Supabase（已废弃）

前端只实现了 Cloudflare Pages Functions + D1 一种远端；`backend/supabase/` 下的 SQL 是早期方案，留作存档，当前不会被使用。

## 账号与班级

账号体系只有三样东西：**用户名 + 密码 + 班级码**，没有邮箱验证、没有手机号、没有恢复码、也没有管理码。

| 角色 | 能做什么 |
| --- | --- |
| 任何人 | 注册账号（用户名 2–20 位，密码至少 6 位）、登录、退出登录、自己改密码 |
| 学生 | 输入班级码加入班级，进度自动同步到云端；换设备用同一个账号登录即可拉回 |
| 老师（建班者） | 建班拿到 8 位班级码、查看班级看板、踢人、重置学生密码、撤销班级 |

### 老师 / 学生身份

注册的时候就要说清自己是哪一类，身份定下来之后不能改：

- **学生**：直接注册即可，界面里只给「输入班级码加入」，**没有「创建班级」**；
- **老师**：注册时填**教师邀请码**，校验通过才能建班、才能看班级看板。

邀请码是部署方自己掌握的（Pages secret `TEACHER_INVITE_CODE`，不进前端包），由要建班的老师发给自己。服务端会兜死权限：学生账号即使绕过界面直接调建班接口，也会被 403 拒绝。

> 部署方设置邀请码：
>
> ```powershell
> cd backend/cloudflare/pages
> "你的邀请码" | npx wrangler pages secret put TEACHER_INVITE_CODE --project-name phonics-studio-api
> ```

老账号（升级前就存在的）在迁移时按「是不是班级 owner」自动判定：owner 升成老师，其余按学生处理。

实现要点：

- 密码用 **PBKDF2-SHA256 / 20000 轮 / 每账号独立 16 字节 salt** 哈希，服务端只存哈希与 salt，明文不落库；
- 登录后拿到一枚 32 字节 base64url **会话令牌**，后续请求放在 `x-phonics-token` 头，服务端只存令牌的 SHA-256 哈希；
- 成员之间数据**互相隔离**，一个账号同时只能在一个班；换班前先退出；
- 看板统计**只算学生**（老师不答题，计进分母会把平均正确率拉低）；
- 看板不解析全量进度：写入进度时服务端冗余写一份统计，看板只读那一列，规避 Workers Free 的 10ms CPU 限制；
- 没有账号 = **纯本机**，不发起任何云端请求；登录后本机进度按账号分区存放，同一台电脑上多个账号互不污染；
- 忘记密码只能靠**老师在看板上重置**（生成临时密码并清掉该学生所有会话），这是无验证体系的必然代价。

接口清单见 `backend/cloudflare/pages/functions/api/[[path]].ts` 顶部注释；纯函数体检见 `scripts/test-account-auth.ts`；身份 / 权限门禁体检见 `npm run check:role`（30 项）。

### 账号链路在弱网下要「稳」

前端在国内（`*.space.mcode.cn`），后端在 `*.pages.dev`（**跨境**）—— 这条链路的抖动是真实存在的。第 9 轮实测抓到三个坑并修掉：

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| **8 秒超时太短** | 建班请求碰上 TCP 丢包重传（实测挂到 9 秒才被掐断），被浏览器 abort，**班级根本没建出来** | 超时放宽到 **15 秒**（`REQUEST_TIMEOUT_MS`）；页面加载时先 `ping()` **预热连接**，用户点按钮时已是热连接 |
| **技术错误直接甩给用户** | 界面上冒出来 `signal is aborted without reason` | `src/services/backend/error-messages.ts` 的 `normalizeBackendError()` 统一翻译成中文人话：掐断 →「网络太慢没连上，等一会儿再试一次」，网络不可达 →「连不上服务器，检查一下网络再试一次」；**服务端给的中文提示原样保留** |
| **界面只信本地会话** | 本地会话是登录那会儿的快照。用户在别的设备建过班 → 界面还写「还没建班级」，点「创建班级」被服务端 409 顶回来，用户被卡死 | 挂载时和打开「我的数据」面板时都跑 `syncAccountState()`：`ping()` 预热 + `me()` **跟服务端校准**身份与班级状态；建班失败后回头 `refreshMembership()`（请求可能其实成功了，只是响应丢了） |

建班**不是幂等**的，所以**不自动重试** —— 超时后重试可能建出两个班。正确做法是「失败后刷新班级状态」，让界面自己看出到底建没建成。

`npm run check:account-net`（16 项）逐条守住这三件事，包括**对着一个「收到请求但不回话」的本地服务器真跑一次建班**，断言抛出来的是中文人话而不是 AbortError 原文。改账号链路（超时、错误文案、身份校准）必跑。

### 班级看板读取要「快」

老师反馈「班级看板读取数据速度有点慢」。第 10 轮实测发现：**慢的根因是跨境网络，不是代码**。

同一个 `/api/health`（11 字节、零 D1 查询）、同一台机器：Node 直连中位 **268ms**，Chrome 里 **310 ~ 3151ms**（抖动 10 倍）；加 `--disable-quic` 无差别（`nextHopProtocol` 本来就是 http/1.1，不是 QUIC 的锅）。单条 SQL 在 D1 上只要 0.26ms，看板响应体也只有 3.9 KB —— **D1 查询本身完全不是瓶颈**。

所以别再指望「优化接口实现」能把它压下去。能压的只有两件事：**少跑一趟** + **把等待藏起来**。

| 改法 | 做了什么 |
| --- | --- |
| **后端少跑一趟** | `requireAuth` 原来是串行 **4 次** D1 查询（session → account → member → space），现在合成 **一条 JOIN**（`AUTH_LOOKUP_SQL`）；看板接口自身再查一次成员表（`CLASS_MEMBERS_SQL`，一条 LEFT JOIN accounts，**不是 N+1**）。整条链路 5 次往返 → 2 次 |
| **前端藏等待** | `src/services/backend/class-overview-cache.ts` 做 stale-while-revalidate：上次看过的数据存 localStorage，再打开**立刻亮出来**，同时后台刷新 |
| **预取要早** | 老师点「打开班级看板」之前往往只隔几百毫秒 —— 等点「我的数据」才拉来不及。`App.tsx` 在**登录态就绪时**就预取，打开面板时再补一次（30 秒节流） |
| **数据够新就别再打接口** | `isClassOverviewFresh()`（30 秒门槛）：预取刚回来老师就点看板，再发一次就是白等 300~3000ms。但**手动点「刷新」和改名单之后必须 `load(true)` 强制拉最新**，不拿缓存糊弄老师 |
| **慢的时候说人话** | 超过 600ms（`SLOW_LOAD_HINT_MS`）显示「网络有点慢，还在读班级数据…」，别让人干瞪眼 |
| **缓存按班级隔离** | 换班 / 退班不能把上一个班的成绩串过来；缓存内容坏了**安全退化成空**，不许抛错把页面搞崩 |

线上实测（跨境抖动 300~3000ms 的真实环境）：

| 场景 | 改之前 | 改之后 |
| --- | --- | --- |
| 第一次打开看板 | 1442ms | **292ms** |
| 第二次打开 | 1459ms | **71ms** |
| 点看板时额外发几次请求 | 1 | **0** |

`npm run check:dash-perf`（24 项）逐条守住这些约束 —— 包括「鉴权是 1 条 JOIN」「看板接口只查 1 次」「缓存按班级隔离」「坏 JSON 安全退化」「缓存够新不重复打接口」「刷新/改名单强制 `load(true)`」「App 在登录态就绪即预取」。改班级看板或账号鉴权必跑。

### 合并规则

多设备同时学习时以「不丢数据、只增不减」为准（实现见 `src/services/backend/merge.ts`）：

- 音标进度：以最近学习时间较新的一方为准
- 打卡日期：取并集
- 闯关统计：各项取最大值
- 收藏：按时间戳决胜，取消收藏可跨设备生效
- 答题明细：按 ID 去重后取并集

回归测试见 `scripts/test-backend-sync.ts`。

## 「待巩固」判定规则

顶部状态栏的「待巩固 N 音」= 测验里答错过、且**还没重新拿下**的音标数量。

- 答错：进入「待巩固」，错题计数 +1，连续答对次数清零
- 答对：连续答对次数 +1；**连续答对 3 次自动移出「待巩固」**（错题计数归零）
- 移出后再答错，会重新回到「待巩固」

侧边栏的筛选档位：`未学`（未打卡）、`待巩固`（错题计数 > 0）、`已掌握`（已打卡且错题计数为 0）。规则实现见 `src/utils/consolidation.ts`，回归测试见 `scripts/test-consolidation.ts`。

## 视频加载性能

「口型演示实验室」的视频走阿里云 OSS + CDN（`X-Swift-CacheTime: 2592000`，边缘缓存 30 天），但源站对浏览器下发 `Cache-Control: no-store`，**浏览器不落盘缓存**——每次切换音标或重播都要完整重下一遍。所以体积就是首帧延迟，体积必须压到最小：

- 48 个视频全部重编码为 **640×360 / h264 main / CRF 27 / faststart**，总体积 **15.19 MB → 1.95 MB（-87%）**，单文件 81 KB 以内
- **每个视频都带示范发音音轨**（AAC 32 kHz 单声道 48 kbps）。这是踩过的坑：最初那版重编码只写了 `-c:v libx264`，音轨被整个丢掉 —— 画面照播但一点声音没有，而且 **ffmpeg 不报错**，不专门 probe 文件根本发现不了。现在 `npm run check:video` 会解析每个 MP4 的 `moov/trak/mdia/hdlr` box，确认存在 `soun` handler 且 codec 为 `mp4a`
- 每个视频配一张 **首帧封面** `public/assets/poster/*.jpg`（约 15 KB），`<video>` 加 `poster` + `preload="metadata"`，视频没下完也先有画面，不再是黑屏转圈

改动前后的量化对照由 `scripts/check-video-perf.ts` 把关（`npm run check:video`，11 项断言），涉及视频素材或 `<video>` 标签时必跑。

**「有没有声音」怎么验**（别只信文件存在）：工作区 `破甲\_tools\video_audio_verify.js` 用 Chromium 的 `video.webkitAudioDecodedByteCount` 读实际解码出的音频字节数，**为 0 就是没声音**。配套的 `video_audio_contrast.js` 会把同一个判据指向一个无音轨文件，读数必须是 0 —— 证明判据本身有效，不是永远绿。

## 音频加载性能

「听标准发音」「只听纯音频」「单词热点」走的是同一套阿里云 OSS + CDN，同样有 `Cache-Control: no-store`（浏览器不落盘缓存）+ 边缘缓存 30 天两个约束，所以**音频体积就是点击到出声的延迟**。

- 48 个音标发音：**44.1 kHz 立体声 105 kbps → 24 kHz 单声道 48 kbps**，578 KB → **307 KB（-47%）**，单文件 9 KB 以内
- 190 个单词朗读：**32 kHz 立体声 → 24 kHz 单声道 32 kbps**，1.44 MB → **800 KB（-45%）**，单文件 6 KB 以内
- 播放策略（`src/hooks/useAudioPlayer.ts`）：
  - 预加载走**队列 + 并发上限 2**。国内弱网下并发预载会互相抢带宽，反而把「马上要点的那一个」拖慢；队列先进先出，音标音频天然排在单词前面
  - 预加载缓存上限 **16** 个，淘汰时同步摘掉排队项
  - 播放时若还没缓冲够，界面亮 **「加载中」**（`pendingKey`），而不是让用户以为点了没反应
  - 单词音频缺失时平滑降级到浏览器 TTS 朗读

量化对照与约束由 `scripts/check-audio-perf.ts` 把关（`npm run check:audio`，16 项断言），涉及音频素材或播放逻辑时必跑。

## 手机版录音（跟读自检）

录音链路在移动端视口下实测是通的（真人读 `/iː/` 能拿 99 分），但**真机上有几个 Chromium 测不出的坑**，全部已修：

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| **录完没声音**，提示「只检测到环境背景声」 | iOS Safari 的 AudioContext 必须在**用户手势**里创建/恢复，否则停在 `suspended`；suspended 的 context 做 `decodeAudioData` 拿不到有效音频 | 点录音那一刻在用户手势的同步栈里 `ctx.resume()`（`src/utils/audio-context.ts`） |
| 长录音丢尾段 | `MediaRecorder.start()` 不切片，移动端长时间录音会丢最后一段 | 改成 `recorder.start(250)`，每 250ms 落一片 |
| 录完要干等一次下载 | 78 KB 的分析模块等到录完才 `import` | 录音开始时就预取该 chunk，录完立刻出分 |
| 手机上点录音像坏了 | 局域网 HTTP 下浏览器直接禁用麦克风，提示却只说「请在电脑端打开」 | 提示改成给出可操作方案（换线上 https 地址 / localhost） |

`scripts/check-record.ts`（`npm run check:record`，12 项断言）逐条守住这些约束，改录音代码必跑。

**怎么证明「录完有没有声音」**（别只信代码看着对）：工作区 `破甲\_tools\record_ctx_contrast.js` 会**伪造一个 suspended 的 AudioContext**（`state` 恒为 suspended，`decodeAudioData` 返回空 buffer），复现 iOS 的真实行为。有修复时：resume 被调用 → 3 次解码全在 running → 拿到分数；退回修复时：3 次解码全在 suspended → 分数 `--` → 提示「只检测到环境背景声」。这就是用户看到的症状。

## 卡片图片加载性能

手绘卡片图是首屏最大的单项负载，同样受 `Cache-Control: no-store` 与 CDN 边缘 30 天缓存约束。

- 原图 **1500×890 PNG**，而卡片展示区只有 **463×275 CSS px** —— 属于 **3.2 倍超采样**，绝大多数像素在浏览器里被直接丢弃
- 全部重编码为 **1050×623 WebP q82**：**5.87 MB → 1.55 MB（-74%）**，单张 30–40 KB
- **1050×623 是精确同比例**：原图 1500:890 = 150:89，×7 = 1050:623。卡片上的单词热区按百分比定位，比例一变热区就整体偏移
- WebP 完胜 JPEG：同尺寸 SSIM 0.994 vs JPEG q85 的 0.959
- 全量 SSIM 校验最低 **0.9932**（0 张低于 0.98），视觉无损

`scripts/check-cards-perf.ts`（`npm run check:cards`，10 项断言）会**真读 WebP 文件头**解析像素尺寸来验同比例与不超采样，涉及卡片素材或引用路径时必跑。

## 「圈出最顺口的词」

手绘卡片上印着「听一遍、**圈一圈**，再跟读一遍」。「圈」这个动作以前**只存在于图片里**，网站上并没有 —— 现在补上了：

- 卡片上**点词仍然只是朗读**（不因为试听就改答案）；
- 「圈」的唯一入口是卡片下方的 **A / B / C 三个词**，标题就叫「圈出读起来最顺口的那个词」；
- 选中后，**红笔手绘圈会画在卡片图上那个词的头上**（带一点甩出去的尾巴，像真手画的）；
- 再点同一个词 = **取消圈**；
- 自己写的词卡片上没有 → 词照样被记住，但**不画圈**。

实现上，圈的位置不是写死的常量，而是**每张卡一套槽位**：卡片图是 1050×623，`scripts/derive-card-word-slots.ts` 用 ffmpeg 把素材解成灰度、找出词文字行、按列聚类出三个词的包围盒，生成 `src/data/card-word-slots.ts`。圈层是同坐标系的 SVG（`viewBox="0 0 1050 623"` + `preserveAspectRatio="none"`），并设 `pointer-events: none` 以免挡住「点词朗读」。

换卡片素材后必须重新生成槽位：

```bash
node scripts/derive-card-word-slots.ts --write src/data/card-word-slots.ts
```

怎么证明「圈真的套在词上」（别只信代码看着对）：

- `npm run check:circle`（24 项）：槽位数据完整性、与素材实测误差 ≤ 4px、**圈覆盖率 ≥ 85%**（椭圆圈住的词块黑像素比例）、坐标系与 `pointer-events`、匹配纯函数真跑、旧口径文案全仓清零；
- `node scripts/e2e-card-circle.ts`（18 项，Playwright）：真点 chip → 圈出现 → 坐标等于该卡槽位 → 再点取消 → 点卡片词不产生圈 → 自己写的词不画圈 → 换音标圈不串；最后**截图取像素**，把红色像素的位置换算回 1050×623 坐标系，和原图里那个词的包围盒比对。

> 坑：卡片插画里本来就有大面积红色（苹果、船…），像素验证不能全图找红像素，必须先取圈层 `<ellipse>` 的屏幕矩形，只在那一个窗口里找。

## 学习流程：两步 —— ① 听一遍、圈一圈 → ② 跟读一遍

网站上是**两步**，卡片上印的也是同样两步：「**听一遍、圈一圈，再跟读一遍。**」

| 步骤 | 内容 | 位置 |
| --- | --- | --- |
| **① 听一遍，圈一圈** | 点卡片听这个音怎么读、点词听单词；然后在 A / B / C 里挑出读起来最顺口的那个词，**红圈画在卡片上那个词的位置** | 最上：卡片图 → 圈出区 |
| **② 跟读一遍** | 先听一遍原声，再开口跟读录音，录音跟原声对比打分 | 最后：跟读区 |

**「圈出」是第 1 步的一部分，不是独立的第 3 步** —— 听的时候顺手把最顺口的那个词圈出来，这两件事都在卡片上完成。物理顺序是：卡片 → 圈出区 → 跟读区。

跟读区里也拆成两小步：提示行「① 先听原声 → ② 跟我读一遍」，**第一个按钮是「先听一遍原声」**，录音按钮排在它后面。原来的「只听原声」按钮删掉了 —— 语义跟第一个重复，留着只会让人不知道该按哪个。

### 卡片上的印刷语跟网站步骤绑在一起

卡片图上**印着**那行教学指令，网站上也有一套步骤文案。以前两边各写各的，改了一边另一边不跟 —— 孩子照着卡片做，跟网站上看到的步骤对不上。

现在两边都从 `src/data/learning-flow.ts` 取（`STEP_LISTEN_CIRCLE` / `STEP_READ_ALONG` / `CARD_INSTRUCTION`），`npm run check:print` 断言：

- 卡片印刷语**包含网站每一步的全部关键词，且顺序一致**（每个关键词一条断言，不合并 —— 合并的话逐项退回对不上号）；
- 重印脚本 `scripts/reprint_card_instruction.py` 里的印刷语与常量**一字不差**；
- 48 张卡上**实际印出来**的那一行墨迹特征符合新句（新句宽 ≈336px / 旧句 547px，没重印或印错句子宽度就出界）。

改印刷语的流程：

```bash
# 1. 改 src/data/learning-flow.ts 的 CARD_INSTRUCTION
# 2. 同步改 scripts/reprint_card_instruction.py 的 NEW（尺子会查）
python scripts/reprint_card_instruction.py --cards public/assets/cards --out public/assets/cards
# 3. 重推圈槽位（图片换了版本）
node scripts/derive-card-word-slots.ts --write src/data/card-word-slots.ts
# 4. 体检
npm run check:print && npm run check:circle && npm run check:cards
```

重印脚本的做法：**擦掉旧句那一行，再用同样的字体/字号/左边界/垂直中心印新句** —— 插画、词行、紫色卡头全不动。字体字号是拿**原句复现**校准出来的（msyhbd.ttc 24 号，复现宽度 552 vs 原图 547，差 0.9%，叠图比对过）。擦除时逐行用「同行左侧无墨迹区平均色」填充，底色的垂直渐变被保留，不会留下死板的补丁。

怎么证明顺序没跑偏（别只信代码看着对）：

- `npm run check:flow`（17 项）：两步编号徽标、**没有第 3 步**、圈出区紧跟卡片、跟读区在最后、第 1/2 步徽标的位置、跟读区第一个动作是「先听一遍原声」、小步提示 ①/②、步骤徽标 CSS 存在；
- `npm run e2e:flow`（17 项，Playwright）：徽标只有 2 个且从上到下、圈出区**视觉上**在跟读区上面、「先听一遍原声」确实是跟读区第一个按钮、搬了位置后点词仍然能画圈并能取消。

> 坑一：尺子断言按钮文案前**必须先剥掉注释**。JSX 注释里也写着「先听一遍原声」，全文 grep 会把注释当成真按钮 —— 改坏按钮文案尺子照样全绿（假绿）。
>
> 坑二：「徽标在 X 之前」这类顺序断言要加**「徽标存在才判」的守卫**。否则「删掉徽标」这个缺陷会同时红在「有编号徽标」和「徽标在卡片之前」两条上，逐项退回时对不上号。存在性归一条、顺序归另一条，各司其职。
>
> 坑三：**中途 stop 掉退回验证脚本会留下脏仓库**。脚本靠 `finally` 还原文件，被强杀时还原不执行 —— 下一轮跑就会报莫名其妙的失败（比如「找不到 OLD 常量」）。中断后先确认 `git status` 干净。

## 交互动效与可访问性

学习页有一批交互动效（卡片弹跳、跟读高分庆祝、连击爆发、选项抖动、结算入场），两条约束：

- **没有 `infinite` 无限动画**。连击徽章的脉冲改成 `animation: combo-pulse 0.9s ease 3`（播 3 次就停）—— 徽章一直挂在顶栏，无限重绘会持续吃移动端 GPU。
- **尊重系统的「减弱动态效果」**。`src/index.css` 末尾有 `prefers-reduced-motion: reduce` 降级块：所有动画类 `animation: none`，`forwards` 终态的连击爆发层额外 `display: none`（只关动画会让「×3 连击！」永远留在屏幕正中央）。

`scripts/check-motion.ts`（`npm run check:motion`，4 项断言）逐条守住；改任何动效后必跑。

**怎么验不是只看 CSS**（工作区 `破甲\_tools\motion_reduced_verify.js`）：用 Playwright 的 `emulateMedia({ reducedMotion: 'reduce' })` 让浏览器真的按减弱动效渲染，然后读 computed style —— reduce 下 `animation-name` 必须是 `none`，normal 下必须是动画名（对照组证明判据没永远绿），爆发层 `display` 必须是 `none`。

## 首屏加载性能

**这条是本项目对国内网络最关键的一条。** 素材托管在阿里云 OSS + CDN 上，实测发现：

| 资源类型 | CDN 是否 gzip |
| --- | --- |
| HTML / CSS | ✅ 会压 |
| **JS（33B / 24KB / 220KB 全测过）** | ❌ **一律不压** |

所以**产物的字节数就是国内用户的真实下载量**，压不掉，只能少加载。3G 限速（400 kbps / 300ms）实测，改之前光一个 JS 就要下 **8.8 秒**。

四项改造：

- **运行时换成 preact/compat**（`vite.config.ts` 的 `resolve.alias`）：`react-dom` 单模块就 202 KB，占改造前首屏的 2/3，换成 preact 后约 25 KB。本项目只用到 `createRoot` / hooks / `lazy` / `Suspense` / `forwardRef`，没有用 React 19 特有 API
- **非首屏组件分包**：听力测验、14 天计划、易混屋、我的数据、班级看板全部 `React.lazy`，且**必须条件渲染**（组件一旦被渲染，lazy 照样会拉 chunk）
- **录音分析模块按需加载**：`pronunciation-analyzer` 连同 63 KB 声学模板表只在录完音后才用，改成动态 import，空闲时预抢
- **预取不与首屏抢带宽**：等 `window.load` 之后再延后 ≥1500 ms 启动；弱网（`effectiveType` 为 2g/3g）直接不预取

改造前后（线上实测）：

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 首屏 JS（未压缩） | 425.8 KB | **105 KB** |
| 首屏请求数 | 20 | **10** |
| 首屏总传输 | 540 KB | **229 KB** |
| 3G 下首屏全部资源就绪 | 12104 ms | **5861 ms** |
| 3G 下卡片图可见 | 12079 ms | **5855 ms** |

`scripts/check-js-budget.ts`（`npm run check:js`，9 项断言）会自己跑一份带 sourcemap 的构建，用 manifest 精确算出「首屏真正加载哪些 chunk、含哪些源码」，改动分包或运行时后必跑。

## 重新生成音素声学模板

`src/data/phoneme-templates.json` 是离线算出来的：对每个音标的 MP3 用 ffmpeg 转成 16 kHz 单声道 PCM，提取声学特征后量化成模板。

```bash
node scripts/build-phoneme-templates.ts
```

需要本机装有 **ffmpeg**。重新生成后正常 `npm run build` 即可。

## 素材与授权

仓库自带全部音频、视频与手绘图素材（`public/assets/`，约 4.8 MB，其中手绘卡片图 1.55 MB、视频 1.4 MB、单词音频 0.8 MB、视频封面 0.7 MB、音标音频 0.3 MB），用于教学演示场景。**若要商用或二次分发，请先确认每份素材的原始授权**；本仓库的 MIT 协议只覆盖代码，不自动覆盖第三方素材的版权。

## 许可

代码部分采用 [MIT](./LICENSE) 协议。素材部分见上一节说明。
