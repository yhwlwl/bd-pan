-- 风控系统 v2 迁移：补齐来源字段和关联查询索引。
-- 共享数据库只需执行一次；重复执行安全。

ALTER TABLE bdpan_deny_events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pan';

CREATE INDEX IF NOT EXISTS idx_deny_events_username
  ON bdpan_deny_events(username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deny_events_ip_path_reason
  ON bdpan_deny_events(ip, request_path, deny_reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deny_events_ip_reason
  ON bdpan_deny_events(ip, deny_reason, created_at DESC);

-- 普通成功操作也参与 IP/设备/账号关联查询，补齐三类索引。
CREATE INDEX IF NOT EXISTS idx_action_logs_username ON bdpan_action_logs(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_logs_ip ON bdpan_action_logs(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_logs_device_code ON bdpan_action_logs(device_code, created_at DESC);
