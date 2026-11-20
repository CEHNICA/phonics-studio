-- Cloudflare D1 数据表（执行：npx wrangler d1 execute phonics-studio --file=./schema.sql）
CREATE TABLE IF NOT EXISTS phonics_user_state (
  user_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
