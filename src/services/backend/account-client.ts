/**
 * 账号体系纯函数：用户名、密码哈希、令牌、班级码
 *
 * 这份文件里的算法必须和后端 `backend/cloudflare/pages/functions/api/[[path]].ts`
 * 里的实现保持一致（后端那边是独立副本，避免打包路径问题）。
 * 改动任何一处，另一处要同步改，并用 `scripts/test-account-auth.ts` + 接口测试一起验。
 */

const PBKDF2_ITERATIONS = 20000;
const PBKDF2_BITS = 256;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

// 大小写都允许（存储时会统一转小写），但不含任何空白
const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fa5]+$/;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- 用户名 ---------- */

/** 去空白 + 转小写，作为存储和比较用的规范形式 */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toLowerCase();
}

/** 2–20 个字符，字母 / 数字 / 下划线 / 中文 */
export function validateUsername(username: string): boolean {
  if (!username) {
    return false;
  }
  const length = Array.from(username).length;
  if (length < 2 || length > 20) {
    return false;
  }
  return USERNAME_PATTERN.test(username);
}

/* ---------- 密码 ---------- */

/** 至少 6 位，不做 trim：空格是有意义的字符 */
export function validatePassword(password: string): boolean {
  return password.length >= 6 && password.length <= 200;
}

/* ---------- 密码哈希（PBKDF2-SHA256） ---------- */

export function makeSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(salt) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    PBKDF2_BITS,
  );
  return toHex(bits);
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expectedHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

/* ---------- 令牌 ---------- */

/** 32 字节随机，base64url（43 字符） */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes.buffer);
}

/** 服务端只存令牌哈希 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
}

/* ---------- 班级码 ---------- */

/** 去所有非字母数字字符并转大写 */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** 展示格式：每 4 位一组 */
export function formatJoinCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** 传入的必须是已规范化的班级码（大写字母数字，4–12 位） */
export function isValidJoinCode(code: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

/** 从用户原始输入判断是不是班级码 */
export function detectJoinCode(raw: string): 'join' | null {
  const code = normalizeJoinCode(raw);
  return isValidJoinCode(code) ? 'join' : null;
}
