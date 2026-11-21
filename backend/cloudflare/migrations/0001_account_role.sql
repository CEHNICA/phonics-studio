-- 账号身份：teacher（老师，能建班）/ student（学生，只能用班级码加入）
--
-- 上线步骤（远端库）：
--   npx wrangler d1 execute phonics-studio --remote --file=./backend/cloudflare/migrations/0001_account_role.sql
--
-- 说明：
-- 1. 老账号默认 student（跟迁移前的行为一致：谁都能建班的行为到此为止）；
-- 2. 已经在班级里当 owner 的账号自动升成 teacher，别让现有老师突然失去建班权限。

ALTER TABLE phonics_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'student';

UPDATE phonics_accounts
   SET role = 'teacher'
 WHERE account_id IN (
   SELECT account_id FROM phonics_members WHERE role = 'owner'
 );
