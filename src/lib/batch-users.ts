// 批量导入用户的解析与校验：纯函数，服务端与用户管理页共用，误用 node 内置模块。

/** 单次批量导入的硬上限，防止一次请求打爆数据库连接。 */
export const MAX_BATCH_USERS = 200;

/** 内置账号，不允许通过批量导入创建。 */
export const RESERVED_USERNAMES = ['admin', 'guest'] as const;

export interface BatchUserEntry {
    username: string;
    password: string;
    line: number;
}

export interface BatchParseError {
    line: number;
    raw: string;
    reason: string;
}

export interface BatchParseResult {
    entries: BatchUserEntry[];
    errors: BatchParseError[];
}

/**
 * 校验用户名：非空、无空白、长度 <= 64、非内置账号。
 * 有意不限制字符集——历史账号可能包含中文，收窄规则会误伤。
 */
export function validateUsername(username: string): string | null {
    if (!username) return '用户名不能为空';
    if (/\s/.test(username)) return '用户名不能包含空格';
    if (username.length > 64) return '用户名超过 64 个字符';
    if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) return '内置账号不可用';
    return null;
}

export function validatePassword(password: string): string | null {
    if (!password) return '密码不能为空';
    if (password.length > 128) return '密码超过 128 个字符';
    return null;
}

/**
 * 按行拆出 "用户名 密码"。
 * 分隔规则：优先取首个逗号（中英文均可）——这样密码里可以带空格；
 * 没有逗号时按空白切分，必须恰好两段。
 */
function splitLine(raw: string): { username: string; password: string } | { reason: string } {
    const line = raw.trim();
    const commaIndex = line.search(/[,，]/);
    if (commaIndex >= 0) {
        const username = line.slice(0, commaIndex).trim();
        const password = line.slice(commaIndex + 1).trim();
        if (!username || !password) return { reason: '逗号两侧都必须填写' };
        return { username, password };
    }

    const parts = line.split(/[\s\u3000]+/).filter(Boolean);
    if (parts.length < 2) return { reason: '缺少密码（格式：用户名 密码）' };
    if (parts.length > 2) return { reason: '字段过多，密码含空格请改用逗号分隔' };
    return { username: parts[0], password: parts[1] };
}

/**
 * 解析批量输入文本。空行与 `#` 开头的注释行直接忽略。
 * 行号为原文行号（从 1 开始），方便用户对照定位。
 */
export function parseBatchUsers(text: string): BatchParseResult {
    const entries: BatchUserEntry[] = [];
    const errors: BatchParseError[] = [];
    const seen = new Map<string, number>();

    text.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parsed = splitLine(trimmed);
        if ('reason' in parsed) {
            errors.push({ line, raw: trimmed, reason: parsed.reason });
            return;
        }

        const usernameError = validateUsername(parsed.username);
        if (usernameError) {
            errors.push({ line, raw: trimmed, reason: usernameError });
            return;
        }
        const passwordError = validatePassword(parsed.password);
        if (passwordError) {
            errors.push({ line, raw: trimmed, reason: passwordError });
            return;
        }

        const firstLine = seen.get(parsed.username);
        if (firstLine !== undefined) {
            errors.push({ line, raw: trimmed, reason: `与第 ${firstLine} 行重复` });
            return;
        }
        seen.set(parsed.username, line);

        if (entries.length >= MAX_BATCH_USERS) {
            errors.push({ line, raw: trimmed, reason: `超过单次上限 ${MAX_BATCH_USERS} 个` });
            return;
        }

        entries.push({ username: parsed.username, password: parsed.password, line });
    });

    return { entries, errors };
}
