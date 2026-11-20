/**
 * 用户密钥与同步码
 *
 * - 设备密钥：浏览器首次运行时生成的随机串，仅用于本机身份；
 * - 同步码：用户手动设置的一串口令，设置后即作为云端身份（同一串口令跨设备共享同一份数据）。
 * 两者都只以不透明字符串形式随请求头发送，服务端不解析其含义。
 */

const DEVICE_KEY_STORAGE = 'phonics-studio-user-key-v1';
const SYNC_CODE_STORAGE = 'phonics-studio-sync-code-v1';

/** 同步码最小长度，避免使用过于容易猜到的弱口令 */
export const MIN_SYNC_CODE_LENGTH = 8;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无痕模式或存储被禁用时忽略，不影响学习功能
  }
}

/**
 * 生成一枚随机设备密钥（32 位十六进制）
 */
export function generateUserKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 读取本机设备密钥，不存在则生成并保存
 */
export function getOrCreateDeviceKey(): string {
  const existing = readStorage(DEVICE_KEY_STORAGE);
  if (existing && existing.length >= 16) {
    return existing;
  }
  const created = generateUserKey();
  writeStorage(DEVICE_KEY_STORAGE, created);
  return created;
}

/**
 * 读取用户设置的同步码
 */
export function getSyncCode(): string | null {
  const value = readStorage(SYNC_CODE_STORAGE);
  return value && value.length > 0 ? value : null;
}

/**
 * 校验同步码格式
 */
export function isValidSyncCode(code: string): boolean {
  return code.trim().length >= MIN_SYNC_CODE_LENGTH;
}

/**
 * 保存同步码；传空串表示清除（回到仅本机身份）
 */
export function setSyncCode(code: string): void {
  const trimmed = code.trim();
  if (!trimmed) {
    try {
      localStorage.removeItem(SYNC_CODE_STORAGE);
    } catch {
      // 忽略
    }
    return;
  }
  writeStorage(SYNC_CODE_STORAGE, trimmed);
}

/**
 * 当前生效的用户密钥：有同步码用同步码，否则用设备密钥
 */
export function currentUserKey(): string {
  return getSyncCode() ?? getOrCreateDeviceKey();
}
