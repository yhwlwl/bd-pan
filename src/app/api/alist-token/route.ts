import { verifyTokenWithLog } from '../_auth';
import { denyAndLog, getRequestContext } from '../../../lib/deny-tracker';

async function handleTokenEndpoint(request: Request) {
    const ctx = getRequestContext(request);
    const authHeader = request.headers.get('authorization') || undefined;
    const user = verifyTokenWithLog(authHeader, ctx);
    if (!user) {
        return new Response(JSON.stringify({ error: '请先登录' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    }

    // This endpoint used to expose the AList service JWT. Keep the route as a
    // tombstone so old clients fail closed, and make every authenticated probe
    // visible to the risk-control panel without returning any upstream data.
    return denyAndLog(
        request,
        'api_alist_token_denied',
        410,
        '直连 Token 接口已停用，请使用受控上传代理',
        user.username,
    );
}

export const POST = handleTokenEndpoint;
export const GET = handleTokenEndpoint;
