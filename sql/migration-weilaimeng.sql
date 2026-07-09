-- ============================================================
-- 多站数据隔离迁移 — 未来梦 PDF 预览站 (weilaimeng.cdqzsta.tech)
-- 在 ECS 上执行:
--   docker exec -i postgres psql -U postgres -d bdpan < sql/migration-weilaimeng.sql
-- 或通过 psql 远程执行
-- ============================================================

-- 1. bdpan_action_logs 添加 source 列（默认 'pan' 兼容现有数据）
ALTER TABLE bdpan_action_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pan';

-- 2. bdpan_deny_events 添加 source 列
ALTER TABLE bdpan_deny_events ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pan';

-- 3. 创建索引加速按 source 过滤
CREATE INDEX IF NOT EXISTS idx_action_logs_source ON bdpan_action_logs(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deny_events_source ON bdpan_deny_events(source, created_at DESC);

-- 注: view_logs 已有 page_source 字段，无需迁移
-- 注: bdpan_risk_scores 为两站共享，无需 source 字段

-- 验证
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name IN ('bdpan_action_logs', 'bdpan_deny_events')
  AND column_name = 'source';
