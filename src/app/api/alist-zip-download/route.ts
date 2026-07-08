import { NextResponse } from 'next/server';
import { verifyTokenWithLog } from '../_auth';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';
import {
    applyBasePathForPermissions,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';

export const maxDuration = 300; // Vercel: max 300s for streaming

const ALIST_BASE_DEFAULT = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_URL = ALIST_BASE_DEFAULT;
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

async function getAlistToken(url: string, user: string, pass: string): Promise<string> {
    const cacheKey = `${url}:${user}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
        return cached.token;
    }

    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });

    const data = (await res.json()) as { data?: { token: string } };
    const token = data.data?.token || '';
    tokenCache.set(cacheKey, { token, expiry: Date.now() + 8 * 60 * 60 * 1000 });
    return token;
}

import { getAllFilesInDir } from '../../../lib/alist-utils';

export async function GET(request: Request) {
    try {
        const ctx = getRequestContext(request);
        const deviceCodeHash = hashDeviceCode(ctx.deviceCode || '');
        const { banned, reason: banReason } = await checkEntityBanned(ctx.ip, deviceCodeHash);
        if (banned) {
            return NextResponse.json({ code: 403, message: `您的${banReason === 'device' ? '设备' : 'IP'}已被禁止访问` }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const pathsParam = searchParams.get('paths');
        const tokenParam = searchParams.get('token');

        if (!pathsParam) {
            return NextResponse.json({ error: 'Missing paths' }, { status: 400 });
        }

        let paths: string[];
        try {
            paths = JSON.parse(pathsParam);
            if (!Array.isArray(paths)) throw new Error('paths must be array');
        } catch {
            return NextResponse.json({ error: 'Invalid paths format' }, { status: 400 });
        }

        // Verify user
        const authHeader = request.headers.get('authorization') || (tokenParam ? `Bearer ${tokenParam}` : undefined);
        const user = verifyTokenWithLog(authHeader, ctx);
        if (!user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 });
        }

        // Check permissions (顶层跳过，子文件在预扫描时逐个检查)
        const basePerms = await getUserPermissions(user.username, user.role);
        let deniedCount = 0;

        for (const path of paths) {
            const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
            const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, absolutePath);

            if (!pathPerms.view || !pathPerms.download) {
                console.log(`[ZIP-download] 权限跳过: ${path}`);
                deniedCount++;
                continue;
            }
        }
        if (deniedCount > 0 && deniedCount === paths.length) {
            return denyAndLog(request, 'api_all_items_denied', 403, '所有选定项均被权限策略禁止访问', user?.username);
        }

        const settings = await getSettings();
        const channel = settings.downloadChannel || 'ecs';
        const url = channel === 'ecs' ? ECS_URL : FRP_URL;
        const aUser = channel === 'ecs' ? ECS_USER : FRP_USER;
        const aPass = channel === 'ecs' ? ECS_PASS : FRP_PASS;

        const aListToken = await getAlistToken(url, aUser, aPass);

        console.log(`[ZIP:T1首选] 开始打包, ${paths.length} 个路径 → /p/ 直链优先`);

        // 预扫描：递归列文件 + 权限检查，统计跳过数
        let totalSkipped = 0;
        type FileEntry = { path: string; size: number; name: string; sign?: string; relativePath: string };
        const allEntries: Array<{ pathName: string; absolutePath: string; isDir: boolean; sign?: string; files: FileEntry[] }> = [];

        for (const path of paths) {
            const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
            const pathName = path.split('/').pop() || 'folder';

            let getRes = null;
            for (let retry = 0; retry < 3; retry++) {
                try { getRes = await fetch(`${url}/api/fs/get`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: aListToken }, body: JSON.stringify({ path: absolutePath }), signal: AbortSignal.timeout(10000) }); if (getRes.ok) break; } catch { if (retry === 2) break; await new Promise(r => setTimeout(r, 1000 * (retry + 1))); }
            }
            if (!getRes || !getRes.ok) continue;
            const getData = await getRes.json();
            if (getData.code !== 200) continue;

            const isDir = getData.data?.is_dir || false;
            const files: FileEntry[] = [];

            if (isDir) {
                const rawFiles = await getAllFilesInDir(url, aListToken, absolutePath);
                for (const f of rawFiles) {
                    const fp = await getEffectivePermissionsForPath(user.username, user.role, f.path);
                    if (fp.download === false) { totalSkipped++; continue; }
                    const relativePath = f.path.replace(absolutePath, pathName).replace(/^\//, '').replace(/\\/g, '/');
                    files.push({ path: f.path, size: f.size, name: f.name, sign: f.sign, relativePath });
                }
                if (totalSkipped > 0) console.log(`[ZIP] ${pathName}: 跳过 ${totalSkipped} 个被禁止下载的文件`);
            } else {
                const sign = getData.data?.sign || '';
                files.push({ path: absolutePath, size: getData.data?.size || 0, name: pathName, sign, relativePath: pathName });
            }
            allEntries.push({ pathName, absolutePath, isDir, sign: getData.data?.sign, files });
        }

        // Load archiver
        let archiverModule: any;
        try { archiverModule = (await import('archiver')).default; } catch { return new Response('Missing archiver: npm install archiver', { status: 503 }); }
        const archive: any = archiverModule('zip', { zlib: { level: 0 } });

        // Vercel 兼容：用 Web ReadableStream 替代 Node PassThrough
        const stream = new ReadableStream({
            start(controller) {
                archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
                archive.on('end', () => controller.close());
                archive.on('error', (err: any) => { console.error('[ZIP] 错误:', err.message); controller.error(err); });
            },
        });

        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'application/zip');
        const fileName = 'download.zip';
        responseHeaders.set('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        responseHeaders.set('X-Skipped-Files', String(totalSkipped));

        // Start processing
        (async () => {
            try {
                let totalT1 = 0, totalT2 = 0, totalT3 = 0, totalFailed = 0;
                console.log('[ZIP] 开始生成');

                for (const entry of allEntries) {
                    const { pathName, absolutePath, isDir, files } = entry;
                    if (isDir) {
                        if (files.length === 0) {
                            archive.append(Buffer.alloc(0), { name: pathName + '/.gitkeep' });
                        } else {
                            const downloadFile = async (file: FileEntry) => {
                                try {
                                    // T1 首选：alist /p/ 直链下载
                                    if (file.sign) {
                                        const proxyUrl = `${url}/p${file.path}?sign=${file.sign}`;
                                        let stream = await fetch(proxyUrl, {
                                            headers: { Authorization: aListToken },
                                            signal: AbortSignal.timeout(30000),
                                        });
                                        if (stream.ok) {
                                            const buf = Buffer.from(await stream.arrayBuffer());
                                            archive.append(buf, { name: file.relativePath });
                                            totalT1++;
                                            return;
                                        }
                                    }
                                    totalT2++;
                                } catch { totalT2++; }
                                try {
                                    // T3 保底：get → raw_url → 百度 CDN
                                    let fileRes = await fetch(`${url}/api/fs/get`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', Authorization: aListToken },
                                        body: JSON.stringify({ path: file.path }),
                                        signal: AbortSignal.timeout(10000),
                                    });
                                    if (!fileRes.ok) return;
                                    const fileData = await fileRes.json();
                                    if (fileData.code !== 200) return;
                                    const rawUrl = fileData.data?.raw_url;
                                    if (!rawUrl) return;

                                    let stream = await fetch(rawUrl, {
                                        headers: { 'User-Agent': 'pan.baidu.com' },
                                        signal: AbortSignal.timeout(30000),
                                    });
                                    if (!stream.ok) return;
                                    const buf = Buffer.from(await stream.arrayBuffer());
                                    archive.append(buf, { name: file.relativePath });
                                    totalT3++;
                                } catch (e) {
                                    totalFailed++;
                                }
                            };

                            const CONCURRENCY = 6;
                            let activeCount = 0;
                            for (let i = 0; i < files.length; i++) {
                                while (activeCount >= CONCURRENCY) await new Promise(r => setTimeout(r, 10));
                                activeCount++;
                                downloadFile(files[i]).finally(() => activeCount--);
                            }
                            while (activeCount > 0) await new Promise(r => setTimeout(r, 10));
                        }
                    } else {
                        // 单文件：首选 /p/ 直链，降级百度 CDN
                        const sign = entry.sign || '';
                        const fileUrl = sign ? `${url}/p${absolutePath}?sign=${sign}` : null;
                        let downloaded = false;
                        if (fileUrl) {
                            try {
                                let stream = await fetch(fileUrl, { headers: { Authorization: aListToken }, signal: AbortSignal.timeout(30000) });
                                if (stream.ok) {
                                    archive.append(Buffer.from(await stream.arrayBuffer()), { name: pathName });
                                    downloaded = true; totalT1++;
                                } else totalT2++;
                            } catch { totalT2++; }
                        }
                        if (!downloaded) {
                            try {
                                const getRes2 = await fetch(`${url}/api/fs/get`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: aListToken }, body: JSON.stringify({ path: absolutePath }), signal: AbortSignal.timeout(10000) });
                                if (!getRes2.ok) continue;
                                const gd = await getRes2.json();
                                const rawUrl = gd.data?.raw_url;
                                if (!rawUrl) continue;
                                let fileStream = await fetch(rawUrl, { headers: { 'User-Agent': 'pan.baidu.com' }, signal: AbortSignal.timeout(30000) });
                                if (!fileStream.ok) continue;
                                archive.append(Buffer.from(await fileStream.arrayBuffer()), { name: pathName });
                                totalT3++;
                            } catch { totalFailed++; }
                        }
                    }
                }

                console.log(`[ZIP] 完成 → T1直链:${totalT1} T2降级:${totalT2} T3保底:${totalT3} 失败:${totalFailed}`);
                await archive.finalize();
            } catch (e: any) {
                console.error('[ZIP] 错误:', e);
            }
        })();

        return new NextResponse(stream, { status: 200, headers: responseHeaders });
    } catch (error: any) {
        console.error('[ZIP] 初始化错误:', error);
        return new Response(`错误: ${error?.message}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
}
