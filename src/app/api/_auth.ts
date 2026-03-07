import crypto from 'crypto';
import type { Role } from '../../lib/users';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时

function getSecret() {
    return process.env.ADMIN_TOKEN_SECRET || '***REDACTED***';
}

export function signToken(username: string, role: Role): string | null {
    const secret = getSecret();
    const payload = {
        exp: Date.now() + TOKEN_TTL_MS,
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
        const payload = JSON.parse(payloadStr) as { exp?: number; username?: string; role?: Role };
        if (!payload.exp || typeof payload.exp !== 'number') return null;
        if (Date.now() > payload.exp) return null;
        if (!payload.username || !payload.role) return null;
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
