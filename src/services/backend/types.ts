/**
 * 后端数据契约
 *
 * 设计要点：前端只认这一层契约，具体后端（Cloudflare Worker / Supabase / 纯本地）
 * 由 src/services/backend/index.ts 依据环境变量选择，UI 层不绑定任何一家。
 *
 * 身份模型：不引入第三方账号体系，使用「用户密钥（userKey）」作为唯一身份。
 * - 未设置同步码时：浏览器本地生成一枚随机密钥，仅本机使用；
 * - 用户填写同步码后：同步码即密钥，同一串同步码在不同设备上指向同一份云端数据。
 * 密钥只随请求头传递，服务端当作不透明字符串使用，不做业务解释。
 */

import type { UserProgressState } from '../../types/phonics';

/** 当前数据契约版本，服务端与前端不一致时用于提示 */
export const STATE_VERSION = 1;

/** 单份用户状态快照 */
export interface UserStatePayload {
  /** 契约版本 */
  version: number;
  /** 用户密钥（与服务端主键一致） */
  userKey: string;
  /** 完整学习状态 */
  state: UserProgressState;
  /** 客户端最后修改时间（ISO 字符串） */
  updatedAt: string;
}

/** 后端可用状态 */
export type BackendState = 'local' | 'connecting' | 'synced' | 'offline' | 'error';

export interface BackendProvider {
  /** provider 标识 */
  readonly id: 'local' | 'worker' | 'supabase';
  /** 展示用名称 */
  readonly label: string;
  /** 是否具备远端配置（未配置时前端自动降级为纯本地） */
  isConfigured(): boolean;
  /** 拉取远端状态，没有数据时返回 null */
  load(): Promise<UserStatePayload | null>;
  /** 覆盖写入远端状态 */
  save(payload: UserStatePayload): Promise<void>;
  /** 连通性探测 */
  ping(): Promise<boolean>;
}
