import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import phoneticsData from '../src/data/phonetics.json' with { type: 'json' };
import {
  CONFUSABLE_WORD_GROUPS,
  MINIMAL_WORD_PAIRS,
  PHONEME_DECODING_MAP,
  getDistractorsForWord,
} from '../src/data/phonics-decoding.ts';
import {
  applySpeakingOutcome,
  computePhonemeWeakScore,
  isTrueMastered,
} from '../src/utils/consolidation.ts';

const ROOT = process.cwd();
const WORDS_DIR = join(ROOT, 'public', 'assets', 'words');
const phonemeIds = new Set(phoneticsData.phonemes.map((p) => p.id));

console.log('[检查 1] 48 音标拼读拆解规则与音频覆盖率');
let missingPhonemes = 0;
const checkedWords = new Set<string>();

for (const p of phoneticsData.phonemes) {
  const spec = PHONEME_DECODING_MAP[p.id];
  assert.ok(spec, `缺少音标 ${p.id} (${p.symbol}) 的拼读拆解规则`);
  assert.ok(spec.patterns.length >= 1, `${p.id} 至少应有 1 条字母规律`);
  assert.ok(spec.blendWords.length >= 2, `${p.id} 至少应有 2 个可拼装真词`);
  for (const bw of spec.blendWords) {
    assert.ok(bw.segments.length >= 2, `${bw.word} 至少拆分为 2 个音素段`);
    assert.ok(
      bw.segments.some((s) => s.phonemeId === p.id && s.isTarget),
      `${bw.word} 缺少靶向音素标记 ${p.id}`,
    );
    for (const seg of bw.segments) {
      assert.ok(phonemeIds.has(seg.phonemeId), `非法音素 ID: ${seg.phonemeId} (${bw.word})`);
    }
    const audioPath = join(WORDS_DIR, `${bw.word.toLowerCase()}.v2.mp3`);
    assert.ok(existsSync(audioPath), `缺少拼读真词音频: ${audioPath}`);
    checkedWords.add(bw.word.toLowerCase());
  }
}
assert.equal(missingPhonemes, 0);
console.log(`  ✓ 全 48 个音标拼读规则完整，验证拼读词 ${checkedWords.size} 个均含 .v2.mp3 音频`);

console.log('[检查 2] 最小对立词库音频与混淆组覆盖');
for (const mp of MINIMAL_WORD_PAIRS) {
  assert.ok(phonemeIds.has(mp.leftId), `非法 leftId: ${mp.leftId}`);
  assert.ok(phonemeIds.has(mp.rightId), `非法 rightId: ${mp.rightId}`);
  const leftFile = join(WORDS_DIR, `${mp.leftWord.toLowerCase()}.v2.mp3`);
  const rightFile = join(WORDS_DIR, `${mp.rightWord.toLowerCase()}.v2.mp3`);
  assert.ok(existsSync(leftFile), `缺少最小对立左词音频: ${mp.leftWord}`);
  assert.ok(existsSync(rightFile), `缺少最小对立右词音频: ${mp.rightWord}`);
}
console.log(`  ✓ ${MINIMAL_WORD_PAIRS.length} 对最小对立词双侧音频全齐备`);

console.log('[检查 3] 「看音标猜单词」防作弊近音干扰生成器');
const pool = phoneticsData.phonemes.flatMap((p) => p.examples);
for (const grp of CONFUSABLE_WORD_GROUPS) {
  for (const w of grp.words) {
    assert.ok(existsSync(join(WORDS_DIR, `${w.word.toLowerCase()}.v2.mp3`)), `缺少干扰词音频: ${w.word}`);
  }
}
const sheepDistractors = getDistractorsForWord('sheep', pool);
assert.equal(sheepDistractors.length, 3);
assert.ok(
  sheepDistractors.some((d) => d.word === 'ship'),
  'sheep 的干扰项必须包含最小对立词 ship',
);
assert.ok(
  sheepDistractors.filter((d) => d.word.startsWith('s')).length >= 2,
  'sheep 的干扰项应优先同首字母/近音词，禁止全配无关首字母送分选项',
);
console.log('  ✓ 近音同形强干扰生效:', sheepDistractors.map((d) => d.word).join(', '));

console.log('[检查 4] 真掌握与声学纠偏回流待巩固规则');
const base = { representativeWord: 'tea', completed: false, mistakeCount: 0, consecutiveCorrect: 0 };
// 只点代表词或仅做一次拼读演示，绝不误判为真掌握
assert.equal(isTrueMastered({ ...base, blendedCompleted: true }), false);
// 跟读误偏成 /s/ 且仅得 55 分 -> 自动进入待巩固并记录偏移音标
const failedSpeaking = applySpeakingOutcome(base, 55, 's', 1700000000000);
assert.equal(failedSpeaking.completed, false);
assert.equal(failedSpeaking.lastConfusedWithId, 's');
assert.ok(failedSpeaking.mistakeCount >= 1);
assert.ok(computePhonemeWeakScore(failedSpeaking) > 50);

// 跟读 >= 72 达标 -> 记入真掌握且安排长间隔复习
const passedSpeaking = applySpeakingOutcome(base, 86, undefined, 1700000000000);
assert.equal(passedSpeaking.completed, true);
assert.equal(passedSpeaking.speakingBestScore, 86);
assert.equal(isTrueMastered(passedSpeaking), true);
console.log('  ✓ 跟读失准回流待巩固、达标解锁真掌握规则全部通过\n');
