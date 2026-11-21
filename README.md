# 48 音标小铺 · Phonics Studio

面向初一学生的 **48 个国际音标** 互动伴学网页。看图辨音、听音辨形、跟读打分、易混音标对比、14 天闯关计划，一个页面全包。

技术栈：**React 19 + TypeScript + Vite 8 + Oxlint**，默认**纯前端、无后端依赖**，学习进度存在浏览器 localStorage 里；接入 Cloudflare Pages Functions + D1 后可用「用户名 + 密码」账号体系跨设备同步、按班级码组班、老师看全班看板。

线上体验：<https://5p3wt4cgcivtd.space.mcode.cn>

## 功能

| 模块 | 说明 |
| --- | --- |
| 卡片工坊 | 48 张手绘音标卡 + 发音音频 + 口型演示视频 + 单词例词，支持完成打卡、设代表词 |
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

实现要点：

- 密码用 **PBKDF2-SHA256 / 20000 轮 / 每账号独立 16 字节 salt** 哈希，服务端只存哈希与 salt，明文不落库；
- 登录后拿到一枚 32 字节 base64url **会话令牌**，后续请求放在 `x-phonics-token` 头，服务端只存令牌的 SHA-256 哈希；
- 成员之间数据**互相隔离**，一个账号同时只能在一个班；换班前先退出；
- 看板统计**只算学生**（老师不答题，计进分母会把平均正确率拉低）；
- 看板不解析全量进度：写入进度时服务端冗余写一份统计，看板只读那一列，规避 Workers Free 的 10ms CPU 限制；
- 没有账号 = **纯本机**，不发起任何云端请求；登录后本机进度按账号分区存放，同一台电脑上多个账号互不污染；
- 忘记密码只能靠**老师在看板上重置**（生成临时密码并清掉该学生所有会话），这是无验证体系的必然代价。

接口清单见 `backend/cloudflare/pages/functions/api/[[path]].ts` 顶部注释；纯函数体检见 `scripts/test-account-auth.ts`。

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

- 48 个视频全部重编码为 **640×360 / h264 main / CRF 27 / faststart**，总体积 **15.19 MB → 1.44 MB（-90.5%）**，单文件 60 KB 以内
- 每个视频配一张 **首帧封面** `public/assets/poster/*.jpg`（约 15 KB），`<video>` 加 `poster` + `preload="metadata"`，视频没下完也先有画面，不再是黑屏转圈

改动前后的量化对照由 `scripts/check-video-perf.ts` 把关（`npm run check:video`，8 项断言），涉及视频素材或 `<video>` 标签时必跑。

## 音频加载性能

「听标准发音」「只听纯音频」「单词热点」走的是同一套阿里云 OSS + CDN，同样有 `Cache-Control: no-store`（浏览器不落盘缓存）+ 边缘缓存 30 天两个约束，所以**音频体积就是点击到出声的延迟**。

- 48 个音标发音：**44.1 kHz 立体声 105 kbps → 24 kHz 单声道 48 kbps**，578 KB → **307 KB（-47%）**，单文件 9 KB 以内
- 190 个单词朗读：**32 kHz 立体声 → 24 kHz 单声道 32 kbps**，1.44 MB → **800 KB（-45%）**，单文件 6 KB 以内
- 播放策略（`src/hooks/useAudioPlayer.ts`）：
  - 预加载走**队列 + 并发上限 2**。国内弱网下并发预载会互相抢带宽，反而把「马上要点的那一个」拖慢；队列先进先出，音标音频天然排在单词前面
  - 预加载缓存上限 **16** 个，淘汰时同步摘掉排队项
  - 播放时若还没缓冲够，界面亮 **「加载中」**（`pendingKey`），而不是让用户以为点了没反应
  - 单词音频缺失时平滑降级到浏览器 TTS 朗读

量化对照与约束由 `scripts/check-audio-perf.ts` 把关（`npm run check:audio`，14 项断言），涉及音频素材或播放逻辑时必跑。

## 重新生成音素声学模板

`src/data/phoneme-templates.json` 是离线算出来的：对每个音标的 MP3 用 ffmpeg 转成 16 kHz 单声道 PCM，提取声学特征后量化成模板。

```bash
node scripts/build-phoneme-templates.ts
```

需要本机装有 **ffmpeg**。重新生成后正常 `npm run build` 即可。

## 素材与授权

仓库自带全部音频、视频与手绘图素材（`public/assets/`，约 9.1 MB，其中手绘卡片图 5.9 MB、视频 1.4 MB、单词音频 0.8 MB、音标音频 0.3 MB、视频封面 0.7 MB），用于教学演示场景。**若要商用或二次分发，请先确认每份素材的原始授权**；本仓库的 MIT 协议只覆盖代码，不自动覆盖第三方素材的版权。

## 许可

代码部分采用 [MIT](./LICENSE) 协议。素材部分见上一节说明。
