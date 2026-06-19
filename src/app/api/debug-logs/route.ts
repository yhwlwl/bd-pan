import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';

// 引入即激活 server-log 对 console 的劫持
import { getRecentLogs } from '../../../lib/server-log';

export async function GET(request: Request) {
    const user = verifyToken(request.headers.get('authorization') || undefined);
    if (!user || user.role !== 'admin') {
        return NextResponse.json({ error: '仅管理员可查看' }, { status: 403 });
    }
    const limit = parseInt(new URL(request.url).searchParams.get('limit') || '100', 10);
    return NextResponse.json({ logs: getRecentLogs(Math.min(limit, 500)) });
}
