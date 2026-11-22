-- 练声助手线上后端 D1 建表脚本
-- 执行：npx wrangler d1 execute liansheng-db --remote --file=./schema.sql

-- 用户表：全部账号信息统一存这里；前端只保存 Token 与基础缓存。
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,            -- uuid
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone      TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,               -- PBKDF2-SHA256，格式 "salt.hex:hash.hex"
  avatar     TEXT,                        -- dataURL（前端已压缩），可空
  role       TEXT NOT NULL DEFAULT 'user',-- 'admin' | 'user'；第一个注册的用户自动成为 admin
  created_at INTEGER NOT NULL             -- Date.now()
);

-- 用户空间表：练习内容 JSON（level1 + level2）。user_id='__admin__' 的行是默认模板空间。
CREATE TABLE IF NOT EXISTS user_spaces (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,               -- JSON 字符串：{"level1":[...],"level2":[...]}
  updated_at INTEGER NOT NULL
);

-- 用户文件表：上传的音频/图片二进制。id 为不可猜测 uuid，公开可读（直链），写删需鉴权。
CREATE TABLE IF NOT EXISTS user_files (
  id         TEXT PRIMARY KEY,            -- uuid，前端 level2.files[].cloud_id 引用
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,            -- 字节，用于 120MB 容量统计
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id);

-- 管理员的默认模板空间行（user_id='__admin__'）由 Worker 首次请求时自动播种，
-- 或在管理员首次保存维护内容时写入；无需手动 INSERT。
