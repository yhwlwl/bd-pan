// Edge-compatible 版本的 auth 工具（使用 Web Crypto API，不依赖 Node.js crypto）
import type { Role } from '../../lib/users';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function getSecret(): string | null {
    const secret = process.env.ADMIN_TOKEN_SECRET?.trim();
    return secret || null;
}

async function hmacSign(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface TokenPayload {
    username: string;
    role: Role;
}

export async function verifyTokenEdge(authHeader?: string): Promise<TokenPayload | null> {
    const secret = getSecret();
    if (!secret || !authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

    const token = parts[1];
    const dotIdx = token.indexOf('.');
    if (dotIdx === -1) return null;
    const payloadB64 = token.substring(0, dotIdx);
    const sig = token.substring(dotIdx + 1);

    const expectedSig = await hmacSign(payloadB64, secret);
    if (expectedSig !== sig) return null;

    try {
        // base64url -> utf8 (Edge 兼容)
        const raw = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(raw) as { exp?: number; username?: string; role?: Role };
        if (!payload.exp || typeof payload.exp !== 'number') return null;
        if (Date.now() > payload.exp) return null;
        if (!payload.username || !payload.role) return null;
        return { username: payload.username, role: payload.role };
    } catch {
        return null;
    }
}
