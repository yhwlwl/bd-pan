/**
 * GET+POST /api/deny-stats — 管理面板风险仪表板 API
 *
 * 风控数据按查看操作裁剪，写操作按具体风险操作授权。
 */
import { getMgAuthContext, canMgModify, canMgView } from '../_mg-auth';
import { denyAndLog, getRequestContext, getRiskDashboard, adminUnban, adminResetScore, adminAdjustScore, adminBanEntity } from '../../../lib/deny-tracker';
import { getSettings, updateSettings } from '../../../lib/users';
import type { RiskEntityType } from '../../../lib/deny-tracker';
import { pgInsert } from '../../../lib/pg-adapter';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function logRiskAdminAction(
  request: Request,
  username: string,
  actionItem: string,
  logText: string,
): Promise<void> {
  const ctx = getRequestContext(request);
  await pgInsert('bdpan_action_logs', {
    created_at: new Date().toISOString(),
    username,
    action_type: '管理 - 风控操作',
    action_item: actionItem.slice(0, 500),
    ip: ctx.ip,
    location: '管理后台',
    log_text: logText.slice(0, 1000),
    source: process.env.APP_SOURCE || 'pan',
  }).catch(() => {});
}

export async function GET(request: Request): Promise<Response> {
  const auth = await getMgAuthContext(request);
  if (!auth) return json({ code: 401, message: '请先登录' }, 401);
  if (auth.user.role !== 'admin' && !(
    canMgView(auth, 'riskcontrol.viewSummary') ||
    canMgView(auth, 'riskcontrol.viewEntities') ||
    canMgView(auth, 'riskcontrol.viewDetail') ||
    canMgView(auth, 'riskcontrol.viewDenyEvents') ||
    canMgView(auth, 'overview.viewRecentDeny') ||
    canMgView(auth, 'emergency.view')
  )) {
    return denyAndLog(request, 'api_role_denied', 403, '无风控面板查看权限', auth.user.username);
  }

  try {
    const dashboard = await getRiskDashboard();
    if (auth.user.role === 'admin') return json({ code: 200, ...dashboard });

    const canSummary = canMgView(auth, 'riskcontrol.viewSummary') || canMgView(auth, 'overview.viewRecentDeny') || canMgView(auth, 'emergency.view');
    return json({
      code: 200,
      summary: canSummary ? dashboard.summary : { total24h: 0, warnCount: 0, bannedCount: 0 },
      riskEntities: canMgView(auth, 'riskcontrol.viewEntities') || canMgView(auth, 'riskcontrol.viewDetail') ? dashboard.riskEntities : [],
      recentEvents: canMgView(auth, 'riskcontrol.viewDenyEvents') || canMgView(auth, 'overview.viewRecentDeny') ? dashboard.recentEvents : [],
    });
  } catch (e: any) {
    return json({ code: 500, message: e.message }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getMgAuthContext(request);
  if (!auth) return json({ code: 401, message: '请先登录' }, 401);

  try {
    const body = await request.json();
    const { action, entity_type, entity_value, mgOperation } = body;
    const validEntityTypes: RiskEntityType[] = ['ip', 'device_code', 'account'];
    const validEntity = validEntityTypes.includes(entity_type) && typeof entity_value === 'string' && entity_value.trim().length > 0;
    const operationByAction: Record<string, string[]> = {
      unban: ['riskcontrol.unban', 'visits.unban'],
      ban_ip: ['visits.banShort', 'visits.banCustom', 'emergency.banAllIPs'],
      ban_entity: ['riskcontrol.ban'],
      clear_score: ['riskcontrol.clearScore'],
      adjust_score: ['riskcontrol.adjustScore'],
      config_thresholds: ['settings.denyConfig'],
    };
    const allowedOperations = operationByAction[action] || [];
    const operation = typeof mgOperation === 'string' && allowedOperations.includes(mgOperation)
      ? mgOperation
      : auth.user.role === 'admin' && allowedOperations[0];
    if (!operation || (auth.user.role !== 'admin' && !canMgModify(auth, operation))) {
      return denyAndLog(request, 'api_role_denied', 403, '无对应风控操作权限', auth.user.username);
    }

    if (action === 'unban' && validEntity) {
      await adminUnban(entity_type, entity_value);
      await logRiskAdminAction(request, auth.user.username, `解封 ${entity_type}=${entity_value}`, `管理员 ${auth.user.username} 解封 ${entity_type}=${entity_value}，并同步关联实体`);
      return json({ code: 200, message: '已解封' });
    }

    if (action === 'ban_ip' && entity_type === 'ip' && validEntity && typeof body.ban_hours === 'number') {
      if (!Number.isFinite(body.ban_hours) || body.ban_hours <= 0 || body.ban_hours > 8760) {
        return json({ code: 400, message: '封禁时长必须在 0<时长≤8760 小时之间' }, 400);
      }
      const expectedOperation = body.ban_hours <= 24 ? 'visits.banShort' : 'visits.banCustom';
      if (auth.user.role !== 'admin' && mgOperation !== expectedOperation && mgOperation !== 'emergency.banAllIPs') {
        return denyAndLog(request, 'api_role_denied', 403, '封禁时长与操作权限不匹配', auth.user.username);
      }
      await adminBanEntity(entity_type, entity_value, body.ban_hours);
      await logRiskAdminAction(request, auth.user.username, `封禁 IP ${entity_value} ${body.ban_hours} 小时`, `管理员 ${auth.user.username} 封禁 IP ${entity_value} ${body.ban_hours} 小时，并同步关联实体`);
      return json({ code: 200, message: '已标记封禁' });
    }

    if (action === 'ban_entity' && validEntity && typeof body.ban_hours === 'number') {
      if (!Number.isFinite(body.ban_hours) || body.ban_hours <= 0 || body.ban_hours > 8760) {
        return json({ code: 400, message: '封禁时长必须在 0<时长≤8760 小时之间' }, 400);
      }
      const result = await adminBanEntity(entity_type, entity_value, body.ban_hours);
      await logRiskAdminAction(request, auth.user.username, `封禁 ${entity_type}=${entity_value} ${body.ban_hours} 小时`, `管理员 ${auth.user.username} 封禁 ${entity_type}=${entity_value} ${body.ban_hours} 小时，并同步 ${result.count} 个实体`);
      return json({ code: 200, message: `已封禁，并同步关联实体（${result.count} 个）` });
    }

    if (action === 'clear_score' && validEntity) {
      await adminResetScore(entity_type, entity_value);
      await logRiskAdminAction(request, auth.user.username, `清空 ${entity_type}=${entity_value} 分数`, `管理员 ${auth.user.username} 清空 ${entity_type}=${entity_value} 风险分数`);
      return json({ code: 200, message: '已清分' });
    }

    if (action === 'adjust_score' && validEntity && typeof body.delta === 'number') {
      await adminAdjustScore(entity_type, entity_value, body.delta);
      await logRiskAdminAction(request, auth.user.username, `调整 ${entity_type}=${entity_value} ${body.delta >= 0 ? '+' : ''}${body.delta}`, `管理员 ${auth.user.username} 调整 ${entity_type}=${entity_value} 风险分数 ${body.delta >= 0 ? '+' : ''}${body.delta}`);
      return json({ code: 200, message: `分数已调整 (${body.delta >= 0 ? '+' : ''}${body.delta})` });
    }

    if (action === 'config_thresholds') {
      const settings = await getSettings();
      const dt = settings.denyTracking || {};
      const newDT = {
        ...dt,
        enabled: body.enabled !== undefined ? body.enabled : dt.enabled,
        warnThreshold: body.warn_threshold ?? dt.warnThreshold,
        deviceBanThreshold: body.device_ban_threshold ?? dt.deviceBanThreshold,
        ipBanThreshold: body.ip_ban_threshold ?? dt.ipBanThreshold,
        banDurationHours: body.ban_duration_hours ?? dt.banDurationHours,
      };
      await updateSettings({ denyTracking: newDT });
      await logRiskAdminAction(request, auth.user.username, '更新风控阈值', `管理员 ${auth.user.username} 更新风控阈值配置`);
      return json({ code: 200, message: '配置已更新' });
    }

    return json({ code: 400, message: '未知操作' }, 400);
  } catch (e: any) {
    return json({ code: 500, message: e.message }, 500);
  }
}
