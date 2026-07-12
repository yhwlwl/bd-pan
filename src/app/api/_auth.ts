import crypto from 'crypto';
import type { Role } from '../../lib/users';
import { logDenyEvent } from '../../lib/deny-tracker';

// tokenInvalidBefore 缓存（避免每个请求都读数据库）
let _cachedTokenInvalidBefore = 0;
let _lastTokenInvalidFetch = 0;

async function getTokenInvalidBefore(): Promise<number> {
  if (Date.now() - _lastTokenInvalidFetch < 30000) return _cachedTokenInvalidBefore;
  try {
    const { getSettings } = await import('../../lib/users');
    const s = await getSettings();
    _cachedTokenInvalidBefore = s.tokenInvalidBefore || 0;
    _lastTokenInvalidFetch = Date.now();
  } catch {}
  return _cachedTokenInvalidBefore;
}

// 强制刷新（应急面板调用）
export async function refreshTokenInvalidBefore() {
  _lastTokenInvalidFetch = 0;
  return getTokenInvalidBefore();
}

export interface AuthContext {
  ip: string;
  deviceCode?: string;
  path: string;
  ua: string;
}

function getSecret() {
    return process.env.ADMIN_TOKEN_SECRET || 'default-secret-change-me';
}

export function signToken(username: string, role: Role, durationHours?: number): string | null {
    const secret = getSecret();
    const ttl = (durationHours && durationHours > 0 ? durationHours : 8) * 60 * 60 * 1000;
    const payload = {
        iat: Date.now(),
        exp: Date.now() + ttl,
        username,
        role,
    };
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64url');

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadB64);
    const sig = hmac.digest('hex');

    return `${payloadB64}.${sig}`;
}

export interface TokenPayload {
    username: string;
    role: Role;
}

export function verifyToken(authHeader?: string): TokenPayload | null {
    const secret = getSecret();
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

    const token = parts[1];
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadB64);
    const expectedSig = hmac.digest('hex');
    if (expectedSig !== sig) return null;

    try {
        const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const payload = JSON.parse(payloadStr) as { iat?: number; exp?: number; username?: string; role?: Role };
        if (!payload.exp || typeof payload.exp !== 'number') return null;
        if (Date.now() > payload.exp) return null;
        if (!payload.username || !payload.role) return null;
        // 维护模式踢出检查（admin 豁免，旧 token 无 iat 不检查）
        if (_cachedTokenInvalidBefore > 0 && payload.iat && payload.iat < _cachedTokenInvalidBefore && payload.role !== 'admin') {
          return null;
        }
        return { username: payload.username, role: payload.role };
    } catch {
        return null;
    }
}

/** 快捷校验：Token 合法且角色在 allowedRoles 内 */
export function requireRole(authHeader: string | undefined, ...allowedRoles: Role[]): TokenPayload | null {
    const payload = verifyToken(authHeader);
    if (!payload) return null;
    if (!allowedRoles.includes(payload.role)) return null;
    return payload;
}

// 向后兼容：旧代码引用 verifyAdminToken 的地方 → 只允许 admin/manager
export function verifyAdminToken(authHeader?: string): boolean {
    return requireRole(authHeader, 'admin', 'manager') !== null;
}

/** verifyToken 增强版：验证失败时自动记录 deny 日志 */
export function verifyTokenWithLog(authHeader: string | undefined, ctx?: AuthContext): TokenPayload | null {
    const payload = verifyToken(authHeader);
    if (!payload && ctx) {
        logDenyEvent({
            denySource: 'api',
            denyReason: 'api_auth_failed',
            ip: ctx.ip,
            deviceCode: ctx.deviceCode,
            userAgent: ctx.ua,
            requestPath: ctx.path,
        }).catch(() => {});
    }
    return payload;
}

/** requireRole 增强版：角色不匹配时自动记录 deny 日志 */
export function requireRoleWithLog(authHeader: string | undefined, ctx?: AuthContext, ...allowedRoles: Role[]): TokenPayload | null {
    const payload = requireRole(authHeader, ...allowedRoles);
    if (!payload && ctx) {
        // 先判断是 token 问题还是角色问题
        const tokenPayload = verifyToken(authHeader);
        logDenyEvent({
            denySource: 'api',
            denyReason: tokenPayload ? 'api_role_denied' : 'api_auth_failed',
            ip: ctx.ip,
            deviceCode: ctx.deviceCode,
            userAgent: ctx.ua,
            requestPath: ctx.path,
            username: tokenPayload?.username,
        }).catch(() => {});
    }
    return payload;
}
