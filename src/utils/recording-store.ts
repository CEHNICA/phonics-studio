/**
 * 跟读录音的本地持久化存储（IndexedDB）
 * 为什么用 IndexedDB：localStorage 容量小且只能存字符串，录音 Blob 需要二进制存储；
 * 数据仅保存在当前浏览器本机，切换音标、切换页面、刷新页面甚至关闭浏览器后都不会丢失。
 */

const DB_NAME = 'phonics-studio-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

export interface StoredRecordingTrimInfo {
  leadingTrimmedSec: number;
  trailingTrimmedSec: number;
  hasSpeech: boolean;
}

export interface StoredRecording {
  blob: Blob;
  trimInfo: StoredRecordingTrimInfo;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
  // NOTE: 打开失败时清除缓存的 Promise，允许后续重试
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/**
 * 读取某个音标已保存的跟读录音，没有或出错时返回 null
 */
export async function loadRecording(key: string): Promise<StoredRecording | null> {
  try {
    const db = await openDatabase();
    return await new Promise<StoredRecording | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value = request.result as StoredRecording | undefined;
        resolve(value && value.blob instanceof Blob ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * 保存（覆盖）某个音标的跟读录音，失败时静默忽略（不影响本次内存中的回放）
 */
export async function saveRecording(
  key: string,
  blob: Blob,
  trimInfo: StoredRecordingTrimInfo,
): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const record: StoredRecording = { blob, trimInfo, savedAt: Date.now() };
      tx.objectStore(STORE_NAME).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // 隐私模式或存储空间不足时无法持久化，忽略即可
  }
}

/**
 * 删除某个音标已保存的跟读录音
 */
export async function deleteRecording(key: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // 忽略删除失败
  }
}

/**
 * 清空全部跟读录音（用于“重置学习记录”）
 */
export async function clearAllRecordings(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // 忽略清空失败
  }
}
