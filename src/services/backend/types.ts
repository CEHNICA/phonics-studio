/**
 * 后端数据契约
 *
 * 设计要点：前端只认这一层契约，具体后端（Cloudflare Worker / Supabase / 纯本地）
 * 由 src/services/backend/index.ts 依据环境变量选择，UI 层不绑定任何一家。
 *
 * 身份模型（两段式 + 管理码）：
 * - 班级码：低熵入口码，老师发给学生，学生加入班级空间后各人数据互相隔离；
 * - 恢复密钥：高熵个人密钥，换设备时用它找回自己的进度；
 * - 管理码：高熵班级所有者密钥，用于打开班级看板、踢人、撤销班级。
 * 密钥只随请求头 / 请求体传递，服务端只保存哈希，不做业务解释之外的处理。
 */

import type { UserProgressState } from '../../types/phonics';
import type { SpaceKind, SpaceRole } from './space-client';

export type { SpaceKind, SpaceRole };

/** 当前数据契约版本，服务端与前端不一致时用于提示 */
export const STATE_VERSION = 1;

/** 单份用户状态快照 */
export interface UserStatePayload {
  /** 契约版本 */
  version: number;
  /** 用户密钥（成员通道下即 memberId） */
  userKey: string;
  /** 完整学习状态 */
  state: UserProgressState;
  /** 客户端最后修改时间（ISO 字符串） */
  updatedAt: string;
}

/** 后端可用状态 */
export type BackendState = 'local' | 'connecting' | 'synced' | 'offline' | 'error';

/** 看板里的一名成员 */
export interface ClassMemberSummary {
  memberId: string;
  name: string;
  role: SpaceRole;
  /** 已完成音标数 */
  completed: number;
  /** 学过的音标数 */
  learned: number;
  /** 打卡天数 */
  checkedDays: number;
  /** 累计答题数 */
  totalAnswered: number;
  /** 累计答对数 */
  totalCorrect: number;
  /** 正确率（0–100） */
  accuracy: number;
  /** 最近活跃时间 */
  lastSeenAt: string | null;
  /** 加入时间 */
  createdAt: string;
  /** 是否已被移出班级 */
  revoked: boolean;
}

/** 班级看板数据 */
export interface ClassOverview {
  space: {
    id: string;
    name: string;
    createdAt: string;
  };
  members: ClassMemberSummary[];
}

/** 创建空间的入参 */
export interface SpaceCreateInput {
  kind: SpaceKind;
  name: string;
  /** 班级码；留空由服务端生成 */
  joinCode?: string;
  /** 绑定本机设备的哈希 */
  deviceHash: string;
}

/** 创建空间的结果（管理码 / 恢复密钥只在这一次明文返回） */
export interface SpaceCreateResult {
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  joinCode: string;
  ownerKey: string;
  memberId: string;
  recoveryKey: string;
  role: SpaceRole;
}

/** 加入班级的入参 */
export interface SpaceJoinInput {
  joinCode: string;
  deviceHash: string;
  name?: string;
}

/** 加入班级的结果（恢复密钥只在这一次明文返回） */
export interface SpaceJoinResult {
  memberId: string;
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  recoveryKey: string;
  role: SpaceRole;
}

/** 恢复身份的入参 */
export interface MemberRecoverInput {
  recoveryKey: string;
  deviceHash: string;
}

/** 恢复身份的结果 */
export interface MemberRecoverResult {
  memberId: string;
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  role: SpaceRole;
  /** 云端已有的本人进度 */
  state: UserProgressState | null;
}

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

  /** 创建班级 / 个人空间；未实现时前端隐藏对应入口 */
  createSpace?(input: SpaceCreateInput): Promise<SpaceCreateResult>;
  /** 用班级码加入班级 */
  joinSpace?(input: SpaceJoinInput): Promise<SpaceJoinResult>;
  /** 用恢复密钥找回本人身份 */
  recoverMember?(input: MemberRecoverInput): Promise<MemberRecoverResult>;
  /** 用管理码查看班级看板 */
  classOverview?(ownerKey: string): Promise<ClassOverview>;
  /** 用管理码移出某个成员 */
  revokeMember?(ownerKey: string, memberId: string): Promise<void>;
  /** 用管理码撤销整个班级 */
  revokeSpace?(ownerKey: string): Promise<void>;
}
