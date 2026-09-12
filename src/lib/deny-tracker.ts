/**
 * Deny 事件追踪 + 风险评分 + 自动封禁 核心引擎
 *
 * 所有公开函数入口首先检查 settings.denyTracking.enabled，若 false 则静默返回。
 * 此文件 import users.ts，但 users.ts 不 import 此文件 —— 避免循环依赖。
 */
import { pgInsert, pgFetch } from './pg-adapter';
import { getSettings, updateSettings } from './users';
import { normalizeDeviceCode } from './fingerprint';
import { isIP } from 'node:net';

// ============================================================
// 默认配置常量（可被 bdpan_settings.denyTracking 覆盖）
// ============================================================

const DEFAULT_SCORE_MAP: Record<string, number> = {
  nginx_db_token: 30,
  nginx_sensitive_file: 20,
  nginx_pdf_referer: 10,
  nginx_well_known: 15,
  nginx_unknown: 10,
  // 已封禁请求只做审计，不再进入评分，避免“封禁 → 再加分 → 永不恢复”的反馈回路。
  api_ip_banned: 0,
  api_entity_banned: 0,
  api_auth_failed: 5,
  api_login_failed: 8,
  api_role_denied: 10,
  api_permission_denied: 5,
  api_file_rule_denied: 5,
  api_all_items_denied: 5,
  api_pdf_download_denied: 8,
  // Security-control probes: record them and apply a moderate score so a
  // single stale client is not banned, while repeated probing is actionable.
  api_alist_token_denied: 20,
  api_path_scope_denied: 20,
  // A PDF metadata response may be normal preview traffic; this is audit-only.
  api_pdf_link_redacted: 0,
};

const DEFAULT_WARN_THRESHOLD = 30;
const DEFAULT_DEVICE_BAN_THRESHOLD = 50;
const DEFAULT_IP_BAN_THRESHOLD = 70;
const DEFAULT_BAN_HOURS = 24;
const DEFAULT_DECAY_WINDOW_HOURS = 24;
const DEFAULT_DEDUP_WINDOW_MINUTES = 5;
const DEFAULT_DEVICE_POST_BAN_SCORE = 40;
const DEFAULT_IP_POST_BAN_SCORE = 60;
const DEFAULT_FIRST_BAN_MINUTES = 10;
const DEFAULT_SECOND_BAN_HOURS = 1;
const DEFAULT_THIRD_BAN_HOURS = 24;
const DEFAULT_BAN_ESCALATION_THRESHOLD = 15;

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

// ============================================================
// 类型
// ============================================================

export interface DenyEventInput {
  denySource: 'nginx' | 'api' | 'frontend';
  denyReason: string;
  ip: string;
  deviceCode?: string;
  userAgent?: string;
  requestPath?: string;
  username?: string;
  sessionId?: string;
  geoCountry?: string;
  geoCity?: string;
  geoRegion?: string;
  acceptLanguage?: string;
  source?: string;
  /** false = 只记录事件，不改变任何风险分数（例如已封禁请求）。 */
  score?: boolean;
}

export interface DenyResult {
  recorded: boolean;
  ipScore: number;
  dcScore: number;
  accountScore?: number;
  warning: string | null;
}

export type RiskEntityType = 'ip' | 'device_code' | 'account';

export interface RiskScoreRow {
  id?: number;
  current_score: number;
  total_events: number;
  last_offense_at: string | null;
  last_offense_reason: string | null;
  is_banned: boolean;
  ban_expiry: string | null;
  banned_at: string | null;
  ban_reason: string | null;
}

export interface RequestContext {
  ip: string;
  deviceCode?: string;
  path: string;
  ua: string;
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 只接受 Nginx 覆盖写入的 X-WLM-Client-IP。
 *
 * X-Real-IP / X-Forwarded-For 都可能由直接访问者自行构造，因此生产环境
 * 不再把它们当作身份依据。开发环境仍允许旧头，方便本地调试；ECS 必须
 * 配合 config.txt 中的 proxy_set_header X-WLM-Client-IP 使用。
 */
function normalizeIp(raw: string | null | undefined): string {
  let value = (raw || '').trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  // IP 由 Nginx 的可信头注入。这里仍然做严格格式校验，避免任意文本进入
  // 风险键、日志和 PostgREST 查询。
  if (!value || value.length > 128 || /[\r\n]/.test(value) || isIP(value) === 0) return 'unknown';
  return value;
}

function normalizeAccount(raw: string | undefined | null): string | null {
  const value = (raw || '').trim();
  if (!value || value === 'guest' || value === '游客' || value === 'admin') return null;
  if (value.length > 128 || /[\r\n]/.test(value)) return null;
  return value;
}

function normalizePath(raw: string | undefined | null): string {
  return String(raw || '').replace(/[\r\n]/g, '').slice(0, 1000);
}

/** 规范化管理员操作和关联查询使用的实体值，避免写入无法被请求检查命中的脏记录。 */
function normalizeRiskEntityValue(entityType: RiskEntityType, rawValue: unknown): string | null {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;
  if (entityType === 'ip') {
    const ip = normalizeIp(value);
    return ip === 'unknown' ? null : ip;
  }
  if (entityType === 'device_code') {
    // device_code 实体保存的是 hashDeviceCode 的 16 位 hex 结果，不接受原始设备码。
    return /^[0-9a-f]{16}$/i.test(value) ? value.toLowerCase() : null;
  }
  return normalizeAccount(value);
}

/** 从 Request 对象统一提取上下文字段 */
export function getRequestContext(request: Request): RequestContext {
  const trustedIp = request.headers.get('x-wlm-client-ip');
  const legacyIp = process.env.NODE_ENV !== 'production'
    ? request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',').map((item) => item.trim()).filter(Boolean).pop()
    : null;
  const ip = normalizeIp(trustedIp || legacyIp);
  const device = normalizeDeviceCode(request.headers.get('x-device-code'));

  return {
    ip,
    deviceCode: device?.deviceCode,
    path: new URL(request.url).pathname,
    ua: request.headers.get('user-agent') || '',
  };
}

/**
 * 风险实体使用数据库唯一索引做原子 upsert，避免并发请求互相覆盖分数。
 * 如果旧版 PostgREST 不支持 on_conflict，则降级到按 id 更新。
 */
async function upsertRiskScore(data: Record<string, unknown>): Promise<void> {
  try {
    const ECS_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const PG_TOKEN = process.env.PG_DB_TOKEN || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (PG_TOKEN) headers['X-DB-Token'] = PG_TOKEN;

    const entityType = data.entity_type as string;
    const entityValue = data.entity_value as string;
    if (!entityType || !entityValue) {
      console.warn('[deny-tracker] upsert missing entity_type/entity_value');
      return;
    }

    const postHeaders = { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' };
    const postUrl = `${ECS_URL}/bdpan_risk_scores?on_conflict=entity_type%2Centity_value`;
    const postRes = await fetch(postUrl, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(data),
    });
    if (postRes.ok || postRes.status === 204) return;

    // 兼容未开放 upsert 的旧 PostgREST 配置。
    const getUrl = `${ECS_URL}/bdpan_risk_scores?select=id&entity_type=eq.${encodeURIComponent(entityType)}&entity_value=eq.${encodeURIComponent(entityValue)}&limit=1`;
    const getRes = await fetch(getUrl, { headers });
    const existing = await getRes.json().catch(() => []);
    if (getRes.ok && Array.isArray(existing) && existing.length > 0 && existing[0].id) {
      const patchRes = await fetch(`${ECS_URL}/bdpan_risk_scores?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!patchRes.ok && patchRes.status !== 204) {
        console.warn(`[deny-tracker] risk PATCH failed: HTTP ${patchRes.status}`);
      }
      return;
    }
    console.warn(`[deny-tracker] risk upsert failed: HTTP ${postRes.status}`);
  } catch (e: any) {
    console.warn(`[deny-tracker] risk upsert error: ${e.message}`);
  }
}

/** 计算衰减后的分数；衰减会在每次读取/新事件时生效，不需要定时任务。 */
export function decayScore(previousScore: number, hoursSinceLast: number, decayWindowHours: number): number {
  const score = Number.isFinite(previousScore) ? Math.max(0, previousScore) : 0;
  const hours = Number.isFinite(hoursSinceLast) ? Math.max(0, hoursSinceLast) : decayWindowHours;
  const window = Number.isFinite(decayWindowHours) && decayWindowHours > 0 ? decayWindowHours : 24;
  if (hours >= window) return 0;
  return Math.max(0, score * (1 - hours / window));
}

export function calculateDecayedScore(
  currentScore: number,
  lastOffenseAt: string | null | undefined,
  decayWindowHours: number,
  now = Date.now(),
): number {
  if (!lastOffenseAt) return Math.max(0, Number(currentScore) || 0);
  const timestamp = new Date(lastOffenseAt).getTime();
  if (!Number.isFinite(timestamp)) return Math.max(0, Number(currentScore) || 0);
  return decayScore((Number(currentScore) || 0), (now - timestamp) / 3600000, decayWindowHours);
}

function isActiveBan(row: RiskScoreRow | null | undefined, now = Date.now()): boolean {
  if (!row?.is_banned) return false;
  if (!row.ban_expiry) return true;
  const expiry = new Date(row.ban_expiry).getTime();
  return Number.isFinite(expiry) && expiry > now;
}

export interface DenyFullConfig {
  enabled: boolean; warn: number; deviceBan: number; ipBan: number; banHours: number;
  accountBan: number; cascadeBans: boolean; cascadeMaxEntities: number;
  scoreMap: Record<string, number>; decayWindowHours: number; dedupWindowMinutes: number;
  devicePostBanScore: number; ipPostBanScore: number;
  firstBanMinutes: number; secondBanHours: number; thirdBanHours: number; banEscalationThreshold: number;
}

/** 阶梯式封禁时长：从配置读取 */
function getBanDuration(riskRow: Pick<RiskScoreRow, 'banned_at' | 'total_events'> | null | undefined, cfg: DenyFullConfig): number {
  if (!riskRow || !riskRow.banned_at) return cfg.firstBanMinutes / 60;
  if (riskRow.total_events < cfg.banEscalationThreshold) return cfg.secondBanHours;
  return cfg.thirdBanHours;
}

/** 读取 deny 完整配置（优先级：数据库 > 默认值） */
async function getDenyConfig(): Promise<DenyFullConfig> {
  try {
    const settings = await getSettings();
    const dt = settings.denyTracking || {};
    const scoreMap: Record<string, number> = {};
    for (const [reason, fallback] of Object.entries(DEFAULT_SCORE_MAP)) {
      scoreMap[reason] = boundedNumber(dt.scoreMap?.[reason], fallback, 0, 100);
    }
    // 兼容旧配置，但强制关闭旧的反馈回路。
    scoreMap.api_ip_banned = 0;
    scoreMap.api_entity_banned = 0;
    return {
      enabled: dt.enabled !== false,
      warn: boundedNumber(dt.warnThreshold, DEFAULT_WARN_THRESHOLD, 1, 1000),
      deviceBan: boundedNumber(dt.deviceBanThreshold, DEFAULT_DEVICE_BAN_THRESHOLD, 1, 1000),
      ipBan: boundedNumber(dt.ipBanThreshold, DEFAULT_IP_BAN_THRESHOLD, 1, 1000),
      accountBan: boundedNumber(dt.accountBanThreshold ?? dt.ipBanThreshold, DEFAULT_IP_BAN_THRESHOLD, 1, 1000),
      cascadeBans: dt.cascadeBans !== false,
      cascadeMaxEntities: Math.trunc(boundedNumber(dt.cascadeMaxEntities, 100, 10, 500)),
      banHours: boundedNumber(dt.banDurationHours, DEFAULT_BAN_HOURS, 1, 8760),
      scoreMap,
      decayWindowHours: boundedNumber(dt.decayWindowHours, DEFAULT_DECAY_WINDOW_HOURS, 1, 720),
      dedupWindowMinutes: boundedNumber(dt.dedupWindowMinutes, DEFAULT_DEDUP_WINDOW_MINUTES, 1, 1440),
      devicePostBanScore: boundedNumber(dt.devicePostBanScore, DEFAULT_DEVICE_POST_BAN_SCORE, 0, 1000),
      ipPostBanScore: boundedNumber(dt.ipPostBanScore, DEFAULT_IP_POST_BAN_SCORE, 0, 1000),
      firstBanMinutes: boundedNumber(dt.firstBanMinutes, DEFAULT_FIRST_BAN_MINUTES, 1, 1440),
      secondBanHours: boundedNumber(dt.secondBanHours, DEFAULT_SECOND_BAN_HOURS, 1, 720),
      thirdBanHours: boundedNumber(dt.thirdBanHours, DEFAULT_THIRD_BAN_HOURS, 1, 720),
      banEscalationThreshold: boundedNumber(dt.banEscalationThreshold, DEFAULT_BAN_ESCALATION_THRESHOLD, 1, 10000),
    };
  } catch {
    return {
      enabled: true, warn: DEFAULT_WARN_THRESHOLD, deviceBan: DEFAULT_DEVICE_BAN_THRESHOLD,
      ipBan: DEFAULT_IP_BAN_THRESHOLD, accountBan: DEFAULT_IP_BAN_THRESHOLD,
      cascadeBans: true, cascadeMaxEntities: 100, banHours: DEFAULT_BAN_HOURS,
      scoreMap: DEFAULT_SCORE_MAP, decayWindowHours: DEFAULT_DECAY_WINDOW_HOURS,
      dedupWindowMinutes: DEFAULT_DEDUP_WINDOW_MINUTES,
      devicePostBanScore: DEFAULT_DEVICE_POST_BAN_SCORE, ipPostBanScore: DEFAULT_IP_POST_BAN_SCORE,
      firstBanMinutes: DEFAULT_FIRST_BAN_MINUTES, secondBanHours: DEFAULT_SECOND_BAN_HOURS,
      thirdBanHours: DEFAULT_THIRD_BAN_HOURS, banEscalationThreshold: DEFAULT_BAN_ESCALATION_THRESHOLD,
    };
  }
}

// 向下兼容
async function getThresholds(): Promise<{ warn: number; deviceBan: number; ipBan: number; banHours: number; enabled: boolean }> {
  const cfg = await getDenyConfig();
  return { warn: cfg.warn, deviceBan: cfg.deviceBan, ipBan: cfg.ipBan, banHours: cfg.banHours, enabled: cfg.enabled };
}

/** 读取某实体的风险分数记录 */
async function getRiskScore(entityType: RiskEntityType, entityValue: string): Promise<RiskScoreRow | null> {
  const { data } = await pgFetch<RiskScoreRow>(
    'GET',
    `bdpan_risk_scores?select=id,current_score,total_events,last_offense_at,last_offense_reason,is_banned,ban_expiry,banned_at,ban_reason&entity_type=eq.${encodeURIComponent(entityType)}&entity_value=eq.${encodeURIComponent(entityValue)}&limit=1`
  );
  if (!data || data.length === 0) return null;
  return data[0];
}

/** 一次请求读取当前请求涉及的全部实体，减少每个 API 请求的数据库往返。 */
async function getRiskScores(
  entities: Array<{ entity_type: RiskEntityType; entity_value: string }>,
): Promise<Map<string, RiskScoreRow>> {
  const result = new Map<string, RiskScoreRow>();
  const unique = Array.from(new Map(
    entities.map((entity) => [entityKey(entity.entity_type, entity.entity_value), entity]),
  ).values());
  if (unique.length === 0) return result;

  const select = 'id,entity_type,entity_value,current_score,total_events,last_offense_at,last_offense_reason,is_banned,ban_expiry,banned_at,ban_reason';
  const or = unique.map((entity) =>
    `and(entity_type.eq.${entity.entity_type},entity_value.eq.${encodeURIComponent(entity.entity_value)})`,
  ).join(',');
  const combined = await pgFetch<RiskScoreRow & { entity_type: RiskEntityType; entity_value: string }>(
    'GET',
    `bdpan_risk_scores?select=${select}&or=(${or})&limit=${unique.length}`,
  );

  if (!combined.error && combined.data) {
    for (const row of combined.data) {
      if (row.entity_type && row.entity_value) {
        result.set(entityKey(row.entity_type, row.entity_value), row);
      }
    }
    return result;
  }

  // 兼容老版本 PostgREST 不接受复杂 OR 查询的情况；只在失败时退回多查询。
  const fallback = await Promise.all(unique.map(async (entity) => ({
    entity,
    row: await getRiskScore(entity.entity_type, entity.entity_value),
  })));
  for (const item of fallback) {
    if (item.row) result.set(entityKey(item.entity.entity_type, item.entity.entity_value), item.row);
  }
  return result;
}

// 同一 PM2 进程内串行更新相交实体，避免并发请求先读后写互相覆盖分数。
// 数据库唯一索引负责最终一致性；这里解决应用侧最常见的短并发窗口。
const scoreLocks = new Map<string, Promise<void>>();

async function withScoreLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
  const uniqueKeys = Array.from(new Set(keys)).sort();
  if (uniqueKeys.length === 0) return work();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const previous = uniqueKeys.map((key) => scoreLocks.get(key) || Promise.resolve());
  for (const key of uniqueKeys) scoreLocks.set(key, gate);

  await Promise.all(previous);
  try {
    return await work();
  } finally {
    release();
    for (const key of uniqueKeys) {
      if (scoreLocks.get(key) === gate) scoreLocks.delete(key);
    }
  }
}

// ============================================================
// 公开 API
// ============================================================

function entityField(entityType: RiskEntityType): 'ip' | 'device_code_hash' | 'username' {
  if (entityType === 'ip') return 'ip';
  if (entityType === 'device_code') return 'device_code_hash';
  return 'username';
}

function entityLabel(entityType: RiskEntityType): string {
  if (entityType === 'ip') return 'IP';
  if (entityType === 'device_code') return '设备';
  return '账号';
}

function entityKey(entityType: RiskEntityType, entityValue: string): string {
  return `${entityType}:${entityValue}`;
}

function entityThreshold(entityType: RiskEntityType, cfg: DenyFullConfig): number {
  if (entityType === 'device_code') return cfg.deviceBan;
  if (entityType === 'account') return cfg.accountBan;
  return cfg.ipBan;
}

/** 封禁期间不保留触发阈值的高分，解封后仍会经过自然衰减，避免刚解封立即再次封禁。 */
function postBanScore(entityType: RiskEntityType, cfg: DenyFullConfig): number {
  const configured = Math.max(0, entityType === 'device_code' ? cfg.devicePostBanScore : cfg.ipPostBanScore);
  return Math.min(configured, Math.max(0, entityThreshold(entityType, cfg) - 1));
}

function addLinkedEntity(
  target: Map<string, { entity_type: RiskEntityType; entity_value: string }>,
  entityType: RiskEntityType,
  rawValue: unknown,
): void {
  const value = normalizeRiskEntityValue(entityType, rawValue);
  if (!value) return;
  target.set(entityKey(entityType, value), { entity_type: entityType, entity_value: value });
}

/**
 * 从 deny 事件关系中找出 IP、设备、账号三类关联实体。
 * 查询按字段分开进行，避免依赖 PostgREST 对复杂 OR 表达式的解析；同时设上限，
 * 防止学校/公司共享出口 IP 造成一次操作拖垮管理面板。
 */
async function getLinkedEntities(
  seedType: RiskEntityType,
  seedValue: string,
  maxEntities: number,
): Promise<Array<{ entity_type: RiskEntityType; entity_value: string }>> {
  const result = new Map<string, { entity_type: RiskEntityType; entity_value: string }>();
  const queue: Array<{ entity_type: RiskEntityType; entity_value: string }> = [];
  const expanded = new Set<string>();
  const normalizedSeed = normalizeRiskEntityValue(seedType, seedValue);
  if (!normalizedSeed) return [];
  addLinkedEntity(result, seedType, normalizedSeed);
  const seed = result.get(entityKey(seedType, normalizedSeed));
  if (seed) queue.push(seed);

  while (queue.length > 0 && result.size < maxEntities) {
    const current = queue.shift()!;
    const currentKey = entityKey(current.entity_type, current.entity_value);
    if (expanded.has(currentKey)) continue;
    expanded.add(currentKey);
    const field = entityField(current.entity_type);
    const actionField = current.entity_type === 'device_code' ? 'device_code' : field;
    const [denyResult, actionResult] = await Promise.all([
      pgFetch<{ ip?: string; device_code_hash?: string; username?: string }>(
      'GET',
      `bdpan_deny_events?select=ip,device_code_hash,username,created_at&${field}=eq.${encodeURIComponent(current.entity_value)}&order=created_at.desc&limit=200`
      ),
      // 普通成功操作未必会产生 deny 事件，历史 action 日志也作为关联依据。
      // action_logs 中的 device_code 已经是 hash；旧记录没有该字段时会自然返回空集。
      pgFetch<{ ip?: string; device_code?: string; username?: string }>(
        'GET',
        `bdpan_action_logs?select=ip,device_code,username,created_at&${actionField}=eq.${encodeURIComponent(current.entity_value)}&order=created_at.desc&limit=200`,
      ),
    ]);
    const linkedRows = [
      ...(denyResult.data || []).map((event) => ({
        ip: event.ip,
        device_code: event.device_code_hash,
        username: event.username,
      })),
      ...(actionResult.data || []),
    ];
    for (const event of linkedRows) {
      addLinkedEntity(result, 'ip', event.ip);
      addLinkedEntity(result, 'device_code', event.device_code);
      addLinkedEntity(result, 'account', event.username);
      for (const value of result.values()) {
        const valueKey = entityKey(value.entity_type, value.entity_value);
        if (valueKey !== currentKey && !expanded.has(valueKey) && !queue.some((item) => entityKey(item.entity_type, item.entity_value) === valueKey)) queue.push(value);
      }
      if (result.size >= maxEntities) break;
    }
  }
  return Array.from(result.values()).slice(0, maxEntities);
}

async function mergeBannedIps(values: Map<string, number>): Promise<void> {
  if (values.size === 0) return;
  try {
    const settings = await getSettings();
    const bannedIps = { ...(settings.bannedIps || {}) };
    for (const [ip, expiry] of values) {
      if (ip !== 'unknown') bannedIps[ip] = Math.max(bannedIps[ip] || 0, expiry);
    }
    await updateSettings({ bannedIps });
  } catch (error: any) {
    console.warn('[deny-tracker] 同步 IP 封禁列表失败:', error?.message || error);
  }
}

async function writeAutomaticBanLog(
  entityType: RiskEntityType,
  entityValue: string,
  score: number,
  threshold: number,
  durationHours: number,
  reason: string,
  source: string,
): Promise<void> {
  await pgInsert('bdpan_action_logs', {
    created_at: new Date().toISOString(),
    username: '系统',
    action_type: '自动封禁 - 触发',
    action_item: `${entityLabel(entityType)}: ${entityValue} (分数: ${Math.round(score)})`,
    ip: '127.0.0.1',
    location: '系统',
    log_text: `[自动封禁] ${entityLabel(entityType)} ${entityValue} 因风险评分 ${Math.round(score)} 超过阈值 ${threshold}，自动封禁 ${durationHours} 小时。最近触发: ${reason}`,
    source,
  }).catch(() => {});
}

async function cascadeBan(
  trigger: { entity_type: RiskEntityType; entity_value: string },
  banExpiry: number,
  reason: string,
  cfg: DenyFullConfig,
): Promise<Map<string, number>> {
  const ipBans = new Map<string, number>();
  if (!cfg.cascadeBans) return ipBans;

  const linked = await getLinkedEntities(trigger.entity_type, trigger.entity_value, cfg.cascadeMaxEntities);
  const targets = linked.filter((item) => entityKey(item.entity_type, item.entity_value) !== entityKey(trigger.entity_type, trigger.entity_value));
  const now = new Date();
  const rows = await Promise.all(targets.map((item) => getRiskScore(item.entity_type, item.entity_value)));

  await Promise.all(targets.map(async (item, index) => {
    const row = rows[index];
    const oldExpiry = row?.ban_expiry ? new Date(row.ban_expiry).getTime() : 0;
    const expiry = Math.max(banExpiry, Number.isFinite(oldExpiry) ? oldExpiry : 0);
    const currentScore = row ? calculateDecayedScore(row.current_score, row.last_offense_at, cfg.decayWindowHours, now.getTime()) : 0;
    const persistedScore = Math.min(currentScore, postBanScore(item.entity_type, cfg));
    await upsertRiskScore({
      entity_type: item.entity_type,
      entity_value: item.entity_value,
      current_score: persistedScore,
      total_events: row?.total_events ?? 0,
      last_offense_at: row?.last_offense_at || null,
      last_offense_reason: row?.last_offense_reason || reason,
      is_banned: true,
      banned_at: row?.banned_at || now.toISOString(),
      ban_expiry: new Date(expiry).toISOString(),
      ban_reason: `关联封禁: ${entityLabel(trigger.entity_type)} ${trigger.entity_value}`,
      updated_at: now.toISOString(),
    });
    if (item.entity_type === 'ip') ipBans.set(item.entity_value, expiry);
  }));
  return ipBans;
}

/**
 * 记录一条 deny 事件，更新风险评分，检查阈值，必要时自动封禁。
 * 所有逻辑在此完成，调用方只需 fire-and-forget 即可。
 */
export async function logDenyEvent(input: DenyEventInput): Promise<DenyResult> {
  const empty: DenyResult = { recorded: false, ipScore: 0, dcScore: 0, accountScore: 0, warning: null };

  try {
    // 全局开关检查
    const cfg = await getDenyConfig();
    if (!cfg.enabled) return empty;

    const now = new Date();
    const nowIso = now.toISOString();
    const ip = normalizeIp(input.ip);
    const normalizedDevice = normalizeDeviceCode(input.deviceCode);
    const deviceCode = normalizedDevice?.deviceCode || '';
    const deviceCodeHash = normalizedDevice?.hash || '';
    const account = normalizeAccount(input.username);
    const requestPath = normalizePath(input.requestPath);
    const pointValue = Math.max(0, Math.round(Number(cfg.scoreMap[input.denyReason] ?? 5)));
    const shouldScore = input.score !== false && pointValue > 0;
    const identities: Array<{ entity_type: RiskEntityType; entity_value: string }> = [];
    if (ip !== 'unknown') identities.push({ entity_type: 'ip', entity_value: ip });
    if (deviceCodeHash) identities.push({ entity_type: 'device_code', entity_value: deviceCodeHash });
    if (account) identities.push({ entity_type: 'account', entity_value: account });

    // 去重查询和事件写入必须与评分使用同一组实体锁。否则两个并发拒绝
    // 请求可能同时查不到对方，然后各自把同一行为重复计分。
    let scoreAdded = shouldScore ? pointValue : 0;
    const insertResult = await withScoreLocks(identities.map((identity) => entityKey(identity.entity_type, identity.entity_value)), async () => {
      let duplicateForScoring = false;
      // 去重只影响评分，不影响事件留痕。这样管理员能看到每次触发，
      // 但刷新同一个被拒请求不会不断抬高风险分。
      if (shouldScore && ip !== 'unknown' && (input.denySource === 'nginx' || requestPath)) {
        const dedupTime = new Date(now.getTime() - cfg.dedupWindowMinutes * 60 * 1000).toISOString();
        // Nginx 403 页面可以被反复打开并且 request_path 来自页面参数；
        // 对 Nginx 事件按 IP+原因去重，避免攻击者只改路径就刷满分数。
        // API 事件仍按 IP+路径+原因去重，保留不同业务接口的区分度。
        const dedupFilters = [
          `ip=eq.${encodeURIComponent(ip)}`,
          ...(input.denySource === 'nginx' ? [] : [`request_path=eq.${encodeURIComponent(requestPath)}`]),
          `deny_reason=eq.${encodeURIComponent(input.denyReason)}`,
          `created_at=gt.${encodeURIComponent(dedupTime)}`,
        ].join('&');
        const { data: existing, error: dedupError } = await pgFetch<{ id: number }>(
          'GET',
          `bdpan_deny_events?select=id&${dedupFilters}&limit=1`
        );
        duplicateForScoring = Boolean(dedupError || (existing && existing.length > 0));
      }

      scoreAdded = shouldScore && !duplicateForScoring ? pointValue : 0;
      return pgInsert('bdpan_deny_events', {
        created_at: nowIso,
        deny_source: input.denySource,
        deny_reason: input.denyReason,
        ip,
        device_code: deviceCode || null,
        device_code_hash: deviceCodeHash || null,
        user_agent: (input.userAgent || '').slice(0, 1000),
        request_path: requestPath,
        username: account || null,
        session_id: input.sessionId || '',
        risk_score_added: scoreAdded,
        geo_country: input.geoCountry || '',
        geo_city: input.geoCity || '',
        geo_region: input.geoRegion || '',
        ip_risk_at_time: 0,
        dc_risk_at_time: 0,
        source: input.source || process.env.APP_SOURCE || 'pan',
      });
    });
    const insertErr = insertResult.error;
    if (insertErr) {
      console.warn('[deny-tracker] 写入 deny_event 失败:', insertErr.message);
      return empty;
    }

    // Audit-only events (for example a PDF link being intentionally redacted)
    // must not perform extra risk-score reads or writes. This keeps normal
    // preview traffic cheap and also prevents a zero-point reason from
    // accidentally changing a score.
    if (!shouldScore) {
      return { recorded: true, ipScore: 0, dcScore: 0, accountScore: 0, warning: null };
    }

    const scored = await withScoreLocks(
      identities.map((identity) => entityKey(identity.entity_type, identity.entity_value)),
      async () => {
        const rows = await getRiskScores(identities);
        const scores = new Map<string, number>();
        const autoBans: Array<{ entity_type: RiskEntityType; entity_value: string; expiry: number; score: number; durationHours: number }> = [];
        const ipBans = new Map<string, number>();
        let appliedScore = 0;

        for (const identity of identities) {
          const row = rows.get(entityKey(identity.entity_type, identity.entity_value));
          const previousScore = row ? calculateDecayedScore(row.current_score, row.last_offense_at, cfg.decayWindowHours, now.getTime()) : 0;
          const active = isActiveBan(row, now.getTime());
          // 已封禁实体不再加分，也不能被普通 deny 覆盖成 is_banned=false。
          const nextScore = active ? previousScore : previousScore + scoreAdded;
          scores.set(entityKey(identity.entity_type, identity.entity_value), nextScore);

          if (!scoreAdded || active) continue;
          appliedScore = Math.max(appliedScore, scoreAdded);

          const threshold = entityThreshold(identity.entity_type, cfg);
          const shouldBan = nextScore >= threshold;
          const durationHours = shouldBan ? getBanDuration(row, cfg) : 0;
          const expiry = shouldBan ? now.getTime() + durationHours * 3600 * 1000 : 0;
          const persistedScore = shouldBan ? Math.min(nextScore, postBanScore(identity.entity_type, cfg)) : nextScore;
          await upsertRiskScore({
            entity_type: identity.entity_type,
            entity_value: identity.entity_value,
            current_score: persistedScore,
            total_events: (row?.total_events ?? 0) + 1,
            last_offense_at: nowIso,
            last_offense_reason: input.denyReason,
            is_banned: shouldBan,
            banned_at: shouldBan ? nowIso : null,
            ban_expiry: shouldBan ? new Date(expiry).toISOString() : null,
            ban_reason: shouldBan ? `评分 ${Math.round(nextScore)} ≥ ${threshold}` : null,
            updated_at: nowIso,
          });

          if (shouldBan) {
            autoBans.push({ ...identity, expiry, score: nextScore, durationHours });
            if (identity.entity_type === 'ip') ipBans.set(identity.entity_value, expiry);
            await writeAutomaticBanLog(
              identity.entity_type,
              identity.entity_value,
              nextScore,
              threshold,
              durationHours,
              input.denyReason,
              input.source || process.env.APP_SOURCE || 'pan',
            );
          }
        }
        return { scores, autoBans, ipBans, appliedScore };
      },
    );
    const { scores, autoBans, ipBans, appliedScore } = scored;

    // 任意一个实体触发封禁后，沿事件关系同步封禁其关联 IP/设备/账号。
    for (const trigger of autoBans) {
      const cascadedIps = await cascadeBan(
        trigger,
        trigger.expiry,
        input.denyReason,
        cfg,
      );
      for (const [linkedIp, expiry] of cascadedIps) ipBans.set(linkedIp, Math.max(ipBans.get(linkedIp) || 0, expiry));
    }
    await mergeBannedIps(ipBans);

    // 更新 deny_event 的分数快照
    try {
      let eventId = Array.isArray(insertResult.data) ? (insertResult.data[0] as any)?.id : undefined;
      if (!eventId) {
        const { data: events } = await pgFetch<{ id: number }>(
          'GET',
          `bdpan_deny_events?select=id&ip=eq.${encodeURIComponent(ip)}&created_at=eq.${encodeURIComponent(nowIso)}&order=id.desc&limit=1`
        );
        eventId = events?.[0]?.id;
      }
      if (eventId) {
        await pgFetch('PATCH', `bdpan_deny_events?id=eq.${encodeURIComponent(String(eventId))}`, {
          risk_score_added: appliedScore,
          ip_risk_at_time: scores.get(entityKey('ip', ip)) || 0,
          dc_risk_at_time: scores.get(entityKey('device_code', deviceCodeHash)) || 0,
        });
      }
    } catch {}

    // ── 生成警告文案 ──
    const ipScore = scores.get(entityKey('ip', ip)) || 0;
    const dcScore = scores.get(entityKey('device_code', deviceCodeHash)) || 0;
    const accountScore = scores.get(entityKey('account', account || '')) || 0;
    let warning: string | null = null;
    if (ipScore >= cfg.warn || dcScore >= cfg.warn || accountScore >= cfg.warn) {
      const max = Math.max(ipScore, dcScore, accountScore);
      const entity = max === accountScore ? '账号' : max === dcScore ? '设备' : 'IP';
      const score = Math.round(max);
      warning = `⚠️ 您的${entity}已有多次异常访问记录（风险分: ${score}），继续违规操作将被自动封禁`;
    }

    return { recorded: true, ipScore, dcScore, accountScore, warning };
  } catch (e: any) {
    console.error('[deny-tracker] logDenyEvent 异常:', e.message);
    return empty;
  }
}

/**
 * 一行式 deny 日志 + 403 响应 helper。
 * 自动提取 request context、记录 deny、返回带 X-Risk-Warning header 的 Response。
 */
export async function denyAndLog(
  request: Request,
  denyReason: string,
  statusCode: number,
  message: string,
  username?: string
): Promise<Response> {
  const ctx = getRequestContext(request);

  // 提取地理位置
  const geoCountry = request.headers.get('x-vercel-ip-country') || undefined;
  const geoCity = request.headers.get('x-vercel-ip-city') || undefined;
  const geoRegion = request.headers.get('x-vercel-ip-country-region') || undefined;

  const result = await logDenyEvent({
    denySource: 'api',
    denyReason,
    ip: ctx.ip,
    deviceCode: ctx.deviceCode,
    userAgent: ctx.ua,
    requestPath: ctx.path,
    username,
    acceptLanguage: request.headers.get('accept-language') || '',
    geoCountry,
    geoCity,
    geoRegion,
  }).catch(() => ({ recorded: false, ipScore: 0, dcScore: 0, warning: null }));

  const body = JSON.stringify({ code: statusCode, message });
  const response = new Response(body, {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  if (result.warning) {
    response.headers.set('X-Risk-Warning', result.warning);
  }

  return response;
}

/**
 * Record a security-relevant response without changing risk scores. This is
 * intentionally fire-and-forget at call sites where the request itself is
 * legitimate but the response proves a bypass control worked.
 */
export function auditDeny(
  request: Request,
  denyReason: string,
  username?: string,
): Promise<DenyResult> {
  const ctx = getRequestContext(request);
  return logDenyEvent({
    denySource: 'api',
    denyReason,
    ip: ctx.ip,
    deviceCode: ctx.deviceCode,
    userAgent: ctx.ua,
    requestPath: ctx.path,
    username,
    acceptLanguage: request.headers.get('accept-language') || '',
    score: false,
  });
}

/**
 * 全量封禁检查（IP + 设备码 + 账号三维度）。
 * admin/manager 角色直接返回不封禁；普通请求不能仅靠修改请求头绕过。
 */
export async function checkEntityBanned(
  ip: string,
  deviceCodeHash?: string | null,
  role?: string | null,
  username?: string | null,
): Promise<{ banned: boolean; reason: string }> {
  // admin/manager 绕过封禁
  if (role === 'admin' || role === 'manager') {
    return { banned: false, reason: '' };
  }

  const normalizedIp = normalizeIp(ip);
  const account = normalizeAccount(username);
  const identities: Array<{ entity_type: RiskEntityType; entity_value: string }> = [];
  if (normalizedIp !== 'unknown') identities.push({ entity_type: 'ip', entity_value: normalizedIp });
  const normalizedDeviceHash = normalizeRiskEntityValue('device_code', deviceCodeHash);
  if (normalizedDeviceHash) identities.push({ entity_type: 'device_code', entity_value: normalizedDeviceHash });
  if (account) identities.push({ entity_type: 'account', entity_value: account });

  const [settings, riskRows] = await Promise.all([getSettings(), getRiskScores(identities)]);
  const now = Date.now();
  const configuredIpExpiry = normalizedIp === 'unknown' ? 0 : Number(settings.bannedIps?.[normalizedIp] || 0);
  if (configuredIpExpiry > now) return { banned: true, reason: 'ip' };
  if (configuredIpExpiry > 0 && configuredIpExpiry <= now && settings.bannedIps?.[normalizedIp]) {
    // 过期项清理放到后台，不增加当前请求的拒绝判断延迟。
    const bannedIps = { ...(settings.bannedIps || {}) };
    delete bannedIps[normalizedIp];
    updateSettings({ bannedIps }).catch(() => {});
  }

  const ipRow = normalizedIp === 'unknown' ? null : riskRows.get(entityKey('ip', normalizedIp));
  const deviceRow = normalizedDeviceHash ? riskRows.get(entityKey('device_code', normalizedDeviceHash)) : null;
  const accountRow = account ? riskRows.get(entityKey('account', account)) : null;

  if (isActiveBan(ipRow, now)) return { banned: true, reason: 'ip' };
  if (isActiveBan(deviceRow, now)) return { banned: true, reason: 'device' };
  if (isActiveBan(accountRow, now)) return { banned: true, reason: 'account' };

  return { banned: false, reason: '' };
}

/**
 * 管理面板：获取风险仪表板数据
 */
export async function getRiskDashboard(): Promise<{
  recentEvents: any[];
  riskEntities: any[];
  summary: { total24h: number; warnCount: number; bannedCount: number };
}> {
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();
  const [eventsResult, riskResult, identityEventsResult, countResult, cfg] = await Promise.all([
    pgFetch('GET', 'bdpan_deny_events?select=*&order=created_at.desc&limit=200'),
    pgFetch<RiskScoreRow & { entity_type: RiskEntityType; entity_value: string }>(
      'GET',
      'bdpan_risk_scores?select=*&order=current_score.desc&limit=500',
    ),
    // 专门用于补齐“有 deny 事件但没有 risk_scores 记录”的实体。
    pgFetch<{ ip?: string; device_code_hash?: string; username?: string; created_at?: string; deny_reason?: string }>(
      'GET',
      'bdpan_deny_events?select=ip,device_code_hash,username,created_at,deny_reason&order=created_at.desc&limit=1000',
    ),
    pgFetch<{ id: number }>('GET', `bdpan_deny_events?select=id&created_at=gt.${encodeURIComponent(since24h)}`),
    getDenyConfig(),
  ]);

  const recentEvents = eventsResult.data || [];
  const identityEvents = identityEventsResult.data || [];
  const entityMap = new Map<string, any>();
  for (const row of riskResult.data || []) {
    const currentScore = calculateDecayedScore(row.current_score, row.last_offense_at, cfg.decayWindowHours, now);
    const active = isActiveBan(row, now);
    entityMap.set(entityKey(row.entity_type, row.entity_value), {
      ...row,
      current_score: currentScore,
      is_banned: active,
      ...(active ? {} : { banned_at: null, ban_expiry: null, ban_reason: null }),
      risk_source: 'risk_score',
    });
  }

  const eventSummary = new Map<string, { count: number; last: string; reason: string }>();
  for (const event of identityEvents) {
    const items: Array<[RiskEntityType, string | undefined]> = [
      ['ip', event.ip],
      ['device_code', event.device_code_hash],
      ['account', event.username],
    ];
    for (const [type, rawValue] of items) {
      const value = type === 'account'
        ? normalizeAccount(rawValue) || undefined
        : normalizeRiskEntityValue(type, rawValue) || undefined;
      if (!value) continue;
      const key = entityKey(type, value);
      const previous = eventSummary.get(key);
      const createdAt = event.created_at || '';
      if (!previous) eventSummary.set(key, { count: 1, last: createdAt, reason: event.deny_reason || '' });
      else {
        previous.count += 1;
        if (createdAt > previous.last) { previous.last = createdAt; previous.reason = event.deny_reason || ''; }
      }
    }
  }
  for (const [key, summary] of eventSummary) {
    if (entityMap.has(key)) continue;
    const separator = key.indexOf(':');
    const entity_type = key.slice(0, separator) as RiskEntityType;
    const entity_value = key.slice(separator + 1);
    entityMap.set(key, {
      id: `event-${key}`,
      entity_type,
      entity_value,
      current_score: 0,
      total_events: summary.count,
      last_offense_at: summary.last || null,
      last_offense_reason: summary.reason || null,
      is_banned: false,
      ban_expiry: null,
      banned_at: null,
      ban_reason: null,
      risk_source: 'deny_event',
    });
  }

  const riskEntities = Array.from(entityMap.values()).sort((a, b) => {
    if (Boolean(a.is_banned) !== Boolean(b.is_banned)) return a.is_banned ? -1 : 1;
    if (Number(a.current_score) !== Number(b.current_score)) return Number(b.current_score) - Number(a.current_score);
    return String(b.last_offense_at || '').localeCompare(String(a.last_offense_at || ''));
  });
  const total24h = countResult.data?.length ?? 0;
  const warnCount = riskEntities.filter((e) => e.current_score >= cfg.warn && !e.is_banned).length;
  const bannedCount = riskEntities.filter((e) => e.is_banned).length;

  return { recentEvents, riskEntities, summary: { total24h, warnCount, bannedCount } };
}

/**
 * 管理员手动解封
 */
export async function adminUnban(entityType: RiskEntityType, entityValue: string): Promise<void> {
  const normalizedValue = normalizeRiskEntityValue(entityType, entityValue);
  if (!normalizedValue) throw new Error('实体值无效');
  const cfg = await getDenyConfig();
  const linked = cfg.cascadeBans
    ? await getLinkedEntities(entityType, normalizedValue, cfg.cascadeMaxEntities)
    : [{ entity_type: entityType, entity_value: normalizedValue }];
  const now = new Date().toISOString();
  const ipValues = new Set<string>();
  for (const entity of linked) {
    if (entity.entity_type === 'ip') ipValues.add(entity.entity_value);
    await upsertRiskScore({
      entity_type: entity.entity_type,
      entity_value: entity.entity_value,
      current_score: 0,
      is_banned: false,
      banned_at: null,
      ban_expiry: null,
      ban_reason: null,
      updated_at: now,
    });
  }
  if (ipValues.size > 0) {
    const settings = await getSettings();
    const bannedIps = { ...(settings.bannedIps || {}) };
    for (const ip of ipValues) delete bannedIps[ip];
    await updateSettings({ bannedIps });
  }
}

/**
 * 管理员手动清分
 */
export async function adminResetScore(entityType: RiskEntityType, entityValue: string): Promise<void> {
  const normalizedValue = normalizeRiskEntityValue(entityType, entityValue);
  if (!normalizedValue) throw new Error('实体值无效');
  const existing = await getRiskScore(entityType, normalizedValue);
  const nowMs = Date.now();
  const activeBan = isActiveBan(existing, nowMs);
  const now = new Date().toISOString();
  await upsertRiskScore({
    entity_type: entityType,
    entity_value: normalizedValue,
    current_score: 0,
    total_events: 0,
    last_offense_at: null,
    last_offense_reason: null,
    // 清分不等于解封。只有“解封”操作可以撤销有效封禁；否则清分按钮
    // 会成为绕过联动封禁的第二条路径。
    is_banned: activeBan,
    banned_at: activeBan ? (existing?.banned_at || now) : null,
    ban_expiry: activeBan ? (existing?.ban_expiry || null) : null,
    ban_reason: activeBan ? (existing?.ban_reason || 'admin_manual_ban') : null,
    updated_at: now,
  });
}

/**
 * 管理员手动增减分数
 */
export async function adminBanEntity(entityType: RiskEntityType, entityValue: string, banHours: number): Promise<{ count: number }> {
  const normalizedValue = normalizeRiskEntityValue(entityType, entityValue);
  if (!normalizedValue) throw new Error('实体值无效');
  if (entityType === 'account' && normalizedValue === 'admin') throw new Error('不能封禁 admin 账号');
  if (!Number.isFinite(banHours) || banHours <= 0 || banHours > 8760) throw new Error('封禁时长必须在 0<时长≤8760 小时之间');
  const cfg = await getDenyConfig();
  const linked = cfg.cascadeBans
    ? await getLinkedEntities(entityType, normalizedValue, cfg.cascadeMaxEntities)
    : [{ entity_type: entityType, entity_value: normalizedValue }];
  const now = new Date();
  const expiry = now.getTime() + banHours * 3600 * 1000;
  const ipBans = new Map<string, number>();
  for (const entity of linked) {
    const row = await getRiskScore(entity.entity_type, entity.entity_value);
    const currentScore = row ? calculateDecayedScore(row.current_score, row.last_offense_at, cfg.decayWindowHours, now.getTime()) : 0;
    const oldExpiry = row?.ban_expiry ? new Date(row.ban_expiry).getTime() : 0;
    const actualExpiry = Math.max(expiry, Number.isFinite(oldExpiry) ? oldExpiry : 0);
    await upsertRiskScore({
      entity_type: entity.entity_type,
      entity_value: entity.entity_value,
      current_score: currentScore,
      total_events: row?.total_events ?? 0,
      last_offense_at: row?.last_offense_at || null,
      last_offense_reason: row?.last_offense_reason || 'admin_manual_ban',
      is_banned: true,
      banned_at: row?.banned_at || now.toISOString(),
      ban_expiry: new Date(actualExpiry).toISOString(),
      ban_reason: 'admin_manual_ban',
      updated_at: now.toISOString(),
    });
    if (entity.entity_type === 'ip') ipBans.set(entity.entity_value, actualExpiry);
  }
  await mergeBannedIps(ipBans);
  return { count: linked.length };
}

export async function adminAdjustScore(entityType: RiskEntityType, entityValue: string, delta: number): Promise<void> {
  const normalizedValue = normalizeRiskEntityValue(entityType, entityValue);
  if (!normalizedValue || !Number.isFinite(delta)) throw new Error('调整参数无效');
  if (Math.abs(delta) > 100) throw new Error('单次调整分数不能超过 100');
  await withScoreLocks([entityKey(entityType, normalizedValue)], async () => {
    const row = await getRiskScore(entityType, normalizedValue);
    const now = new Date();
    const cfg = await getDenyConfig();
    const current = row ? calculateDecayedScore(row.current_score, row.last_offense_at, cfg.decayWindowHours, now.getTime()) : 0;
    const newScore = Math.max(0, current + delta);
    await upsertRiskScore({
      entity_type: entityType,
      entity_value: normalizedValue,
      current_score: newScore,
      // 管理员修正不是一次违规事件，不能伪造 total_events，也不能让减分后立刻回弹。
      total_events: row?.total_events ?? 0,
      last_offense_at: delta > 0 ? now.toISOString() : (row?.last_offense_at || null),
      last_offense_reason: delta >= 0 ? 'admin_add_score' : 'admin_sub_score',
      is_banned: row?.is_banned && isActiveBan(row, now.getTime()) ? true : false,
      banned_at: row?.banned_at || null,
      ban_expiry: row?.ban_expiry || null,
      ban_reason: row?.ban_reason || null,
      updated_at: now.toISOString(),
    });
  });
}
