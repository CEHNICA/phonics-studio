/**
 * 后端数据契约（账号体系）
 *
 * 身份模型：用户名 + 密码 + 班级码，三样东西，没有第四样。
 * - 账号：用户名 + 密码注册登录，密码用 PBKDF2-SHA256 加盐哈希，服务端只存哈希；
 * - 会话：登录后拿到一个令牌（32 字节 base64url），后续请求带在 x-phonics-token 头上，
 *   服务端只存令牌的 SHA-256 哈希；
 * - 班级码：老师建班后拿到，8 位大写字母数字，学生输入即可加入班级；
 *   成员之间的数据互相隔离，只有建班的老师能看全班看板。
 *
 * 旧的「恢复密钥 / 管理码 / 设备密钥」已全部废弃，这里不再有对应概念。
 */

import type { UserProgressState } from '../../types/phonics';

/** 当前数据契约版本，服务端与前端不一致时用于提示 */
export const STATE_VERSION = 2;

/** 班级里的身份 */
export type AccountRole = 'owner' | 'student';

/**
 * 账号身份（账号级权限，跟班级里的 owner/student 不是一回事）：
 * - teacher：老师，可以创建班级、查看班级看板；
 * - student：学生，只能用班级码加入班级。
 */
export type AccountKind = 'teacher' | 'student';

/** 账号信息 */
export interface AccountInfo {
  username: string;
  displayName: string;
  /** 账号身份；老会话没有这字段时按 student 处理 */
  role: AccountKind;
}

/** 账号在班级里的状态（不在班级时为 null） */
export interface Membership {
  spaceId: string;
  spaceName: string;
  role: AccountRole;
  /** 班级码：只有老师（owner）能看到 */
  joinCode: string | null;
  /** 在班级里显示的名字 */
  memberName: string;
  /** 自己已被移出班级 */
  revoked: boolean;
  /** 整个班级已被撤销 */
  spaceRevoked: boolean;
}

/** 登录 / 注册成功后的返回 */
export interface AuthResult {
  token: string;
  account: AccountInfo;
  membership: Membership | null;
}

/** 单份用户状态快照 */
export interface UserStatePayload {
  version: number;
  /** 账号标识，用于本地缓存分区 */
  accountId: string;
  state: UserProgressState;
  updatedAt: string;
}

/** 后端可用状态 */
export type BackendState = 'local' | 'connecting' | 'synced' | 'offline' | 'error';

/** 看板里的一名成员 */
export interface ClassMemberSummary {
  accountId: string;
  /** 登录用户名 */
  username?: string;
  /** 成员显示名 */
  name: string;
  role: AccountRole;
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
    /** 班级码（只有 owner 拿得到） */
    joinCode: string | null;
    createdAt: string;
  };
  members: ClassMemberSummary[];
}

/** 注册入参 */
export interface RegisterInput {
  username: string;
  password: string;
  displayName?: string;
  /** 注册时选的身份；选 teacher 必须同时给 teacherCode */
  role?: AccountKind;
  /** 教师邀请码（选 teacher 时必填，服务端校验） */
  teacherCode?: string;
}

/** 登录入参 */
export interface LoginInput {
  username: string;
  password: string;
}

/** 建班结果 */
export interface ClassCreateResult {
  spaceId: string;
  name: string;
  joinCode: string;
}

/** 加入班级结果 */
export interface ClassJoinResult {
  spaceId: string;
  spaceName: string;
  role: AccountRole;
}

/** 退出班级结果 */
export interface ClassLeaveResult {
  revokedClass: boolean;
}

export interface BackendProvider {
  /** provider 标识 */
  readonly id: 'local' | 'worker';
  /** 展示用名称 */
  readonly label: string;
  /** 是否具备远端配置（未配置时前端自动降级为纯本地） */
  isConfigured(): boolean;

  /* ---- 账号 ---- */
  /** 注册并直接登录 */
  register(input: RegisterInput): Promise<AuthResult>;
  /** 登录 */
  login(input: LoginInput): Promise<AuthResult>;
  /** 登出（服务端删掉这枚会话令牌） */
  logout(token: string): Promise<void>;
  /** 读取当前账号信息与班级状态 */
  me(token: string): Promise<{ account: AccountInfo; membership: Membership | null }>;
  /** 自己改密码 */
  changePassword(token: string, oldPassword: string, newPassword: string): Promise<void>;

  /* ---- 进度 ---- */
  /** 拉取远端状态，没有数据时返回 null */
  load(token: string): Promise<UserStatePayload | null>;
  /** 覆盖写入远端状态 */
  save(token: string, payload: UserStatePayload): Promise<void>;
  /** 连通性探测 */
  ping(): Promise<boolean>;

  /* ---- 班级 ---- */
  /** 创建班级，拿到班级码 */
  createClass(token: string, name: string): Promise<ClassCreateResult>;
  /** 用班级码加入班级 */
  joinClass(token: string, joinCode: string): Promise<ClassJoinResult>;
  /** 查看自己班级的看板（仅老师） */
  classOverview(token: string): Promise<ClassOverview>;
  /** 移出某个成员（仅老师） */
  removeMember(token: string, accountId: string): Promise<void>;
  /** 重置某个成员的密码，返回临时密码（仅老师） */
  resetMemberPassword(token: string, accountId: string): Promise<string>;
  /** 撤销整个班级（仅老师） */
  revokeClass(token: string): Promise<void>;
  /** 退出当前班级（学生：只退自己；老师：等于撤销班级） */
  leaveClass(token: string): Promise<ClassLeaveResult>;
}
