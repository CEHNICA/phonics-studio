/**
 * 身份模型：班级码 / 恢复密钥 / 管理码
 *
 * 相比旧版「同步码即账号」，这里把身份拆成三段：
 * - 班级码（低熵、可读）：老师发给学生的入口码，只能加入班级，看不到别人数据；
 * - 恢复密钥（高熵，个人）：换设备时用它找回自己的进度；
 * - 管理码（高熵，班级所有者）：打开班级看板、踢人、撤销班级。
 *
 * 服务端只保存哈希（带域分隔前缀），明文只在创建/加入时返回一次，由本机 localStorage 保管。
 * 真正的数据隔离靠「成员分行 + 只有 owner 能读聚合」，哈希只防 D1 泄露后被直接看到明文。
 */

export const IDENTITY_STORAGE_KEY = 'phonics-studio-identity-v2';

export const RECOVERY_PREFIX = 'PH-';
export const OWNER_PREFIX = 'OW-';

/** 哈希域分隔前缀：不同用途的同名明文不能互相冒充 */
export const HASH_DOMAIN = {
  owner: 'ph-owner:',
  recovery: 'ph-rec:',
  device: 'ph-dev:',
} as const;

export type SpaceKind = 'class' | 'personal';
export type SpaceRole = 'owner' | 'student';
export type CodeKind = 'join' | 'recovery' | 'owner' | 'invalid';

/** 本机身份：加入某个空间之后的凭据 */
export interface SpaceIdentity {
  /** 空间（班级）ID */
  spaceId: string;
  /** 空间名称，例如「初二(3)班」 */
  spaceName: string;
  /** 空间类型 */
  kind: SpaceKind;
  /** 本人在空间里的角色 */
  role: SpaceRole;
  /** 成员 ID：云端数据的实际主键 */
  memberId: string;
  /** 恢复密钥（明文，只在本机保存） */
  recoveryKey: string;
  /** 管理码（明文，只有空间所有者本机保存） */
  ownerKey?: string;
  /** 班级码（老师拿着发给学生；加入班级的人也知道这一串） */
  joinCode?: string;
  /** 绑定设备密钥的哈希 */
  deviceHash: string;
  /** 加入时间 */
  joinedAt: string;
}

/** 可注入的存储接口：浏览器用 localStorage，测试用内存实现 */
export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Base32 字母表（RFC 4648，20 位 = 100 bit 熵） */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const RECOVERY_PATTERN = /^PH-[A-Z2-7]{5}(?:-[A-Z2-7]{5}){3}$/;
const OWNER_PATTERN = /^OW-[A-Z2-7]{5}(?:-[A-Z2-7]{5}){3}$/;

/** 弱班级码黑名单：太好猜的码直接拒绝 */
const WEAK_JOIN_CODES = new Set([
  '1234',
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '123456',
  '654321',
  '111111',
  '000000',
  '12345678',
  '87654321',
  '112233',
  'ABCDEF',
  'QWERTY',
  'PASSWORD',
  'ADMIN',
]);

/**
 * 浏览器默认存储；无痕模式或存储被禁用时退化为空操作
 */
function browserStorage(): IdentityStorage {
  return {
    getItem: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // 忽略：存储不可用只影响跨设备恢复，不影响学习功能
      }
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // 忽略
      }
    },
  };
}

/**
 * 班级码规范化：去空格 / 去连字符 / 统一大写
 */
export function normalizeJoinCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

/**
 * 班级码可读化：每 4 位一组，加连字符（仅用于展示）
 */
export function formatJoinCode(code: string): string {
  return normalizeJoinCode(code).replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * 判断一段输入是「班级码 / 恢复密钥 / 管理码」
 */
export function detectCodeKind(raw: string): CodeKind {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) {
    return 'invalid';
  }
  if (value.startsWith(RECOVERY_PREFIX)) {
    return 'recovery';
  }
  if (value.startsWith(OWNER_PREFIX)) {
    return 'owner';
  }
  return 'join';
}

/**
 * 班级码是否合法：4–12 位大写字母数字，且不是弱码
 */
export function isValidJoinCode(code: string): boolean {
  const normalized = normalizeJoinCode(code);
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) {
    return false;
  }
  if (WEAK_JOIN_CODES.has(normalized)) {
    return false;
  }
  // 全部是同一个数字（111111、0000）也算弱码
  if (/^(\d)\1+$/.test(normalized)) {
    return false;
  }
  return true;
}

/**
 * 恢复密钥是否合法
 */
export function isValidRecoveryKey(key: string): boolean {
  return RECOVERY_PATTERN.test(String(key ?? '').trim().toUpperCase());
}

/**
 * 管理码是否合法
 */
export function isValidOwnerKey(key: string): boolean {
  return OWNER_PATTERN.test(String(key ?? '').trim().toUpperCase());
}

/**
 * 生成随机 Base32 字符（256 % 32 == 0，无模偏差）
 */
function randomBase32Chars(count: number): string {
  const bytes = new Uint8Array(count);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (const byte of bytes) {
    out += BASE32_ALPHABET[byte % 32];
  }
  return out;
}

/**
 * 生成恢复密钥：PH- + 4 组 5 位 Base32（100 bit 熵）
 */
export function generateRecoveryKey(): string {
  return `${RECOVERY_PREFIX}${randomBase32Chars(20).replace(/(.{5})(?=.)/g, '$1-')}`;
}

/**
 * 生成管理码：OW- + 4 组 5 位 Base32（100 bit 熵）
 */
export function generateOwnerKey(): string {
  return `${OWNER_PREFIX}${randomBase32Chars(20).replace(/(.{5})(?=.)/g, '$1-')}`;
}

/**
 * SHA-256 → 小写十六进制
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 带域分隔的哈希：不同用途的同一串明文得到不同结果
 */
export async function hashSecret(domain: string, secret: string): Promise<string> {
  return sha256Hex(`${domain}${secret}`);
}

/** 管理码哈希 */
export function buildOwnerHash(ownerKey: string): Promise<string> {
  return hashSecret(HASH_DOMAIN.owner, ownerKey);
}

/** 恢复密钥哈希 */
export function buildRecoveryHash(recoveryKey: string): Promise<string> {
  return hashSecret(HASH_DOMAIN.recovery, recoveryKey);
}

/** 设备密钥哈希 */
export function buildDeviceHash(deviceKey: string): Promise<string> {
  return hashSecret(HASH_DOMAIN.device, deviceKey);
}

/**
 * 读取本机身份
 */
export function loadIdentity(storage: IdentityStorage = browserStorage()): SpaceIdentity | null {
  const raw = storage.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SpaceIdentity>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!parsed.spaceId || !parsed.memberId || !parsed.recoveryKey) {
      return null;
    }
    return {
      spaceId: parsed.spaceId,
      spaceName: parsed.spaceName ?? '',
      kind: parsed.kind === 'personal' ? 'personal' : 'class',
      role: parsed.role === 'owner' ? 'owner' : 'student',
      memberId: parsed.memberId,
      recoveryKey: parsed.recoveryKey,
      ownerKey: parsed.ownerKey,
      joinCode: parsed.joinCode,
      deviceHash: parsed.deviceHash ?? '',
      joinedAt: parsed.joinedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * 保存本机身份
 */
export function saveIdentity(
  identity: SpaceIdentity,
  storage: IdentityStorage = browserStorage(),
): void {
  storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

/**
 * 清除本机身份（退回纯本机模式）
 */
export function clearIdentity(storage: IdentityStorage = browserStorage()): void {
  storage.removeItem(IDENTITY_STORAGE_KEY);
}
