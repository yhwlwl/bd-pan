import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import { getUserPermissions } from '../../../lib/users';
import { pgFetch } from '../../../lib/pg-adapter';

const BACKUP_URL = (process.env.SUPABASE_BACKUP_URL || '').replace(/\/+$/, '');
const BACKUP_KEY = process.env.SUPABASE_BACKUP_KEY || '';

async function supabaseFetch(method: string, path: string): Promise<any> {
    const url = `${BACKUP_URL}/rest/v1/${path}`;
    const res = await fetch(url, { method, headers: { apikey: BACKUP_KEY, Authorization: `Bearer ${BACKUP_KEY}` } });
    return res.json();
}

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization') || undefined;
        const user = verifyToken(authHeader);
        if (!user) return NextResponse.json({ code: 401, message: '请先登录' }, { status: 401 });
        if (user.role !== 'admin') {
            const perms = await getUserPermissions(user.username, user.role);
            if (!(perms.viewStats || perms.viewActionLogs || perms.viewIpStats || perms.viewDownloadLogs)) {
                return NextResponse.json({ code: 401, message: '无权限访问统计信息' }, { status: 401 });
            }
        }

        // 数据源
        const { searchParams } = new URL(request.url);
        const source = searchParams.get('source') || 'ecs';
        const isSupabase = source === 'supabase' && BACKUP_URL;

        // 并行拉取两张表
        const [actionRes, viewRes] = await Promise.all([
            isSupabase
                ? supabaseFetch('GET', 'bdpan_action_logs?order=created_at.desc&limit=50000')
                : pgFetch<any>('GET', 'bdpan_action_logs?order=created_at.desc&limit=50000'),
            isSupabase
                ? supabaseFetch('GET', 'view_logs?order=visit_time.desc&limit=50000')
                : pgFetch<any>('GET', 'view_logs?order=visit_time.desc&limit=50000'),
        ]);
        const logs = isSupabase ? (Array.isArray(actionRes) ? actionRes : []) : (actionRes.data || []);
        const viewLogs = isSupabase ? (Array.isArray(viewRes) ? viewRes : []) : (viewRes.data || []);

        const channelStats: Record<string, { past24h: number; total: number; logs: any[] }> = {
            ecs: { past24h: 0, total: 0, logs: [] },
            cf: { past24h: 0, total: 0, logs: [] },
            raw: { past24h: 0, total: 0, logs: [] },
            vercel: { past24h: 0, total: 0, logs: [] },
            direct302: { past24h: 0, total: 0, logs: [] },
            other: { past24h: 0, total: 0, logs: [] },
        };
        const ipStats: Record<string, { count: number; lastActive: string; lastUser: string; location: string }> = {};
        const recentActions: any[] = [];
        const allDownloadLogs: any[] = [];
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let totalDownloads = 0, past24hDownloads = 0;

        logs.forEach((log: any) => {
            const isDownload = (log.action_type || '').startsWith('下载 -') || (log.action_type || '').startsWith('下载');
            const isPast24h = new Date(log.created_at) >= twentyFourHoursAgo;

            if (isDownload) {
                totalDownloads++;
                if (isPast24h) past24hDownloads++;
                let key = 'other';
                const at = log.action_type || '';
                if (at.includes('阿里云服务器极速下载')) key = 'ecs';
                else if (at.includes('Cloudflare 边缘加速')) key = 'cf';
                else if (at.includes('复制直链')) key = 'raw';
                else if (at.includes('vercel服务器中转下载')) key = 'vercel';
                else if (at.includes('302 直链跳转')) key = 'direct302';
                channelStats[key].total++;
                if (isPast24h) channelStats[key].past24h++;
                const logObj = { username: log.username, ip: log.ip, location: log.location || '未知定位', time: log.created_at, item: log.action_item };
                channelStats[key].logs.push(logObj);
                allDownloadLogs.push({ ...logObj, channel: key });
            }

            if (log.username === 'admin' && user.role !== 'admin') return;
            recentActions.push({ username: log.username, action: log.action_type, item: log.action_item, time: log.created_at, ip: log.ip, location: log.location || '未知定位' });
        });

        (viewLogs || []).forEach((log: any) => {
            const ip = log.ip_address;
            if (!ip) return;
            const location = [log.country, log.region, log.city].filter(Boolean).join(' ') || '未知定位';
            if (!ipStats[ip]) ipStats[ip] = { count: 0, lastActive: log.visit_time, lastUser: log.username || '访客', location };
            ipStats[ip].count++;
            if (new Date(log.visit_time) > new Date(ipStats[ip].lastActive)) {
                ipStats[ip].lastActive = log.visit_time;
                ipStats[ip].lastUser = log.username || '访客';
                ipStats[ip].location = location;
            }
        });

        const topIps = Object.entries(ipStats).map(([ip, data]) => ({ ip, ...data })).sort((a, b) => b.count - a.count).slice(0, 30);
        const totalPanVisits = (viewLogs || []).filter((l: any) => l.page_source === 'pan').length;

        // 在线用户：1h 内有登录且无登出的
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const loginMap = new Map<string, { time: string; role: string; sessionId: string; fingerprint: string }>();
        const logoutMap = new Map<string, string>();
        (logs || []).forEach((l: any) => {
            const t = new Date(l.created_at);
            if (l.action_type === '登录' && t >= oneHourAgo) {
                if (!loginMap.has(l.username)) loginMap.set(l.username, { time: l.created_at, role: '', sessionId: l.session_id || '', fingerprint: l.fingerprint || '' });
            }
            if (l.action_type === '登出' && t >= oneHourAgo) {
                const prev = logoutMap.get(l.username);
                if (!prev || t > new Date(prev)) logoutMap.set(l.username, l.created_at);
            }
        });
        const onlineUsers: Array<{ username: string; lastActive: string; sessionId: string; fingerprint: string }> = [];
        loginMap.forEach((v, username) => {
            const lgOut = logoutMap.get(username);
            if (!lgOut || new Date(v.time) > new Date(lgOut)) {
                onlineUsers.push({ username, lastActive: v.time, sessionId: v.sessionId, fingerprint: v.fingerprint });
            }
        });

        return NextResponse.json({
            code: 200,
            data: { totalPanVisits, past24hDownloads, totalDownloads, channelStats, recentActions, topIps, allDownloadLogs, viewLogs: viewLogs || [], onlineUsers },
        });
    } catch (e: any) {
        console.error('[stats] error:', e);
        return NextResponse.json({ code: 500, message: e.message }, { status: 500 });
    }
}
