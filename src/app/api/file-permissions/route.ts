import { NextResponse } from 'next/server';
import { verifyToken } from '../_auth';
import {
    canAssignFilePermissionTarget,
    canManageFilePermissions,
    filterRuleUsersByActor,
    getSettings,
    getUsers,
    updateSettings,
} from '../../../lib/users';
import type { FilePermissionRule } from '../../../lib/users';

const ECS_URL = (process.env.NEXT_PUBLIC_ALIST_URL || 'https://pan.tantantan.tech:5245').replace(/\/+$/, '');
const ECS_USER = process.env.ALIST_USERNAME || '';
const ECS_PASS = process.env.ALIST_PASSWORD || '';
const FRP_URL = (process.env.NEXT_PUBLIC_ALIST_URL_FALLBACK || 'https://frp-gap.com:37492').replace(/\/+$/, '');
const FRP_USER = process.env.ALIST_USERNAME_FALLBACK || '';
const FRP_PASS = process.env.ALIST_PASSWORD_FALLBACK || '';

const tokenCache = new Map<string, { token: string; expiry: number }>();

async function getAlistToken(url: string, user: string, pass: string): Promise<string> {
    const cacheKey = `${url}|${user}|${pass}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.token;

    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await res.json();
    if (data.code !== 200 || !data.data?.token) throw new Error(data.message || 'AList 登录失败');

    const newToken = data.data.token;
    tokenCache.set(cacheKey, { token: newToken, expiry: Date.now() + 47 * 60 * 60 * 1000 });
    return newToken;
}

async function authorize(request: Request) {
    const authHeader = request.headers.get('authorization') || undefined;
    const user = verifyToken(authHeader);
    if (!user) return null;
    const allowed = await canManageFilePermissions(user.username, user.role);
    if (!allowed) return null;
    return user;
}

export async function GET(request: Request) {
    const user = await authorize(request);
    if (!user) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const settings = await getSettings();
    const allUsers = (await getUsers()).map((item) => ({ username: item.username, role: item.role }));
    const manageableUsers = allUsers.filter((item) => canAssignFilePermissionTarget(user.role, item.role, item.username));
    const visibleRules = (settings.filePermissionRules || [])
        .map((rule) => filterRuleUsersByActor(rule, user.role, allUsers))
        .filter(Boolean);

    return NextResponse.json({
        users: manageableUsers,
        rules: visibleRules,
    });
}

export async function POST(request: Request) {
    const user = await authorize(request);
    if (!user) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { action } = body;

        // === preview action: 预览正则匹配的文件 ===
        if (action === 'preview') {
            const { pattern, scopePath, regexScope } = body as {
                pattern: string;
                scopePath?: string;
                regexScope?: 'name' | 'path';
            };

            if (!pattern || !pattern.trim()) {
                return NextResponse.json({ error: '请输入匹配表达式' }, { status: 400 });
            }

            // 验证正则是否合法
            try {
                new RegExp(pattern, 'i');
            } catch {
                return NextResponse.json({ error: '正则表达式语法错误，请检查' }, { status: 400 });
            }

            const rootPath = (scopePath || '/').replace(/\/+$/, '') || '/';
            const settings = await getSettings();
            const channel = settings.downloadChannel || 'ecs';
            const config = channel === 'ecs'
                ? { url: ECS_URL, user: ECS_USER, pass: ECS_PASS }
                : { url: FRP_URL, user: FRP_USER, pass: FRP_PASS };

            let token = '';
            try {
                token = await getAlistToken(config.url, config.user, config.pass);
            } catch {
                return NextResponse.json({ error: '无法连接网盘服务器' }, { status: 500 });
            }

            const startTime = Date.now();
            const regex = new RegExp(pattern, 'i');
            const scope = regexScope || 'path';
            const matchedFiles: Array<{ name: string; path: string; is_dir: boolean }> = [];
            const MAX_RESULTS = 2000;

            // 从正则中提取纯文本关键词用于 alist 搜索
            function extractKeywords(pattern: string): string {
                const cleaned = pattern.replace(/[|()\[\]{}.*+?^$\\]/g, ' ').trim();
                if (!cleaned) return pattern;
                const words = [...new Set(cleaned.split(/\s+/).filter(Boolean))];
                return words.join(' ');
            }

            const keywords = extractKeywords(pattern);
            console.log(`[preview] alist搜索, pattern="${pattern}", keywords="${keywords}", scope="${scope}"`);

            // 第一阶段：alist 搜索找到候选目录/文件
            const PAGE_SIZE = 5000;
            let page = 1;
            const searchResults: any[] = [];

            while (searchResults.length < MAX_RESULTS * 3) {
                let searchData: any;
                try {
                    const searchRes = await fetch(`${config.url}/api/fs/search`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: token },
                        body: JSON.stringify({ parent: rootPath, keywords, scope: 1, page, per_page: PAGE_SIZE }),
                    });
                    searchData = await searchRes.json();
                } catch (searchErr: any) {
                    console.error(`[preview] alist搜索第${page}页失败:`, searchErr.message);
                    break;
                }
                if (searchData.code !== 200) { console.warn(`[preview] 搜索失败 code=${searchData.code}`); break; }
                const pageContent = Array.isArray(searchData.data?.content) ? searchData.data.content : [];
                if (pageContent.length === 0) break;
                searchResults.push(...pageContent);
                if (pageContent.length < PAGE_SIZE) break;
                page++;
            }

            console.log(`[preview] 搜索返回 ${searchResults.length} 条候选`);

            // 辅助：从 item 提取路径和名称
            function itemInfo(item: any) {
                const p = item.path || item?.obj_path || item?.full_path
                    || (item.parent && item.name ? `${String(item.parent).replace(/\/+$/, '')}/${item.name}` : '')
                    || item.parent || '';
                const n = item.name || p.split('/').pop() || '';
                return { path: p, name: n, is_dir: Boolean(item.is_dir) };
            }

            // 第二阶段：遍历搜索结果中的目录，列出子文件用正则过滤
            const seen = new Set<string>();
            const queue: string[] = [];

            // 先用搜索结果做正则匹配，目录入队
            for (const item of searchResults) {
                const info = itemInfo(item);
                const testTarget = scope === 'name' ? info.name : info.path;
                if (regex.test(testTarget)) {
                    const key = info.path || info.name;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    matchedFiles.push(info);
                    if (info.is_dir) queue.push(info.path);
                }
            }

            // BFS：列出队列中每个目录的内容，正则过滤，子目录继续入队
            const MAX_LIST = 200; // 最多额外列出 200 个目录
            let listed = 0;

            while (queue.length > 0 && matchedFiles.length < MAX_RESULTS && listed < MAX_LIST) {
                const dirPath = queue.shift()!;
                listed++;

                let listData: any;
                try {
                    const listRes = await fetch(`${config.url}/api/fs/list`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: token },
                        body: JSON.stringify({ path: dirPath, page: 1, per_page: 0, refresh: false }),
                    });
                    listData = await listRes.json();
                } catch {
                    continue;
                }

                if (listData.code !== 200 || !Array.isArray(listData.data?.content)) continue;

                for (const child of listData.data.content) {
                    if (matchedFiles.length >= MAX_RESULTS) break;
                    const info = itemInfo(child);
                    const testTarget = scope === 'name' ? info.name : info.path;
                    if (!regex.test(testTarget)) continue;
                    const key = info.path || info.name;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    matchedFiles.push(info);
                    if (info.is_dir) queue.push(info.path);
                }
            }

            const elapsed = Date.now() - startTime;
            const truncated = matchedFiles.length >= MAX_RESULTS;
            console.log(`[preview] 完成: ${elapsed}ms, 搜索候选=${searchResults.length}, 列表目录=${listed}, 正则匹配=${matchedFiles.length}`);

            return NextResponse.json({
                total: matchedFiles.length,
                files: matchedFiles,
                truncated,
                debug: { alistTotal: searchResults.length, listedDirs: listed, elapsedMs: elapsed },
            });
        }

        // === 原有逻辑: 保存规则 ===
        const submittedRules = Array.isArray(body?.rules) ? (body.rules as FilePermissionRule[]) : [];
        const settings = await getSettings();
        const allUsers = (await getUsers()).map((item) => ({ username: item.username, role: item.role }));
        const manageableUsernames = new Set(
            allUsers
                .filter((item) => canAssignFilePermissionTarget(user.role, item.role, item.username))
                .map((item) => item.username),
        );

        const sanitizedRules = submittedRules
            .map((rule) => filterRuleUsersByActor(rule, user.role, allUsers))
            .filter(Boolean) as FilePermissionRule[];

        const preservedRules = (settings.filePermissionRules || []).filter((rule) => {
            const touchesManageableUser = rule.users.some((username) => manageableUsernames.has(username));
            return !touchesManageableUser;
        });

        const mergedRules = [...preservedRules, ...sanitizedRules];
        await updateSettings({ filePermissionRules: mergedRules });

        return NextResponse.json({ ok: true, rules: sanitizedRules });
    } catch {
        return NextResponse.json({ error: '接口异常' }, { status: 500 });
    }
}
