# 48 音标小铺 · Phonics Studio

面向初一学生的 **48 个国际音标** 互动伴学网页。看图辨音、听音辨形、跟读打分、易混音标对比、14 天闯关计划，一个页面全包。

技术栈：**React 19 + TypeScript + Vite 8 + Oxlint**，默认**纯前端、无后端依赖**，学习进度存在浏览器 localStorage 里；可选接入 Cloudflare Workers / Supabase 做多设备云同步。

线上体验：<https://5p3wt4cgcivtd.space.mcode.cn>

## 功能

| 模块 | 说明 |
| --- | --- |
| 卡片工坊 | 48 张手绘音标卡 + 发音音频 + 口型演示视频 + 单词例词，支持完成打卡、设代表词 |
| 14 天计划 | 把 48 个音标排进 14 天闯关路线，可按天筛选进入工坊 |
| 易混音标对 | 专治 `/ɪ/` vs `/iː/`、`/θ/` vs `/s/` 这类易混组合，横向对比 |
| 听力测验 | 听音选音标，自动挑出你的薄弱项并跳转复习 |
| 跟读打分 | 浏览器录音 → 提取声学特征 → 与离线模板比对，给出发音相似度 |
| 我的数据 | 收藏夹（可筛选）、答题记录回顾、云同步与同步码设置 |

## 快速开始

```bash
npm install       # 安装依赖
npm run dev       # 开发服务器
npm run build     # 生产构建，产物在 dist/
npm run preview   # 预览生产构建
npm run lint      # Oxlint 检查
npm test          # 「待巩固」规则回归测试（纯 Node，无需浏览器）
node scripts/test-backend-sync.ts   # 云同步合并规则回归测试（纯 Node）
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
    backend/                数据后端适配层（本地 / Cloudflare Worker / Supabase 可换）
      types.ts              后端契约（BackendProvider）
      merge.ts              本地与云端状态的合并规则
      user-key.ts           用户密钥与同步码
      worker-backend.ts     Cloudflare Workers + D1 实现
      supabase-backend.ts   Supabase (PostgREST) 实现
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
  cloudflare/   Worker 源码 + D1 建表 SQL + wrangler 配置
  supabase/     Supabase 建表 SQL（含行级安全策略）
scripts/
  build-phoneme-templates.ts   离线重建音素模板
  test-consolidation.ts        「待巩固」规则回归测试
  test-backend-sync.ts         云同步合并规则回归测试
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

### 接入 Supabase

在 SQL Editor 里执行 `backend/supabase/schema.sql`，然后：

```
VITE_BACKEND_KIND=supabase
VITE_BACKEND_URL=https://xxxx.supabase.co
VITE_BACKEND_ANON_KEY=你的 anon key
```

### 同步码

「我的数据」面板里可以设置一串**同步码**（至少 8 位）。同一串同步码在不同设备上指向同一份云端数据；不填就只在本机保存。

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

## 重新生成音素声学模板

`src/data/phoneme-templates.json` 是离线算出来的：对每个音标的 MP3 用 ffmpeg 转成 16 kHz 单声道 PCM，提取声学特征后量化成模板。

```bash
node scripts/build-phoneme-templates.ts
```

需要本机装有 **ffmpeg**。重新生成后正常 `npm run build` 即可。

## 素材与授权

仓库自带全部音频、视频与手绘图素材（`public/assets/`，约 23 MB），用于教学演示场景。**若要商用或二次分发，请先确认每份素材的原始授权**；本仓库的 MIT 协议只覆盖代码，不自动覆盖第三方素材的版权。

## 许可

代码部分采用 [MIT](./LICENSE) 协议。素材部分见上一节说明。
