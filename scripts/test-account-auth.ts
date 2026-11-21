/**
 * 尺子：账号 + 密码 + 班级码 纯函数体检
 *
 *   node scripts/test-account-auth.ts
 *
 * 这些函数同时跑在浏览器和服务端（Pages Functions），所以全部保持无依赖、无环境假设。
 */

import {
  normalizeUsername,
  validateUsername,
  validatePassword,
  makeSalt,
  hashPassword,
  verifyPassword,
  generateToken,
  hashToken,
  normalizeJoinCode,
  formatJoinCode,
  isValidJoinCode,
  detectJoinCode,
} from '../src/services/backend/account-client.ts';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : detail);
  }
}

console.log('\n[尺子] 账号 / 密码 / 令牌 / 班级码\n');

/* ---------- 用户名 ---------- */
check('用户名去空白', normalizeUsername('  abc  ') === 'abc', normalizeUsername('  abc  '));
check('用户名统一小写', normalizeUsername('AbC') === 'abc');
check('中文用户名保留', normalizeUsername('小明') === '小明');
check('用户名去中间空格', normalizeUsername('小 明') === '小明');
check('太短的用户名不合法', !validateUsername('a'));
check('2 字中文用户名合法', validateUsername('小明'));
check('超过 20 字符不合法', !validateUsername('x'.repeat(21)));
check('20 字符合法', validateUsername('x'.repeat(20)));
check('含特殊符号不合法', !validateUsername('abc!'));
check('含空格的用户名不合法', !validateUsername('ab c'));
check('空用户名不合法', !validateUsername('   '));

/* ---------- 密码 ---------- */
check('5 位密码不合法', !validatePassword('12345'));
check('6 位密码合法', validatePassword('123456'));
check('空密码不合法', !validatePassword(''));
check('长密码合法', validatePassword('x'.repeat(200)));
check('密码不做 trim（空格有意义）', validatePassword(' 1234 '));

/* ---------- 密码哈希 ---------- */
const salt = makeSalt();
check('salt 长度 16 字节 hex', /^[0-9a-f]{32}$/.test(salt), salt);
check('两次 salt 不相同', makeSalt() !== makeSalt());

const hash = await hashPassword('correct horse', salt);
check('哈希是 64 位 hex', /^[0-9a-f]{64}$/.test(hash), hash);
check('同密码同 salt 哈希一致', (await hashPassword('correct horse', salt)) === hash);
check('不同 salt 哈希不同', (await hashPassword('correct horse', makeSalt())) !== hash);
check('正确密码校验通过', await verifyPassword('correct horse', salt, hash));
check('错误密码校验失败', !(await verifyPassword('wrong horse', salt, hash)));
check('空密码校验失败', !(await verifyPassword('', salt, hash)));
check('salt 被篡改则校验失败', !(await verifyPassword('correct horse', makeSalt(), hash)));

/* ---------- 令牌 ---------- */
const token = generateToken();
check('令牌长度 43（base64url 32 字节）', token.length === 43, token.length);
check('令牌只含 base64url 字符', /^[A-Za-z0-9_-]+$/.test(token), token);
check('两次令牌不相同', generateToken() !== generateToken());
const tokenHash = await hashToken(token);
check('令牌哈希是 64 位 hex', /^[0-9a-f]{64}$/.test(tokenHash), tokenHash);
check('令牌哈希稳定', (await hashToken(token)) === tokenHash);
check('不同令牌哈希不同', tokenHash !== (await hashToken(generateToken())));

/* ---------- 班级码 ---------- */
check('班级码去连字符并大写', normalizeJoinCode('yw48-3ban') === 'YW483BAN');
check('班级码去空格', normalizeJoinCode(' YW48 3BAN ') === 'YW483BAN');
check('展示格式每 4 位一组', formatJoinCode('YW483BAN') === 'YW48-3BAN', formatJoinCode('YW483BAN'));
check('展示格式 8 位', formatJoinCode('ABCD1234') === 'ABCD-1234');
check('展示格式 12 位', formatJoinCode('ABCDEFGH1234') === 'ABCD-EFGH-1234');
check('4 位班级码合法', isValidJoinCode('YW48'));
check('12 位班级码合法', isValidJoinCode('ABCDEFGH1234'));
check('3 位班级码不合法', !isValidJoinCode('YW4'));
check('13 位班级码不合法', !isValidJoinCode('ABCDEFGH12345'));
check('含小写非法', !isValidJoinCode('yw48'));
check('含特殊字符非法', !isValidJoinCode('YW4-8!'));
check('识别有效班级码', detectJoinCode('yw48-3ban') === 'join');
check('空输入不识别', detectJoinCode('') === null);
check('PH- 前缀不再识别为任何码', detectJoinCode('PH-ABCDE-FGHIJ-KLMNO-PQRST') === null);

console.log(`\n结果: ${passed} 通过 / ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
