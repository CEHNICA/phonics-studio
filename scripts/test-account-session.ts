/**
 * 尺子：会话持久化（account-session.ts）
 *
 * 跑法：node scripts/test-account-session.ts
 */

import {
  createSessionStore,
  parseSession,
  serializeSession,
  type AccountSession,
  type SessionStorage,
} from '../src/services/backend/account-session.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}  ${detail}`);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

/** 假存储：记录写入、模拟 quota 报错 */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: SessionStorage & { map: Map<string, string>; failWrite: boolean } = {
    map,
    failWrite: false,
    getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key, value) {
      if (storage.failWrite) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
  return storage;
}

const SAMPLE: AccountSession = {
  token: 'tok_abc123',
  account: { username: 'xiaoming', displayName: '小明' },
  membership: {
    spaceId: 'sp_1',
    spaceName: '三年级二班',
    role: 'student',
    joinCode: null,
    memberName: '小明',
    revoked: false,
    spaceRevoked: false,
  },
  savedAt: '2026-11-21T00:00:00.000Z',
};

console.log('\n=== 解析 ===');
check('空字符串 → null', parseSession(null) === null);
check('非法 JSON → null', parseSession('{oops') === null);
check('空对象 → null', parseSession('{}') === null);
check('缺 token → null', parseSession('{"account":{"username":"a"}}') === null);
check('空 token → null', parseSession('{"token":"   ","account":{"username":"a"}}') === null);
check('缺 account → null', parseSession('{"token":"t"}') === null);

const parsed = parseSession(serializeSession(SAMPLE));
check('往返后 token 一致', parsed?.token === SAMPLE.token);
check('往返后账号一致', parsed?.account.username === 'xiaoming');
check('往返后班级状态一致', parsed?.membership?.spaceId === 'sp_1');
check('往返后角色一致', parsed?.membership?.role === 'student');
check('往返后班级码保留为 null', parsed?.membership?.joinCode === null);

console.log('\n=== 兼容与收敛 ===');
const legacy = parseSession(
  JSON.stringify({ token: 't2', account: { username: 'laoshi' }, savedAt: 'x' }),
);
check('没有 membership → null', legacy?.membership === null);
check('没有 displayName 时用用户名兜底', legacy?.account.displayName === 'laoshi');
const weird = parseSession(
  JSON.stringify({
    token: 't3',
    account: { username: 'u', displayName: '   ' },
    membership: { spaceId: 'sp_9', role: 'weird', joinCode: 123 },
  }),
);
check('未知角色收敛为 student', weird?.membership?.role === 'student');
check('非字符串班级码收敛为 null', weird?.membership?.joinCode === null);
check('缺 spaceName 时兜底', weird?.membership?.spaceName === '未命名班级');

console.log('\n=== 存储 ===');
const store = createSessionStore(fakeStorage());
check('空存储读出 null', store.load() === null);
store.save(SAMPLE);
check('保存后能读回', store.load()?.token === 'tok_abc123');
check('保存写进同一个 key', store.load()?.account.displayName === '小明');
store.clear();
check('清除后读出 null', store.load() === null);

const broken = createSessionStore(fakeStorage({ 'phonics-studio-account-session-v1': 'not-json' }));
check('存储里的坏数据 → null', broken.load() === null);

const failingStorage = fakeStorage();
const failing = createSessionStore(failingStorage);
failingStorage.failWrite = true;
check('写入失败不抛错', (() => {
  try {
    failing.save(SAMPLE);
    return true;
  } catch {
    return false;
  }
})());
check('写入失败后读出仍是 null', failing.load() === null);

const noStorage = createSessionStore(null);
check('没有存储时读出 null', noStorage.load() === null);
check('没有存储时保存不抛错', (() => {
  try {
    noStorage.save(SAMPLE);
    noStorage.clear();
    return true;
  } catch {
    return false;
  }
})());

console.log(`\n通过 ${passed} / 失败 ${failed}`);
if (failed > 0) {
  console.log('\n失败明细：');
  for (const item of failures) {
    console.log(`  - ${item}`);
  }
  process.exit(1);
}
