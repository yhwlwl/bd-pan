/**
 * GET+POST /api/deny-stats — 管理面板风险仪表板 API
 *
 * 风控数据按查看操作裁剪，写操作按具体风险操作授权。
 */
import { getMgAuthContext, canMgModify, canMgView } from '../_mg-auth';
import { getRiskDashboard, adminUnban, adminResetScore, adminAdjustScore, adminBanEntity } from '../../../lib/deny-tracker';
import { getSettings, updateSettings } from '../../../lib/users';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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
    return json({ code: 403, message: '权限不足' }, 403);
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
    const operationByAction: Record<string, string[]> = {
      unban: ['riskcontrol.unban', 'visits.unban'],
      ban_ip: ['visits.banShort', 'visits.banCustom'],
      clear_score: ['riskcontrol.clearScore'],
      adjust_score: ['riskcontrol.adjustScore'],
      config_thresholds: ['settings.denyConfig'],
    };
    const allowedOperations = operationByAction[action] || [];
    const operation = typeof mgOperation === 'string' && allowedOperations.includes(mgOperation)
      ? mgOperation
      : auth.user.role === 'admin' && allowedOperations[0];
    if (!operation || (auth.user.role !== 'admin' && !canMgModify(auth, operation))) {
      return json({ code: 403, message: '无对应操作权限' }, 403);
    }

    if (action === 'unban' && entity_type && entity_value) {
      await adminUnban(entity_type, entity_value);
      return json({ code: 200, message: '已解封' });
    }

    if (action === 'ban_ip' && entity_type && entity_value && typeof body.ban_hours === 'number') {
      const expectedOperation = body.ban_hours <= 24 ? 'visits.banShort' : 'visits.banCustom';
      if (auth.user.role !== 'admin' && mgOperation !== expectedOperation) {
        return json({ code: 403, message: '封禁时长与操作权限不匹配' }, 403);
      }
      await adminBanEntity(entity_type, entity_value, body.ban_hours);
      return json({ code: 200, message: '已标记封禁' });
    }

    if (action === 'clear_score' && entity_type && entity_value) {
      await adminResetScore(entity_type, entity_value);
      return json({ code: 200, message: '已清分' });
    }

    if (action === 'adjust_score' && entity_type && entity_value && typeof body.delta === 'number') {
      await adminAdjustScore(entity_type, entity_value, body.delta);
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
      return json({ code: 200, message: '配置已更新' });
    }

    return json({ code: 400, message: '未知操作' }, 400);
  } catch (e: any) {
    return json({ code: 500, message: e.message }, 500);
  }
}
