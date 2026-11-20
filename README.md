# 48 音标小铺 · Phonics Studio

面向初一学生的 **48 个国际音标** 互动伴学网页。看图辨音、听音辨形、跟读打分、易混音标对比、14 天闯关计划，一个页面全包。

技术栈：**React 19 + TypeScript + Vite 8 + Oxlint**，纯前端、无后端依赖，学习进度存在浏览器 localStorage 里。

线上体验：<https://5p3wt4cgcivtd.space.mcode.cn>

## 功能

| 模块 | 说明 |
| --- | --- |
| 卡片工坊 | 48 张手绘音标卡 + 发音音频 + 口型演示视频 + 单词例词，支持完成打卡、设代表词 |
| 14 天计划 | 把 48 个音标排进 14 天闯关路线，可按天筛选进入工坊 |
| 易混音标对 | 专治 `/ɪ/` vs `/iː/`、`/θ/` vs `/s/` 这类易混组合，横向对比 |
| 听力测验 | 听音选音标，自动挑出你的薄弱项并跳转复习 |
| 跟读打分 | 浏览器录音 → 提取声学特征 → 与离线模板比对，给出发音相似度 |

## 快速开始

```bash
npm install       # 安装依赖
npm run dev       # 开发服务器
npm run build     # 生产构建，产物在 dist/
npm run preview   # 预览生产构建
npm run lint      # Oxlint 检查
npm test          # 「待巩固」规则回归测试（纯 Node，无需浏览器）
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
    usePhonicsProgress.ts   学习进度 / 测验统计（localStorage）
    useVoiceRecorder.ts     录音采集与音量监测
    useAudioPlayer.ts       音频播放
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
scripts/
  build-phoneme-templates.ts   离线重建音素模板
print/    A4 打印版测验表（HTML + PDF）
```

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
