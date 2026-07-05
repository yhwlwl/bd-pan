import { NextResponse } from 'next/server';
import { verifyToken, verifyTokenWithLog, type AuthContext } from '../_auth';

// 引入即激活 server-log 对 console 的劫持
import { getRecentLogs } from '../../../lib/server-log';
import { denyAndLog, getRequestContext, checkEntityBanned } from '../../../lib/deny-tracker';
import { hashDeviceCode } from '../../../lib/fingerprint';

export async function GET(request: Request) {
    const ctx = getRequestContext(request);
    const user = verifyTokenWithLog(request.headers.get('authorization') || undefined, ctx);
    if (!user || user.role !== 'admin') {
        return denyAndLog(request, 'api_role_denied', 403, '仅管理员可查看');
    }
    const limit = parseInt(new URL(request.url).searchParams.get('limit') || '100', 10);
    return NextResponse.json({ logs: getRecentLogs(Math.min(limit, 500)) });
}
