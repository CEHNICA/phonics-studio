-- 48 音标小铺 · 账号体系数据表（D1）
--
-- 账号：username + password（PBKDF2-SHA256，salt 每账号独立）
-- 会话：服务端只存令牌哈希，明文令牌只回给客户端一次
-- 班级：一个班级一行；成员按账号分行，成员之间互不可见
--
-- 旧表 phonics_user_state（上一版同步码机制）保留一个兼容期，
-- 移除条件：该表连续 30 天无写入。

DROP TABLE IF EXISTS phonics_member_state;
DROP TABLE IF EXISTS phonics_members;
DROP TABLE IF EXISTS phonics_sessions;
DROP TABLE IF EXISTS phonics_spaces;
DROP TABLE IF EXISTS phonics_accounts;

CREATE TABLE IF NOT EXISTS phonics_accounts (
  account_id     TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  salt           TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  -- 账号身份：teacher（老师，能建班）/ student（学生，只能用班级码加入）
  role           TEXT NOT NULL DEFAULT 'student',
  created_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON phonics_accounts(username);

CREATE TABLE IF NOT EXISTS phonics_sessions (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON phonics_sessions(account_id);

CREATE TABLE IF NOT EXISTS phonics_spaces (
  space_id         TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'class',
  join_code        TEXT,
  name             TEXT NOT NULL,
  owner_account_id TEXT,
  created_at       TEXT NOT NULL,
  revoked_at       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_join ON phonics_spaces(join_code);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON phonics_spaces(owner_account_id);

CREATE TABLE IF NOT EXISTS phonics_members (
  account_id   TEXT PRIMARY KEY,
  space_id     TEXT NOT NULL,
  role         TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  stats_json   TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_members_space ON phonics_members(space_id);

CREATE TABLE IF NOT EXISTS phonics_member_state (
  account_id  TEXT NOT NULL,
  space_id    TEXT NOT NULL,
  state       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, space_id)
);
