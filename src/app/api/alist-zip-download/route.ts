import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    applyBasePathForPermissions,
    checkIpBanned,
    getEffectivePermissionsForPath,
    getSettings,
    getUserPermissions,
} from '../../../lib/users';

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

function normalizeVisiblePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

async function getAllFilesInDir(
    aListUrl: string,
    aListToken: string,
    dirPath: string,
    maxDepth: number = 100,
    currentDepth: number = 0,
): Promise<Array<{ path: string; size: number; is_dir: boolean; name: string }>> {
    if (currentDepth >= maxDepth) return [];

    const res = await fetch(`${aListUrl}/api/fs/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: aListToken },
        body: JSON.stringify({ path: dirPath }),
    });

    const data = await res.json();
    if (data.code !== 200) return [];

    const items = data.data?.content || [];
    const allFiles = [];

    for (const item of items) {
        const itemPath = `${normalizeVisiblePath(dirPath)}/${item.name}`.replace(/\/+/g, '/');
        if (item.is_dir) {
            const subFiles = await getAllFilesInDir(aListUrl, aListToken, itemPath, maxDepth, currentDepth + 1);
            allFiles.push(...subFiles);
        } else {
            allFiles.push({
                path: itemPath,
                size: item.size || 0,
                is_dir: false,
                name: item.name,
            });
        }
    }

    return allFiles;
}

export async function GET(request: Request) {
    try {
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        if (await checkIpBanned(clientIp)) {
            return new Response('IP banned', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
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
        const user = verifyToken(authHeader);
        if (!user) {
            return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        // Check permissions
        const basePerms = await getUserPermissions(user.username, user.role);
        
        for (const path of paths) {
            const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
            const pathPerms = await getEffectivePermissionsForPath(user.username, user.role, absolutePath);
            
            if (!pathPerms.view || !pathPerms.download) {
                return new Response(`Access denied for path: ${path}`, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        }

        const settings = await getSettings();
        const channel = settings.downloadChannel || 'ecs';
        const url = channel === 'ecs' ? ECS_URL : FRP_URL;
        const aUser = channel === 'ecs' ? ECS_USER : FRP_USER;
        const aPass = channel === 'ecs' ? ECS_PASS : FRP_PASS;

        const aListToken = await getAlistToken(url, aUser, aPass);

        console.log('[ZIP] 开始生成 ZIP 文件...');

        // Load archiver
        let archiverModule: any;
        try {
            archiverModule = (await import('archiver')).default;
        } catch (e) {
            return new Response('Missing archiver: npm install archiver', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        // Generate ZIP - streaming
        const archive: any = archiverModule('zip', { zlib: { level: 0 } });
        
        // Set response headers
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'application/zip');
        const fileName = 'download.zip';
        responseHeaders.set('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        responseHeaders.set('Pragma', 'no-cache');
        responseHeaders.set('Expires', '0');

        // Create PassThrough stream
        const { PassThrough } = require('stream');
        const passThrough = new PassThrough();
        
        archive.pipe(passThrough);

        archive.on('error', (err: any) => {
            console.error('[ZIP] 错误:', err.message);
            passThrough.destroy();
        });

        // Start background processing immediately
        (async () => {
            try {
                console.log('[ZIP] 开始生成');

                // Process each path
                for (const path of paths) {
                    const absolutePath = applyBasePathForPermissions(path, basePerms.basePath);
                    const pathName = path.split('/').pop() || 'folder';

                    let getRes = null;
                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            getRes = await fetch(`${url}/api/fs/get`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: aListToken },
                                body: JSON.stringify({ path: absolutePath }),
                                signal: AbortSignal.timeout(10000),
                            });
                            if (getRes.ok) break;
                        } catch (e: any) {
                            if (retry === 2) throw e;
                            await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                        }
                    }

                    if (!getRes || !getRes.ok) continue;

                    const getData = await getRes.json();
                    if (getData.code !== 200) continue;

                    const isDir = getData.data?.is_dir || false;

                    if (isDir) {
                        const allFiles = await getAllFilesInDir(url, aListToken, absolutePath);
                        console.log(`[ZIP] 获取目录 ${pathName}，共 ${allFiles.length} 个文件`);
                        
                        if (allFiles.length === 0) {
                            archive.append(Buffer.alloc(0), { name: pathName + '/.gitkeep' });
                        } else {
                            const downloadFile = async (file: any) => {
                                try {
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

                                    let fileStream = await fetch(rawUrl, {
                                        headers: { 'User-Agent': 'pan.baidu.com' },
                                        signal: AbortSignal.timeout(30000),
                                    });
                                    if (!fileStream.ok) return;

                                    const relativePath = file.path
                                        .replace(absolutePath, pathName)
                                        .replace(/^\//, '')
                                        .replace(/\\/g, '/');
                                    const fileBuffer = Buffer.from(await fileStream.arrayBuffer());
                                    archive.append(fileBuffer, { name: relativePath });
                                } catch (e) {
                                    console.warn('[ZIP] 文件错误:', file.path);
                                }
                            };

                            let activeCount = 0;
                            for (let i = 0; i < allFiles.length; i++) {
                                while (activeCount >= 3) await new Promise(r => setTimeout(r, 10));
                                activeCount++;
                                downloadFile(allFiles[i]).finally(() => activeCount--);
                            }
                            while (activeCount > 0) await new Promise(r => setTimeout(r, 10));
                        }
                    } else {
                        const rawUrl = getData.data?.raw_url;
                        if (!rawUrl) continue;
                        try {
                            let fileStream = await fetch(rawUrl, {
                                headers: { 'User-Agent': 'pan.baidu.com' },
                                signal: AbortSignal.timeout(30000),
                            });
                            if (!fileStream.ok) continue;
                            const fileBuffer = Buffer.from(await fileStream.arrayBuffer());
                            archive.append(fileBuffer, { name: pathName });
                        } catch (e) {
                            console.warn('[ZIP] 单文件错误:', pathName);
                        }
                    }
                }

                if (true) {
                    console.log(`[ZIP] 完成`);
                    archive.finalize();
                }
            } catch (e: any) {
                console.error('[ZIP] 错误:', e);
                archive.destroy();
            }
        })();

        return new NextResponse(passThrough as any, { status: 200, headers: responseHeaders });
    } catch (error: any) {
        console.error('[ZIP] 初始化错误:', error);
        return new Response(`错误: ${error?.message}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
}
