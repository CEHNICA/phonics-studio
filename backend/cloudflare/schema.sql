-- Cloudflare D1 数据表（执行：npx wrangler d1 execute phonics-studio --file=./schema.sql）
--
-- 旧表（deprecated，兼容期保留）：
--   phonics_user_state 是「同步码即账号」时代的老结构，主键就是同步码本身。
--   兼容期内 /api/state 仍兼容这条老路径，新前端一律走成员通道。
--   移除条件：旧表连续 30 天无写入。
CREATE TABLE IF NOT EXISTS phonics_user_state (
  user_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- 空间：班级或个人空间
CREATE TABLE IF NOT EXISTS phonics_spaces (
  space_id   TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'class',
  join_code  TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  owner_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_join ON phonics_spaces(join_code);

-- 成员：一个成员 = 一个学生（或班级所有者）
CREATE TABLE IF NOT EXISTS phonics_members (
  member_id     TEXT PRIMARY KEY,
  space_id      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'student',
  recovery_hash TEXT NOT NULL,
  device_hash   TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  stats_json    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_space ON phonics_members(space_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_recovery ON phonics_members(recovery_hash);

-- 成员状态：一成员一行（与旧表结构一致）
CREATE TABLE IF NOT EXISTS phonics_member_state (
  member_id  TEXT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
