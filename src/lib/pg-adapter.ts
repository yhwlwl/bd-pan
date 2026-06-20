// PostgREST 轻量适配器 — 替代 @supabase/supabase-js

const ECS_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const PG_TOKEN = process.env.PG_DB_TOKEN || '';
// 双写备份：写入也同步到 Supabase（仅写入，读取只用 ECS）
const BACKUP_URL = (process.env.SUPABASE_BACKUP_URL || '').replace(/\/+$/, '');
const BACKUP_KEY = process.env.SUPABASE_BACKUP_KEY || '';

interface QueryResult<T = any> {
    data: T[] | null;
    error: { message: string } | null;
    count?: number;
}

export async function pgFetch<T = any>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, string>,
): Promise<QueryResult<T>> {
    if (!ECS_URL) return { data: null, error: { message: 'ECS_URL 未配置' } };
    try {
        const url = new URL(`${ECS_URL}/${path}`);
        if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const headers: Record<string, string> = {};
        if (PG_TOKEN) headers['X-DB-Token'] = PG_TOKEN;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
        if (!res.ok && res.status !== 204) {
            const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
            console.error(`[pg-adapter] ${method} ${ECS_URL}/${path} → ${res.status}:`, err.message || err);
            return { data: null, error: { message: err.message || `HTTP ${res.status}` } };
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : [];
        return { data: Array.isArray(data) ? data : [data], error: null };
    } catch (e: any) {
        return { data: null, error: { message: e.message || '网络错误' } };
    }
}

// 模拟 supabase-js 的链式查询接口（只实现我们用到的）
export function pgClient() {
    if (!ECS_URL) return null;

    function from(table: string) {
        let _select = '*';
        let _filters: Array<{ col: string; val: string }> = [];
        let _limit = 0;
        let _single = false;

        const chain = {
            select(cols: string) { _select = cols; return chain; },
            eq(col: string, val: string) { _filters.push({ col, val }); return chain; },
            limit(n: number) { _limit = n; return chain; },
            single() { _single = true; _limit = 1; return chain; },

            // 返回第一个匹配项或 null
            async maybeSingle<T>(): Promise<QueryResult<T>> {
                _limit = 1;
                const params: Record<string, string> = {};
                if (_select && _select !== '*') params.select = _select;
                _filters.forEach(f => { params[f.col] = `eq.${f.val}`; });
                if (_limit) params.limit = String(_limit);
                const path = table + '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
                const r = await pgFetch<T>('GET', path);
                if (_single) r.data = r.data && r.data.length > 0 ? [r.data[0]] : [];
                return r;
            },

            then(resolve: any, reject: any) {
                return chain.maybeSingle().then(r => {
                    if (r.error) reject(r.error);
                    // 兼容 supabase-js: { data, error }
                    const result = { data: _single ? (r.data?.[0] || null) : r.data, error: r.error };
                    resolve(result);
                }).catch(reject);
            }
        };
        return chain;
    }

    return { from };
}

// 直接 upsert（settings 用）
export async function pgUpsert(table: string, data: { key: string; value: any }): Promise<QueryResult> {
    // PostgREST upsert: POST with Prefer: resolution=merge-duplicates
    try {
        const url = new URL(`${ECS_URL}/${table}`);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation',
        };
        if (PG_TOKEN) headers['X-DB-Token'] = PG_TOKEN;
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
            return { data: null, error: { message: err.message || `HTTP ${res.status}` } };
        }
        backupWrite('POST', table, data);
        return { data: null, error: null };
    } catch (e: any) {
        return { data: null, error: { message: e.message } };
    }
}

// 双写备份：写入 ECS 同时异步写到 Supabase（不等待，失败不影响主流程）
async function backupWrite(method: string, path: string, body?: any) {
    if (!BACKUP_URL) return;
    try {
        const url = `${BACKUP_URL}/rest/v1/${path}`;
        const headers: Record<string, string> = BACKUP_KEY ? { apikey: BACKUP_KEY, Authorization: `Bearer ${BACKUP_KEY}` } : {};
        // 去掉 Supabase 没有的列
        let cleanBody = body;
        if (body) {
            cleanBody = { ...body };
            delete cleanBody.session_id;
            delete cleanBody.fingerprint;
            delete cleanBody.blocked;
        }
        if (cleanBody && Object.keys(cleanBody).length > 0) headers['Content-Type'] = 'application/json';
        await fetch(url, { method, headers, body: cleanBody ? JSON.stringify(cleanBody) : undefined });
    } catch {}
}

// 直接 insert
export async function pgInsert(table: string, data: any): Promise<QueryResult> {
    const r = await pgFetch('POST', table, data);
    backupWrite('POST', table, data); // 不 await，异步备份
    return r;
}

// 直接 update
export async function pgUpdate(table: string, filterCol: string, filterVal: string, data: any): Promise<QueryResult> {
    const r = await pgFetch('PATCH', `${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`, data);
    backupWrite('PATCH', `${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`, data);
    return r;
}

// 直接 delete
export async function pgDelete(table: string, filterCol: string, filterVal: string): Promise<QueryResult> {
    const r = await pgFetch('DELETE', `${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`);
    backupWrite('DELETE', `${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}`);
    return r;
}
