/**
 * Deny 事件追踪 + 风险评分 + 自动封禁 核心引擎
 *
 * 所有公开函数入口首先检查 settings.denyTracking.enabled，若 false 则静默返回。
 * 此文件 import users.ts，但 users.ts 不 import 此文件 —— 避免循环依赖。
 */
import { pgInsert, pgFetch } from './pg-adapter';
import { getSettings, updateSettings, checkIpBanned } from './users';
import { hashDeviceCode, computeServerFallback } from './fingerprint';

// ============================================================
// 配置常量
// ============================================================

const SCORE_MAP: Record<string, number> = {
  nginx_db_token: 30,
  nginx_sensitive_file: 20,
  nginx_pdf_referer: 10,
  nginx_well_known: 15,
  nginx_unknown: 10,
  api_ip_banned: 25,
  api_auth_failed: 5,
  api_login_failed: 8,
  api_role_denied: 10,
  api_permission_denied: 5,
  api_file_rule_denied: 5,
  api_all_items_denied: 5,
};

const DEFAULT_WARN_THRESHOLD = 30;
const DEFAULT_DEVICE_BAN_THRESHOLD = 50;
const DEFAULT_IP_BAN_THRESHOLD = 70;
const DEFAULT_BAN_HOURS = 24;
const DECAY_WINDOW_HOURS = 24;
const DEDUP_WINDOW_MINUTES = 5;

// 封禁到期后分数重置到阈值以下，避免立即再次被封
const DEVICE_POST_BAN_SCORE = 40;   // < 50
const IP_POST_BAN_SCORE = 60;       // < 70

// ============================================================
// 类型
// ============================================================

export interface DenyEventInput {
  denySource: 'nginx' | 'api';
  denyReason: string;
  ip: string;
  deviceCode?: string;
  userAgent?: string;
  requestPath?: string;
  username?: string;
  geoCountry?: string;
  geoCity?: string;
  geoRegion?: string;
  acceptLanguage?: string;
}

export interface DenyResult {
  recorded: boolean;
  ipScore: number;
  dcScore: number;
  warning: string | null;
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

/** 从 Request 对象统一提取上下文字段 */
export function getRequestContext(request: Request): RequestContext {
  const fwdFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  let ip = fwdFor ? fwdFor.split(',')[0].trim() : (realIp || 'unknown');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  return {
    ip,
    deviceCode: request.headers.get('x-device-code') || undefined,
    path: new URL(request.url).pathname,
    ua: request.headers.get('user-agent') || '',
  };
}

/** 通用 upsert（复刻 pgUpsert 模式，支持任意表） */
async function generalUpsert(table: string, data: Record<string, unknown>): Promise<void> {
  try {
    const ECS_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const PG_TOKEN = process.env.PG_DB_TOKEN || '';
    const url = new URL(`${ECS_URL}/${table}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    };
    if (PG_TOKEN) headers['X-DB-Token'] = PG_TOKEN;
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.warn(`[deny-tracker] upsert ${table} failed: HTTP ${res.status}`);
    }
  } catch (e: any) {
    console.warn(`[deny-tracker] upsert ${table} error: ${e.message}`);
  }
}

/** 计算衰减后的分数 */
function decayScore(previousScore: number, hoursSinceLast: number): number {
  if (hoursSinceLast >= DECAY_WINDOW_HOURS) return 0;
  return previousScore * (1 - hoursSinceLast / DECAY_WINDOW_HOURS);
}

/** 读取阈值配置 */
async function getThresholds(): Promise<{ warn: number; deviceBan: number; ipBan: number; banHours: number; enabled: boolean }> {
  try {
    const settings = await getSettings();
    const dt = (settings as any).denyTracking;
    return {
      enabled: dt?.enabled !== false, // 默认开启
      warn: dt?.warnThreshold ?? DEFAULT_WARN_THRESHOLD,
      deviceBan: dt?.deviceBanThreshold ?? DEFAULT_DEVICE_BAN_THRESHOLD,
      ipBan: dt?.ipBanThreshold ?? DEFAULT_IP_BAN_THRESHOLD,
      banHours: dt?.banDurationHours ?? DEFAULT_BAN_HOURS,
    };
  } catch {
    return {
      enabled: true,
      warn: DEFAULT_WARN_THRESHOLD,
      deviceBan: DEFAULT_DEVICE_BAN_THRESHOLD,
      ipBan: DEFAULT_IP_BAN_THRESHOLD,
      banHours: DEFAULT_BAN_HOURS,
    };
  }
}

/** 读取某实体的风险分数记录 */
async function getRiskScore(entityType: string, entityValue: string): Promise<{
  current_score: number;
  total_events: number;
  last_offense_at: string | null;
  is_banned: boolean;
  ban_expiry: string | null;
  banned_at: string | null;
  ban_reason: string | null;
} | null> {
  const { data } = await pgFetch<{
    current_score: number;
    total_events: number;
    last_offense_at: string;
    is_banned: boolean;
    ban_expiry: string;
    banned_at: string;
    ban_reason: string;
  }>('GET', `bdpan_risk_scores?select=current_score,total_events,last_offense_at,is_banned,ban_expiry,banned_at,ban_reason&entity_type=eq.${encodeURIComponent(entityType)}&entity_value=eq.${encodeURIComponent(entityValue)}&limit=1`);
  if (!data || data.length === 0) return null;
  return data[0];
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 记录一条 deny 事件，更新风险评分，检查阈值，必要时自动封禁。
 * 所有逻辑在此完成，调用方只需 fire-and-forget 即可。
 */
export async function logDenyEvent(input: DenyEventInput): Promise<DenyResult> {
  const empty: DenyResult = { recorded: false, ipScore: 0, dcScore: 0, warning: null };

  try {
    // 全局开关检查
    const thresholds = await getThresholds();
    if (!thresholds.enabled) return empty;

    const now = new Date();
    const pointValue = SCORE_MAP[input.denyReason] ?? 5;

    // ── 去重：同一 (IP, path) 5 分钟内只计一次分 ──
    if (input.requestPath) {
      const dedupTime = new Date(now.getTime() - DEDUP_WINDOW_MINUTES * 60 * 1000).toISOString();
      const { data: existing } = await pgFetch<{ id: number }>(
        'GET',
        `bdpan_deny_events?select=id&ip=eq.${encodeURIComponent(input.ip)}&request_path=eq.${encodeURIComponent(input.requestPath)}&created_at=gt.${encodeURIComponent(dedupTime)}&limit=1`
      );
      if (existing && existing.length > 0) {
        return { recorded: false, ipScore: 0, dcScore: 0, warning: null };
      }
    }

    // ── 设备码处理 ──
    let deviceCode = input.deviceCode || '';
    let deviceCodeHash = '';
    if (deviceCode) {
      deviceCodeHash = hashDeviceCode(deviceCode) || '';
    } else {
      // L1 兜底：服务端指纹
      deviceCode = computeServerFallback(input.ip, input.userAgent || '', input.acceptLanguage || '');
      deviceCodeHash = hashDeviceCode(deviceCode) || '';
    }

    // ── 写入 deny_event ──
    const eventRecord: Record<string, unknown> = {
      created_at: now.toISOString(),
      deny_source: input.denySource,
      deny_reason: input.denyReason,
      ip: input.ip,
      device_code: deviceCode,
      device_code_hash: deviceCodeHash,
      user_agent: input.userAgent || '',
      request_path: input.requestPath || '',
      username: input.username || '',
      risk_score_added: pointValue,
      geo_country: input.geoCountry || '',
      geo_city: input.geoCity || '',
      geo_region: input.geoRegion || '',
      ip_risk_at_time: 0,
      dc_risk_at_time: 0,
    };
    const { error: insertErr } = await pgInsert('bdpan_deny_events', eventRecord);
    if (insertErr) {
      console.warn('[deny-tracker] 写入 deny_event 失败:', insertErr.message);
      return empty;
    }

    // ── 更新 IP 风险分 ──
    let ipScore = pointValue;
    let ipBanned = false;
    const ipRow = await getRiskScore('ip', input.ip);
    if (ipRow) {
      const hoursSince = ipRow.last_offense_at
        ? (now.getTime() - new Date(ipRow.last_offense_at).getTime()) / 3600000
        : DECAY_WINDOW_HOURS;
      // 检查IP封禁是否已过期，过期则重置分数
      if (ipRow.is_banned && ipRow.ban_expiry && new Date(ipRow.ban_expiry) <= now) {
        ipScore = IP_POST_BAN_SCORE + pointValue; // 冷却重置
      } else {
        ipScore = decayScore(ipRow.current_score, hoursSince) + pointValue;
      }
    }

    // 检查是否触发 IP 自动封禁
    if (ipScore >= thresholds.ipBan) {
      try {
        const settings = await getSettings();
        const bannedIps = { ...(settings.bannedIps || {}) };
        const banUntil = now.getTime() + thresholds.banHours * 3600 * 1000;
        bannedIps[input.ip] = banUntil;
        await updateSettings({ bannedIps });
        ipBanned = true;

        // 写入醒目日志
        pgInsert('bdpan_action_logs', {
          created_at: now.toISOString(),
          username: '系统',
          action_type: '自动封禁 - 触发',
          action_item: `IP: ${input.ip} (分数: ${Math.round(ipScore)})`,
          ip: '127.0.0.1',
          location: '系统',
          log_text: `[自动封禁] IP ${input.ip} 因风险评分 ${Math.round(ipScore)} 超过阈值 ${thresholds.ipBan}，自动封禁 ${thresholds.banHours} 小时。最近触发: ${input.denyReason}`,
        }).catch(() => {});
      } catch (e) {
        console.warn('[deny-tracker] IP 自动封禁失败:', e);
      }
    }

    // Upsert IP 风险分
    await generalUpsert('bdpan_risk_scores', {
      entity_type: 'ip',
      entity_value: input.ip,
      current_score: ipScore,
      total_events: (ipRow?.total_events ?? 0) + 1,
      last_offense_at: now.toISOString(),
      last_offense_reason: input.denyReason,
      is_banned: ipBanned,
      banned_at: ipBanned ? now.toISOString() : (ipRow?.banned_at || null),
      ban_expiry: ipBanned ? new Date(now.getTime() + thresholds.banHours * 3600 * 1000).toISOString() : (ipRow?.ban_expiry || null),
      ban_reason: ipBanned ? `评分 ${Math.round(ipScore)} ≥ ${thresholds.ipBan}` : (ipRow?.ban_reason || null),
      updated_at: now.toISOString(),
    });

    // ── 更新设备码风险分 ──
    let dcScore = pointValue;
    let dcBanned = false;
    if (deviceCodeHash) {
      const dcRow = await getRiskScore('device_code', deviceCodeHash);
      if (dcRow) {
        const hoursSince = dcRow.last_offense_at
          ? (now.getTime() - new Date(dcRow.last_offense_at).getTime()) / 3600000
          : DECAY_WINDOW_HOURS;
        if (dcRow.is_banned && dcRow.ban_expiry && new Date(dcRow.ban_expiry) <= now) {
          dcScore = DEVICE_POST_BAN_SCORE + pointValue;
        } else {
          dcScore = decayScore(dcRow.current_score, hoursSince) + pointValue;
        }
      }

      if (dcScore >= thresholds.deviceBan) {
        dcBanned = true;
        pgInsert('bdpan_action_logs', {
          created_at: now.toISOString(),
          username: '系统',
          action_type: '自动封禁 - 触发',
          action_item: `设备: ${deviceCodeHash} (分数: ${Math.round(dcScore)})`,
          ip: '127.0.0.1',
          location: '系统',
          log_text: `[自动封禁] 设备 ${deviceCodeHash} 因风险评分 ${Math.round(dcScore)} 超过阈值 ${thresholds.deviceBan}，自动封禁 ${thresholds.banHours} 小时。最近触发: ${input.denyReason}`,
        }).catch(() => {});
      }

      await generalUpsert('bdpan_risk_scores', {
        entity_type: 'device_code',
        entity_value: deviceCodeHash,
        current_score: dcScore,
        total_events: (dcRow?.total_events ?? 0) + 1,
        last_offense_at: now.toISOString(),
        last_offense_reason: input.denyReason,
        is_banned: dcBanned,
        banned_at: dcBanned ? now.toISOString() : (dcRow?.banned_at || null),
        ban_expiry: dcBanned ? new Date(now.getTime() + thresholds.banHours * 3600 * 1000).toISOString() : (dcRow?.ban_expiry || null),
        ban_reason: dcBanned ? `评分 ${Math.round(dcScore)} ≥ ${thresholds.deviceBan}` : (dcRow?.ban_reason || null),
        updated_at: now.toISOString(),
      });
    }

    // 更新 deny_event 的分数快照
    try {
      const { data: events } = await pgFetch<{ id: number }>(
        'GET',
        `bdpan_deny_events?select=id&ip=eq.${encodeURIComponent(input.ip)}&created_at=eq.${encodeURIComponent(now.toISOString())}&limit=1`
      );
      if (events && events.length > 0) {
        // PATCH to update the score columns
        const ECS_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
        const PG_TOKEN = process.env.PG_DB_TOKEN || '';
        await fetch(`${ECS_URL}/bdpan_deny_events?id=eq.${events[0].id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(PG_TOKEN ? { 'X-DB-Token': PG_TOKEN } : {}),
          },
          body: JSON.stringify({ ip_risk_at_time: ipScore, dc_risk_at_time: dcScore }),
        }).catch(() => {});
      }
    } catch {}

    // ── 生成警告文案 ──
    let warning: string | null = null;
    if (ipScore >= thresholds.warn || dcScore >= thresholds.warn) {
      const entity = dcScore >= ipScore ? '设备' : 'IP';
      const score = Math.round(dcScore >= ipScore ? dcScore : ipScore);
      warning = `⚠️ 您的${entity}已有多次异常访问记录（风险分: ${score}），继续违规操作将被自动封禁`;
    }

    return { recorded: true, ipScore, dcScore, warning };
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
  message: string
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
 * 全量封禁检查（IP + 设备码双维度）。
 * admin/manager 角色直接返回不封禁。
 */
export async function checkEntityBanned(
  ip: string,
  deviceCodeHash?: string | null,
  role?: string | null
): Promise<{ banned: boolean; reason: string }> {
  // admin/manager 绕过封禁
  if (role === 'admin' || role === 'manager') {
    return { banned: false, reason: '' };
  }

  // 1. 检查 IP 封禁
  const ipBanned = await checkIpBanned(ip);
  if (ipBanned) {
    // 记日志
    logDenyEvent({
      denySource: 'api',
      denyReason: 'api_ip_banned',
      ip,
    }).catch(() => {});
    return { banned: true, reason: 'ip' };
  }

  // 2. 检查设备码封禁
  if (deviceCodeHash) {
    const now = new Date().toISOString();
    const { data } = await pgFetch<{ id: number }>(
      'GET',
      `bdpan_risk_scores?select=id&entity_type=eq.device_code&entity_value=eq.${encodeURIComponent(deviceCodeHash)}&is_banned=eq.true&ban_expiry=gt.${encodeURIComponent(now)}&limit=1`
    );
    if (data && data.length > 0) {
      return { banned: true, reason: 'device' };
    }
  }

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
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  // 最近 deny 事件
  const { data: recentEvents } = await pgFetch(
    'GET',
    `bdpan_deny_events?select=*&order=created_at.desc&limit=200`
  );

  // 风险实体
  const { data: riskEntities } = await pgFetch(
    'GET',
    `bdpan_risk_scores?select=*&order=current_score.desc&limit=50`
  );

  // 统计
  const { data: count24h } = await pgFetch<{ count: number }>(
    'GET',
    `bdpan_deny_events?select=id&created_at=gt.${encodeURIComponent(since24h)}`
  );
  const total24h = count24h?.length ?? 0;
  const warnCount = (riskEntities || []).filter((e: any) => e.current_score >= DEFAULT_WARN_THRESHOLD && !e.is_banned).length;
  const bannedCount = (riskEntities || []).filter((e: any) => e.is_banned).length;

  return {
    recentEvents: recentEvents || [],
    riskEntities: riskEntities || [],
    summary: { total24h, warnCount, bannedCount },
  };
}

/**
 * 管理员手动解封
 */
export async function adminUnban(entityType: 'ip' | 'device_code', entityValue: string): Promise<void> {
  if (entityType === 'ip') {
    const settings = await getSettings();
    const bannedIps = { ...(settings.bannedIps || {}) };
    delete bannedIps[entityValue];
    await updateSettings({ bannedIps });
  }
  // 更新 risk_scores 表
  const now = new Date().toISOString();
  await generalUpsert('bdpan_risk_scores', {
    entity_type: entityType,
    entity_value: entityValue,
    is_banned: false,
    updated_at: now,
  });
}

/**
 * 管理员手动清分
 */
export async function adminResetScore(entityType: 'ip' | 'device_code', entityValue: string): Promise<void> {
  const now = new Date().toISOString();
  await generalUpsert('bdpan_risk_scores', {
    entity_type: entityType,
    entity_value: entityValue,
    current_score: 0,
    is_banned: false,
    updated_at: now,
  });
}
