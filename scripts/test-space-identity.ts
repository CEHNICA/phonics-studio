/**
 * 身份模型体检器（班级码 / 恢复密钥 / 管理码）
 * 运行方式：node scripts/test-space-identity.ts
 *
 * 直接调用生产代码 src/services/backend/space-client.ts，验证：
 * 1. 班级码规范化：去空格 / 去连字符 / 全大写
 * 2. 前缀分流：PH- → 恢复，OW- → 看板，其余 → 加入班级
 * 3. 班级码合法性：长度 4–12、字符集、弱码拦截
 * 4. 恢复密钥 / 管理码格式与随机性
 * 5. 哈希稳定性与域分隔隔离（ph-rec: / ph-owner: / ph-dev: 不串）
 * 6. 身份存储 round-trip
 * 7. 回归：合并规则不受身份改造影响
 */

import {
  buildDeviceHash,
  buildOwnerHash,
  buildRecoveryHash,
  clearIdentity,
  detectCodeKind,
  formatJoinCode,
  generateOwnerKey,
  generateRecoveryKey,
  isValidJoinCode,
  isValidOwnerKey,
  isValidRecoveryKey,
  loadIdentity,
  normalizeJoinCode,
  saveIdentity,
} from '../src/services/backend/space-client.ts';
import type { IdentityStorage, SpaceIdentity } from '../src/services/backend/space-client.ts';
import { mergeProgressState } from '../src/services/backend/merge.ts';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
    console.error(`      期望: ${JSON.stringify(expected)}  实际: ${JSON.stringify(actual)}`);
  }
}

function createMemoryStorage(): IdentityStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

console.log('\n[身份] 班级码 / 恢复密钥 / 管理码\n');

// 1. 班级码规范化
{
  check('去连字符', normalizeJoinCode('YW48-3BAN'), 'YW483BAN');
  check('去空格', normalizeJoinCode('  YW48 3BAN '), 'YW483BAN');
  check('统一大写', normalizeJoinCode('yw483ban'), 'YW483BAN');
  check('混合分隔符', normalizeJoinCode('yw 48-3ban'), 'YW483BAN');
  check('空串归一为空串', normalizeJoinCode(''), '');
  check('可读化分组', formatJoinCode('YW483BAN'), 'YW48-3BAN');
}

// 2. 前缀分流
{
  check('PH- 前缀 → 恢复', detectCodeKind('PH-ABCDE-FGHIJ-KLMNO-PQRST'), 'recovery');
  check('OW- 前缀 → 看板', detectCodeKind('OW-ABCDE-FGHIJ-KLMNO-PQRST'), 'owner');
  check('普通串 → 加入班级', detectCodeKind('YW48-3BAN'), 'join');
  check('小写 ph- 前缀也能识别', detectCodeKind('ph-abcde-fghij-klmno-pqrst'), 'recovery');
  check('空串 → 无效', detectCodeKind('   '), 'invalid');
  check('恢复码不会被误判为班级码', detectCodeKind('PH-ABCD') === 'join', false);
}

// 3. 班级码合法性
{
  check('4 位通过', isValidJoinCode('AB12'), true);
  check('12 位通过', isValidJoinCode('ABCDEFGH1234'), true);
  check('3 位拒绝', isValidJoinCode('ABC'), false);
  check('13 位拒绝', isValidJoinCode('ABCDEFGH12345'), false);
  check('非字母数字拒绝', isValidJoinCode('AB!2'), false);
  check('弱码 1234 拒绝', isValidJoinCode('1234'), false);
  check('弱码 000000 拒绝', isValidJoinCode('000000'), false);
  check('弱码 11111111 拒绝', isValidJoinCode('11111111'), false);
}

// 4. 恢复密钥 / 管理码格式
{
  const recovery = generateRecoveryKey();
  const owner = generateOwnerKey();
  check('恢复密钥前缀', recovery.startsWith('PH-'), true);
  check('恢复密钥格式合法', isValidRecoveryKey(recovery), true);
  check('恢复密钥长度 26（PH- + 4 组 5 位）', recovery.length, 26);
  check('管理码前缀', owner.startsWith('OW-'), true);
  check('管理码格式合法', isValidOwnerKey(owner), true);
  check('管理码长度 26（OW- + 4 组 5 位）', owner.length, 26);
  check('两次生成的恢复密钥不同', generateRecoveryKey() !== generateRecoveryKey(), true);
  check('标准格式恢复密钥通过', isValidRecoveryKey('PH-ABCDE-FGHIJ-KLMNO-PQRST'), true);
  check('短恢复密钥被拒', isValidRecoveryKey('PH-ABCD'), false);
  check('班级码不是恢复密钥', isValidRecoveryKey('YW483BAN'), false);
}

// 5. 哈希稳定性与域分隔
{
  const ownerHash = await buildOwnerHash('OW-ABCDE-FGHIJ-KLMNO-PQRST');
  const ownerHash2 = await buildOwnerHash('OW-ABCDE-FGHIJ-KLMNO-PQRST');
  const recoveryHash = await buildRecoveryHash('OW-ABCDE-FGHIJ-KLMNO-PQRST');
  const deviceHash = await buildDeviceHash('OW-ABCDE-FGHIJ-KLMNO-PQRST');

  check('哈希稳定', ownerHash, ownerHash2);
  check('哈希为 64 位十六进制', /^[0-9a-f]{64}$/.test(ownerHash), true);
  check('owner 域 ≠ rec 域', ownerHash !== recoveryHash, true);
  check('rec 域 ≠ dev 域', recoveryHash !== deviceHash, true);
  check('owner 域 ≠ dev 域', ownerHash !== deviceHash, true);
  check('不同明文哈希不同', (await buildRecoveryHash('a')) !== (await buildRecoveryHash('b')), true);
}

// 6. 身份存储 round-trip
{
  const storage = createMemoryStorage();
  const identity: SpaceIdentity = {
    spaceId: 'space_test',
    spaceName: '初二(3)班',
    kind: 'class',
    role: 'student',
    memberId: 'member_test',
    recoveryKey: 'PH-ABCDE-FGHIJ-KLMNO-PQRST',
    deviceHash: 'device-hash-test',
    joinedAt: '2026-11-20T00:00:00.000Z',
  };

  check('初始没有身份', loadIdentity(storage), null);
  saveIdentity(identity, storage);
  check('写入后能读回', loadIdentity(storage), identity);

  const ownerIdentity: SpaceIdentity = { ...identity, role: 'owner', ownerKey: 'OW-ABCDE-FGHIJ-KLMNO-PQRST' };
  saveIdentity(ownerIdentity, storage);
  check('覆盖后读到新身份', loadIdentity(storage)?.role, 'owner');
  check('ownerKey 被保留', loadIdentity(storage)?.ownerKey, 'OW-ABCDE-FGHIJ-KLMNO-PQRST');

  clearIdentity(storage);
  check('清除后为空', loadIdentity(storage), null);
}

// 7. 回归：合并规则不受身份改造影响
{
  const local = {
    phonemes: {},
    checkedDays: ['2026-11-19'],
    quizStats: { totalAnswered: 3, totalCorrect: 2, bestCombo: 2 },
    favorites: { 'phoneme-a': 1000 },
    favoriteTombstones: {},
    attempts: [],
  };
  const remote = {
    phonemes: {},
    checkedDays: ['2026-11-20'],
    quizStats: { totalAnswered: 5, totalCorrect: 4, bestCombo: 3 },
    favorites: {},
    favoriteTombstones: { 'phoneme-a': 2000 },
    attempts: [],
  };
  const merged = mergeProgressState(local, remote);
  check('打卡取并集', merged.checkedDays, ['2026-11-19', '2026-11-20']);
  check('答题总数取较大值', merged.quizStats.totalAnswered, 5);
  check(
    '取消收藏跨设备生效（墓碑时间较新）',
    merged.favoriteTombstones['phoneme-a'] > merged.favorites['phoneme-a'],
    true,
  );
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
