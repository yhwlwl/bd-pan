import { verifyTokenEdge } from '../_auth-edge';
import { getUserPermissions, getSettings } from '../../../lib/users';

// 使用 Edge Runtime —— 突破 Vercel Serverless 的 4.5MB body 限制
export const runtime = 'edge';

// ECS 成都节点 (主)
const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'http://8.137.91.213:5244').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
// FRP NAS 节点 (备)
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

function jsonRes(obj: any, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function PUT(request: Request) {
    // Edge 兼容的 Token 校验
    const authHeader = request.headers.get('authorization') || undefined;
    const user = await verifyTokenEdge(authHeader);
    if (!user) {
        return jsonRes({ code: 401, message: '请先登录' }, 401);
    }

    const perms = await getUserPermissions(user.username, user.role);
    if (!perms.upload) {
        return jsonRes({ code: 403, message: '权限不足，无权上传文件' }, 403);
    }

    try {
        const customUrl = request.headers.get('x-alist-url');
        const customUser = request.headers.get('x-alist-username');
        const customPass = request.headers.get('x-alist-password');

        let config: { url: string; user: string; pass: string };
        if (customUrl) {
            config = { url: customUrl.replace(/\/+$/, ''), user: customUser || '', pass: customPass || '' };
        } else {
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            config = channel === 'ecs'
                ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
                : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };
        }

        // 1. 获取 AList Token
        const tokenRes = await fetch(`${config.url}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: config.user, password: config.pass }),
        });

        const responseContentType = tokenRes.headers.get('content-type') || '';
        if (!responseContentType.includes('application/json')) {
            const rawText = await tokenRes.text();
            console.error('[alist-upload] 非 JSON 响应:', rawText);
            return jsonRes({ 
                code: 500, 
                message: `AList 接口返回非 JSON 数据 (可能被防火墙拦截)。返回内容: ${rawText.substring(0, 50)}` 
            }, 500);
        }

        const tokenData = await tokenRes.json();
        if (tokenData.code !== 200 || !tokenData.data?.token) {
            return jsonRes({ code: 500, message: 'AList Token 获取失败: ' + (tokenData.message || '登录凭据错误') }, 500);
        }
        const alistToken = tokenData.data.token;

        // 2. 拿到要上传的路径信息
        const filePath = request.headers.get('File-Path');
        if (!filePath) {
            return jsonRes({ code: 400, message: '缺少 File-Path 请求头' }, 400);
        }

        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        const contentLength = request.headers.get('Content-Length');

        // 3. 流式转发到 AList Server
        const uploadHeaders: Record<string, string> = {
            'Authorization': alistToken,
            'File-Path': filePath,
            'Content-Type': contentType,
        };
        if (contentLength) {
            uploadHeaders['Content-Length'] = contentLength;
        }

        const uploadRes = await fetch(`${config.url}/api/fs/put`, {
            method: 'PUT',
            headers: uploadHeaders,
            body: request.body,
            // @ts-ignore
            duplex: 'half',
        });

        const data = await uploadRes.json();
        return jsonRes(data);
    } catch (e: any) {
        console.error('[alist-upload-edge] error:', e);
        return jsonRes({ code: 500, message: e?.message || '上传代理异常' }, 500);
    }
}
