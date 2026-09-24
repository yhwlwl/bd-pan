import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog } from '../_auth';
import {
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import { isAlistPathScopeError, resolveScopedAlistPath } from '../../../lib/path-scope';

const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

async function getAlistToken(url: string, user: string, pass: string): Promise<string> {
    const cacheKey = `${url}|${user}|${pass}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.token;
    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();
    if (data.code !== 200 || !data.data?.token) throw new Error('AList 登录失败');
    const token = data.data.token;
    tokenCache.set(cacheKey, { token, expiry: Date.now() + 47 * 60 * 60 * 1000 });
    return token;
}

import { getAllFilesInDir } from '../../../lib/alist-utils';

export async function GET(request: Request) {
    let requestUsername: string | undefined;
    try {
        const ctx = getRequestContext(request);
        const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
        const { searchParams } = new URL(request.url);
        const pathsParam = searchParams.get('paths');
        const tokenParam = searchParams.get('token');
        if (!pathsParam) return NextResponse.json({ error: '缺少 paths 参数' }, { status: 400 });

        let paths: string[];
        try { paths = JSON.parse(pathsParam); if (!Array.isArray(paths)) throw new Error(); } catch {
            return NextResponse.json({ error: 'paths 格式错误' }, { status: 400 });
        }

        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const tokenUser = verifyToken(authHeader);
        const { banned, reason: banReason } = await checkEntityBanned(
            ctx.ip, deviceCodeHash, tokenUser?.role, tokenUser?.username,
        );
        if (banned) {
            const label = banReason === 'device' ? '设备' : banReason === 'account' ? '账号' : 'IP';
            return denyAndLog(request, 'api_entity_banned', 403, `您的${label}已被禁止访问`, tokenUser?.username);
        }

        const user = tokenUser || verifyTokenWithLog(authHeader, ctx);
        if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
        requestUsername = user.username;

        const basePerms = await getUserPermissions(user.username, user.role);
        const settings = await getSettings();
        const url = ECS_URL;
        const aUser = ECS_USER;
        const aPass = ECS_PASS;
        const aListToken = await getAlistToken(url, aUser, aPass);

        const result: Array<{ name: string; path: string; sign: string; size: number; relativePath: string }> = [];
        let skipped = 0, totalSize = 0;

        for (const path of paths) {
            const absolutePath = resolveScopedAlistPath(path, basePerms.basePath);
            const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, absolutePath);
            if (!pathPerms.view || !pathPerms.download) {
                skipped++;
                continue;
            }

            const pathName = path.split('/').pop() || 'folder';

            // get info: file or dir
            let getRes = null;
            for (let retry = 0; retry < 3; retry++) {
                try { getRes = await fetch(`${url}/api/fs/get`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: aListToken }, body: JSON.stringify({ path: absolutePath }), signal: AbortSignal.timeout(10000) }); if (getRes.ok) break; } catch { if (retry === 2) break; await new Promise(r => setTimeout(r, 1000)); }
            }
            if (!getRes || !getRes.ok) continue;
            const gd = await getRes.json();
            if (gd.code !== 200) continue;

            if (gd.data?.is_dir) {
                const files = await getAllFilesInDir(url, aListToken, absolutePath);
                for (const f of files) {
                    const filePath = resolveScopedAlistPath(f.path, basePerms.basePath);
                    const fp = await getEffectivePermissionsForPath(user.username, user.role, filePath);
                    if (fp.download === false) { skipped++; continue; }
                    const relativePath = filePath.replace(absolutePath, pathName).replace(/^\//, '').replace(/\\/g, '/');
                    result.push({ name: f.name, path: filePath, sign: f.sign || '', size: f.size, relativePath });
                    totalSize += f.size;
                }
            } else {
                const sign = gd.data?.sign || '';
                result.push({ name: pathName, path: absolutePath, sign, size: gd.data?.size || 0, relativePath: pathName });
                totalSize += gd.data?.size || 0;
            }
        }

        if (result.length === 0 && skipped > 0) {
            return denyAndLog(request, 'api_all_items_denied', 403, '所有选定项均被权限策略禁止访问', user?.username);
        }

        return NextResponse.json({ files: result, totalFiles: result.length, totalSize, skipped });
    } catch (error: any) {
        console.error('[batch-list] 错误:', error);
        if (isAlistPathScopeError(error)) {
            return denyAndLog(request, 'api_path_scope_denied', 403, '请求路径不在允许范围内', requestUsername);
        }
        return NextResponse.json({ error: error?.message }, { status: 500 });
    }
}
