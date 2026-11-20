/**
 * 离线生成 48 音素紧凑声学特征模板（src/data/phoneme-templates.json）
 * 运行方式：node scripts/build-phoneme-templates.ts
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractAcousticSignature,
  quantizeSignature,
  trimStudioAudio,
  type PhonemeTemplateMap,
} from '../src/utils/acoustic-features.ts';

interface RawPhoneme {
  id: string;
  symbol: string;
  category: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projRoot = path.resolve(scriptDir, '..');
const phoneticsPath = path.join(projRoot, 'src', 'data', 'phonetics.json');
const soundDir = path.join(projRoot, 'public', 'assets', 'sound');
const outPath = path.join(projRoot, 'src', 'data', 'phoneme-templates.json');

const dataset = JSON.parse(fs.readFileSync(phoneticsPath, 'utf-8')) as {
  phonemes: RawPhoneme[];
};

const templates: PhonemeTemplateMap = {};

for (const phoneme of dataset.phonemes) {
  const mp3Path = path.join(soundDir, `${phoneme.id}.mp3`);
  const pcmBuffer = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', mp3Path, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  // 确保 4 字节对齐拷贝到 Float32Array
  const alignedBuf = pcmBuffer.buffer.slice(
    pcmBuffer.byteOffset,
    pcmBuffer.byteOffset + pcmBuffer.byteLength,
  );
  const rawSamples = new Float32Array(alignedBuf);
  const { trimmed } = trimStudioAudio(rawSamples);
  const sig = extractAcousticSignature(trimmed, 1.0);
  templates[phoneme.id] = quantizeSignature(sig, phoneme.category, phoneme.symbol);
}

const jsonStr = JSON.stringify(templates);
fs.writeFileSync(outPath, jsonStr, 'utf-8');
console.log(
  `Generated ${Object.keys(templates).length} phoneme templates -> ${outPath} (${(
    Buffer.byteLength(jsonStr, 'utf-8') / 1024
  ).toFixed(1)} KB)`,
);
